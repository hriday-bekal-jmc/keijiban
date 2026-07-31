import { Router, Request, Response, NextFunction } from 'express'
import { query, pool, visibilitySQL, UUID_RE, logAudit, parsePage, resolveVisiblePost } from '../config/db.js'
import { requireAuth } from '../middleware/auth.js'
import { sseManager } from '../services/sse.js'
import { postCreateLimiter } from '../middleware/rateLimits.js'
import type { RequestWithUser } from '../types.js'

const router = Router()

const VALID_POST_TYPES       = new Set(['ANNOUNCEMENT', 'KNOWLEDGE', 'DAILY_REPORT', 'CHAT', 'DEPARTMENT'])
const VALID_VISIBILITY_SCOPES = new Set(['COMPANY_WIDE', 'DEPARTMENT'])
const MAX_TITLE_LEN   = 200
// Room for a multi-codepoint emoji (ZWJ sequences, skin-tone modifiers)
const MAX_EMOJI_LEN   = 16
// One feed page is 15 posts; 100 leaves room for a backlog flush after the
// user scrolls several pages without the tab being visible.
const MAX_VIEW_IDS    = 100
const MAX_CATEGORIES  = 8
const MAX_TAG_LEN     = 50
const MAX_TAGS        = 10
// Notification INSERT uses 3 fixed params + 1 per recipient.
// Keep each batch well under PostgreSQL's 65535-parameter limit.
const NOTIFICATION_BATCH_SIZE = 500


// No GROUP BY: correlated subqueries for counts avoid the N×M fan-out that
// LEFT JOIN likes × LEFT JOIN comments creates when posts have many engagements.
const postSelectSQL = `
  SELECT
    p.id, p.title, p.content, p.post_type, p.visibility_scope,
    p.tags, p.created_at, p.updated_at, p.event_date, p.is_pinned,
    p.cover_attachment_id,
    -- Designed thumbnail: the spec is joined in rather than denormalised, so
    -- editing a preset restyles every post already using it.
    p.thumbnail_preset_id, p.thumbnail_emoji,
    p.branch_id,
    br.name AS branch_name,
    -- A post carries 0..N categories; aggregated here so the client gets them
    -- in the same round trip as the post.
    (SELECT COALESCE(json_agg(json_build_object('id', c.id, 'name', c.name, 'color', c.color)
                              ORDER BY c.sort_order), '[]'::json)
     FROM post_categories pc JOIN categories c ON c.id = pc.category_id
     WHERE pc.post_id = p.id) AS categories,
    tp.background  AS thumb_background,
    tp.text_color  AS thumb_text_color,
    tp.pattern     AS thumb_pattern,
    u.id         AS author_id,
    u.full_name  AS author_name,
    u.avatar_url AS author_avatar,
    d.name       AS author_dept,
    (SELECT COUNT(*)::int FROM likes    WHERE post_id = p.id)                       AS likes_count,
    (SELECT COUNT(*)::int FROM comments WHERE post_id = p.id AND deleted_at IS NULL) AS comments_count,
    EXISTS(SELECT 1 FROM likes     WHERE post_id = p.id AND user_id = $1) AS liked_by_me,
    EXISTS(SELECT 1 FROM bookmarks WHERE post_id = p.id AND user_id = $1) AS is_bookmarked_by_me,
    -- Read state. Server-authoritative so it follows the user across devices.
    -- Own posts count as read without a post_views row: the viewers list must
    -- not show the author, but they have obviously read their own post.
    -- Index lookup — post_views PK is (post_id, user_id).
    (p.author_id = $1
     OR EXISTS(SELECT 1 FROM post_views WHERE post_id = p.id AND user_id = $1)) AS viewed_by_me,
    (SELECT COUNT(*)::int FROM post_views WHERE post_id = p.id)            AS views_count,
    (SELECT COALESCE(json_agg(v ORDER BY v.viewed_at DESC), '[]'::json)
     FROM (
       SELECT uv.id, uv.avatar_url, pv2.viewed_at
       FROM post_views pv2
       JOIN users uv ON uv.id = pv2.user_id
       WHERE pv2.post_id = p.id
       ORDER BY pv2.viewed_at DESC
       LIMIT 3
     ) v)                                                                  AS top_viewers,
    (SELECT COALESCE(
      json_agg(json_build_object(
        'id',             att.id,
        'drive_file_id',  att.drive_file_id,
        'drive_url',      att.drive_url,
        'file_name',      att.file_name,
        'mime_type',      att.mime_type,
        'size_bytes',     att.size_bytes,
        'thumbnail_path', att.thumbnail_path
      ) ORDER BY att.created_at),
      '[]'::json
    ) FROM attachments att WHERE att.post_id = p.id) AS attachments
  FROM posts p
  JOIN users u       ON u.id = p.author_id
  JOIN departments d ON d.id = u.department_id
  LEFT JOIN thumbnail_presets tp ON tp.id = p.thumbnail_preset_id
  LEFT JOIN branches br ON br.id = p.branch_id
`

// GET /api/posts
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cursor_created_at, cursor_id, category, branch, q, tag, limit = '15' } =
      req.query as Record<string, string | undefined>
    const { id: userId, departmentId, branchId, role } = (req as RequestWithUser).user
    const { limit: pageSize } = parsePage(req.query, 15, 50)

    if (q && q.trim().length > 200) {
      return res.status(400).json({ error: 'Search query too long' })
    }
    if (category && !UUID_RE.test(category)) {
      return res.status(400).json({ error: 'Invalid category' })
    }
    if (branch && !UUID_RE.test(branch)) {
      return res.status(400).json({ error: 'Invalid branch' })
    }

    // $1/$2/$3 are the viewer's identity, used by visibilitySQL; $4 is the page size.
    const params: unknown[] = [userId, departmentId, branchId, pageSize]
    const conditions: string[] = [`p.deleted_at IS NULL`, visibilitySQL(1, 2, 3, role === 'admin')]

    if (cursor_created_at && cursor_id) {
      params.push(cursor_created_at, cursor_id)
      conditions.push(`(p.created_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
    }

    if (category) {
      params.push(category)
      conditions.push(`EXISTS (SELECT 1 FROM post_categories pc WHERE pc.post_id = p.id AND pc.category_id = $${params.length}::uuid)`)
    }

    // Narrowing the view to one branch. This only ever filters further — the
    // visibility clause above still applies, so it cannot widen access.
    if (branch) {
      params.push(branch)
      conditions.push(`p.branch_id = $${params.length}::uuid`)
    }

    if (q?.trim()) {
      params.push(`%${q.trim()}%`)
      conditions.push(`(p.title ILIKE $${params.length} OR p.content ILIKE $${params.length})`)
    }

    if (tag?.trim()) {
      params.push(tag.trim())
      // `@>` uses the GIN index on tags; `= ANY(p.tags)` cannot and seq-scans.
      conditions.push(`p.tags @> ARRAY[$${params.length}]::text[]`)
    }

    const { rows } = await query(
      `${postSelectSQL}
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $4`,
      params
    )

    const lastRow = rows[rows.length - 1] as { created_at: string; id: string } | undefined
    const nextCursor = rows.length === pageSize && lastRow
      ? { created_at: lastRow.created_at, id: lastRow.id }
      : null

    res.json({ posts: rows, nextCursor })
  } catch (err) {
    next(err)
  }
})

// POST /api/posts
router.post('/', requireAuth, postCreateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      title, content, post_type, visibility_scope,
      tags = [], department_ids = [], event_date = null,
      thumbnail_preset_id = null, thumbnail_emoji = null,
      category_ids = [], branch_id = null,
    } = req.body as {
      title?: string
      content?: string
      post_type?: string
      visibility_scope?: string
      tags?: unknown
      department_ids?: unknown
      event_date?: string | null
      thumbnail_preset_id?: string | null
      thumbnail_emoji?: string | null
      category_ids?: unknown
      branch_id?: string | null
    }

    if (!(req as RequestWithUser).user.canPost) {
      return res.status(403).json({ error: '投稿権限がありません' })
    }

    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'Title and content required' })
    }
    if (title.trim().length > MAX_TITLE_LEN) {
      return res.status(400).json({ error: `Title must be ${MAX_TITLE_LEN} characters or less` })
    }
    const safeType  = (post_type ?? '').toUpperCase()
    const safeScope = (visibility_scope ?? '').toUpperCase()
    if (!VALID_POST_TYPES.has(safeType)) {
      return res.status(400).json({ error: 'Invalid post_type' })
    }
    if (!VALID_VISIBILITY_SCOPES.has(safeScope)) {
      return res.status(400).json({ error: 'Invalid visibility_scope' })
    }

    // Validate tags: must be array of short strings
    if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' })
    if ((tags as unknown[]).length > MAX_TAGS) return res.status(400).json({ error: `Maximum ${MAX_TAGS} tags allowed` })
    const safeTags = (tags as unknown[]).map(t => String(t).trim()).filter(Boolean)
    if (safeTags.some(t => t.length > MAX_TAG_LEN)) {
      return res.status(400).json({ error: `Each tag must be ${MAX_TAG_LEN} characters or less` })
    }

    if (thumbnail_preset_id !== null && !UUID_RE.test(thumbnail_preset_id)) {
      return res.status(400).json({ error: 'Invalid thumbnail_preset_id' })
    }
    const safeEmoji = thumbnail_emoji?.trim().slice(0, MAX_EMOJI_LEN) || null

    if (!Array.isArray(category_ids)) return res.status(400).json({ error: 'category_ids must be an array' })
    if ((category_ids as unknown[]).length > MAX_CATEGORIES) {
      return res.status(400).json({ error: `Maximum ${MAX_CATEGORIES} categories allowed` })
    }
    const safeCategoryIds = (category_ids as unknown[])
      .map(String).filter(id => UUID_RE.test(id))
    if (branch_id !== null && !UUID_RE.test(branch_id)) {
      return res.status(400).json({ error: 'Invalid branch_id' })
    }

    // Validate department_ids: must be array of UUIDs
    if (!Array.isArray(department_ids)) return res.status(400).json({ error: 'department_ids must be an array' })
    const safeDeptIds = (department_ids as unknown[]).map(d => String(d)).filter(id => UUID_RE.test(id))

    const { id: authorId, departmentId } = (req as RequestWithUser).user

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { rows } = await client.query(
        `INSERT INTO posts (author_id, title, content, post_type, visibility_scope, tags, event_date,
                            thumbnail_preset_id, thumbnail_emoji, branch_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [authorId, title.trim(), content.trim(), safeType, safeScope, safeTags, event_date ?? null,
         thumbnail_preset_id, safeEmoji, branch_id]
      )
      const post = rows[0] as { id: string }

      if (safeCategoryIds.length > 0) {
        const values = safeCategoryIds.map((_, i) => `($1, $${i + 2}::uuid)`).join(', ')
        await client.query(
          `INSERT INTO post_categories (post_id, category_id) VALUES ${values}
           ON CONFLICT DO NOTHING`,
          [post.id, ...safeCategoryIds]
        )
      }

      // Batch INSERT post_departments (avoids N individual round-trips)
      if (safeScope === 'DEPARTMENT' && safeDeptIds.length > 0) {
        const placeholders = safeDeptIds.map((_, i) => `($1, $${i + 2})`).join(', ')
        await client.query(
          `INSERT INTO post_departments (post_id, department_id) VALUES ${placeholders}`,
          [post.id, ...safeDeptIds]
        )
      }

      // Fan-out notification rows
      let recipientRows: Array<{ id: string }>
      if (safeScope === 'DEPARTMENT' && safeDeptIds.length > 0) {
        const { rows: deptUsers } = await client.query(
          `SELECT id FROM users
           WHERE department_id = ANY($1::uuid[]) AND id != $2`,
          [safeDeptIds, authorId]
        )
        recipientRows = deptUsers as Array<{ id: string }>
      } else {
        const { rows: allUsers } = await client.query(
          `SELECT id FROM users WHERE id != $1`,
          [authorId]
        )
        recipientRows = allUsers as Array<{ id: string }>
      }

      // Batch notifications to stay under PostgreSQL's 65535-parameter limit
      for (let i = 0; i < recipientRows.length; i += NOTIFICATION_BATCH_SIZE) {
        const batch = recipientRows.slice(i, i + NOTIFICATION_BATCH_SIZE)
        const values = batch.map((_, j) => `($1, $2, $${j + 3}, 'NEW_POST')`).join(', ')
        await client.query(
          `INSERT INTO notifications (actor_id, post_id, user_id, type) VALUES ${values}
           ON CONFLICT DO NOTHING`,
          [authorId, post.id, ...batch.map(r => r.id)]
        )
      }

      await client.query(
        `INSERT INTO audit_log (actor_id, action, target_id, detail)
         VALUES ($1, 'POST_CREATE', $2, $3)`,
        [authorId, post.id, JSON.stringify({ title: title.trim(), post_type: safeType, visibility_scope: safeScope })]
      )

      await client.query('COMMIT')

      // Re-fetch full post shape so client gets the same shape as GET /api/posts.
      // postSelectSQL only references $1 (the viewer), so passing departmentId
      // as an unused $2 made Postgres reject the whole statement with
      // "could not determine data type of parameter $2" — turning every
      // successful create into a 500.
      const { rows: fullRows } = await query(
        `${postSelectSQL} WHERE p.id = $2`,
        [authorId, post.id]
      )

      // Scoped to actual recipients (+ author) — broadcastAll would tell users
      // outside a DEPARTMENT-scoped post's audience that a "new post" is
      // available, only for them to click the pill and see nothing (the
      // visibility check server-side still hides it), a dead-end interaction.
      sseManager.broadcast([...recipientRows.map(r => r.id), authorId], { type: 'NEW_POST', postId: post.id })
      // Push badge update to all recipients
      sseManager.broadcast(recipientRows.map(r => r.id), { type: 'NOTIFICATION' })

      res.status(201).json({ post: fullRows[0] ?? { id: post.id } })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  } catch (err) {
    next(err)
  }
})

// GET /api/posts/pinned — admin-pinned posts visible to all
router.get('/pinned', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId, departmentId, branchId, role } = (req as RequestWithUser).user
    const { rows } = await query(
      `${postSelectSQL}
       WHERE p.is_pinned = TRUE AND p.deleted_at IS NULL AND ${visibilitySQL(1, 2, 3, role === 'admin')}
       ORDER BY p.pinned_at DESC`,
      [userId, departmentId, branchId]
    )
    res.json({ posts: rows })
  } catch (err) { next(err) }
})

// POST /api/posts/views — mark posts as read/viewed. Idempotent.
// Batched: the feed marks posts read as they scroll past, so accepting an
// array turns a dozen round trips per session into one. A single id is just
// a batch of one (used when opening a post detail).
// Author's own views are skipped — the viewers list must not show the author,
// and postSelectSQL already treats own posts as read.
router.post('/views', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body as { ids?: unknown }
    if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids must be an array' })
    if (ids.length > MAX_VIEW_IDS) {
      return res.status(400).json({ error: `Cannot mark more than ${MAX_VIEW_IDS} posts at once` })
    }
    const safeIds = ids.filter((id): id is string => typeof id === 'string' && UUID_RE.test(id))
    if (safeIds.length === 0) return res.json({ ok: true })

    const { id: userId, departmentId, branchId, role } = (req as RequestWithUser).user
    await query(
      `INSERT INTO post_views (post_id, user_id)
       SELECT p.id, $2::uuid
       FROM posts p
       WHERE p.id = ANY($1::uuid[])
         AND p.deleted_at IS NULL
         AND p.author_id != $2::uuid
         AND ${visibilitySQL(2, 3, 4, role === 'admin')}
       ON CONFLICT DO NOTHING`,
      [safeIds, userId, departmentId, branchId]
    )
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// GET /api/posts/:id/views — viewer list with liked/commented flags; all authenticated users
router.get('/:id/views', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const postId = req.params.id as string
    if (!UUID_RE.test(postId)) return res.status(400).json({ error: 'Invalid post ID' })
    // Was unguarded: the full viewer roster (names + avatars) of a
    // DEPARTMENT-scoped post was readable by any authenticated user.
    const { id: userId, departmentId, branchId, role } = (req as RequestWithUser).user
    if (!await resolveVisiblePost(postId, userId, departmentId, branchId, role === 'admin')) {
      return res.status(404).json({ error: 'Post not found' })
    }
    const { limit, offset } = parsePage(req.query, 100, 200)
    const { rows } = await query(
      `SELECT u.id, u.full_name, u.avatar_url, pv.viewed_at,
              EXISTS(SELECT 1 FROM likes    WHERE post_id = $1 AND user_id = pv.user_id)                         AS liked,
              EXISTS(SELECT 1 FROM comments WHERE post_id = $1 AND author_id = pv.user_id AND deleted_at IS NULL) AS commented
       FROM post_views pv
       JOIN users u ON u.id = pv.user_id
       WHERE pv.post_id = $1
       ORDER BY pv.viewed_at DESC
       LIMIT $2 OFFSET $3`,
      [postId, limit, offset]
    )
    const { rows: totalRows } = await query(
      'SELECT COUNT(*)::int AS count FROM post_views WHERE post_id = $1', [postId]
    )
    res.json({ viewers: rows, total: (totalRows[0] as { count: number }).count })
  } catch (err) { next(err) }
})

// GET /api/posts/:id
router.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId, departmentId, branchId, role } = (req as RequestWithUser).user
    const { rows } = await query(
      `${postSelectSQL}
       WHERE p.id = $4 AND p.deleted_at IS NULL AND ${visibilitySQL(1, 2, 3, role === 'admin')}`,
      [userId, departmentId, branchId, req.params.id]
    )

    if (!rows[0]) return res.status(404).json({ error: 'Post not found' })
    res.json({ post: rows[0] })
  } catch (err) {
    next(err)
  }
})

// PUT /api/posts/:id
router.put('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { title, content, tags, cover_attachment_id, thumbnail_preset_id, thumbnail_emoji,
            category_ids, branch_id } = req.body as {
      title?: string; content?: string; tags?: unknown; cover_attachment_id?: string
      thumbnail_preset_id?: string | null; thumbnail_emoji?: string | null
      category_ids?: unknown; branch_id?: string | null
    }
    if (category_ids !== undefined) {
      if (!Array.isArray(category_ids)) return res.status(400).json({ error: 'category_ids must be an array' })
      if ((category_ids as unknown[]).length > MAX_CATEGORIES) {
        return res.status(400).json({ error: `Maximum ${MAX_CATEGORIES} categories allowed` })
      }
    }
    if (branch_id != null && !UUID_RE.test(branch_id)) {
      return res.status(400).json({ error: 'Invalid branch_id' })
    }
    const { id: userId, role, departmentId } = (req as RequestWithUser).user

    if (cover_attachment_id !== undefined && !UUID_RE.test(cover_attachment_id)) {
      return res.status(400).json({ error: 'Invalid cover_attachment_id' })
    }
    // null is meaningful here (clear the thumbnail), so only reject bad strings
    if (thumbnail_preset_id != null && !UUID_RE.test(thumbnail_preset_id)) {
      return res.status(400).json({ error: 'Invalid thumbnail_preset_id' })
    }

    if (title !== undefined && title.trim().length > MAX_TITLE_LEN) {
      return res.status(400).json({ error: `Title must be ${MAX_TITLE_LEN} characters or less` })
    }
    let safeTags: string[] | undefined
    if (tags !== undefined) {
      if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags must be an array' })
      if ((tags as unknown[]).length > MAX_TAGS) return res.status(400).json({ error: `Maximum ${MAX_TAGS} tags allowed` })
      safeTags = (tags as unknown[]).map(t => String(t).trim()).filter(Boolean)
      if (safeTags.some(t => t.length > MAX_TAG_LEN)) {
        return res.status(400).json({ error: `Each tag must be ${MAX_TAG_LEN} characters or less` })
      }
    }

    const { rows } = await query(
      `UPDATE posts
       SET title = COALESCE($3, title),
           content = COALESCE($4, content),
           tags = COALESCE($5::text[], tags),
           -- only accept a cover that actually belongs to this post
           cover_attachment_id = COALESCE(
             (SELECT a.id FROM attachments a WHERE a.id = $7 AND a.post_id = posts.id),
             cover_attachment_id),
           -- $8/$9 flags distinguish "not supplied" from an explicit null,
           -- so the author can clear a thumbnail as well as change it
           thumbnail_preset_id = CASE WHEN $8::boolean THEN $9::uuid ELSE thumbnail_preset_id END,
           thumbnail_emoji     = CASE WHEN $10::boolean THEN $11::text ELSE thumbnail_emoji END,
           branch_id           = CASE WHEN $12::boolean THEN $13::uuid ELSE branch_id END,
           updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
         AND ($2 = 'admin' OR author_id = $6)
       RETURNING id`,
      [
        req.params.id, role, title?.trim() ?? null, content?.trim() ?? null, safeTags ?? null, userId,
        cover_attachment_id ?? null,
        thumbnail_preset_id !== undefined, thumbnail_preset_id ?? null,
        thumbnail_emoji !== undefined, thumbnail_emoji?.trim().slice(0, MAX_EMOJI_LEN) || null,
        branch_id !== undefined, branch_id ?? null,
      ]
    )

    if (!rows[0]) return res.status(404).json({ error: 'Post not found or not authorized' })

    // Categories are replaced wholesale when supplied — an omitted field leaves
    // them untouched, an empty array clears them.
    if (category_ids !== undefined) {
      const safeIds = (category_ids as unknown[]).map(String).filter(id => UUID_RE.test(id))
      await query('DELETE FROM post_categories WHERE post_id = $1', [req.params.id])
      if (safeIds.length > 0) {
        const values = safeIds.map((_, i) => `($1, $${i + 2}::uuid)`).join(', ')
        await query(
          `INSERT INTO post_categories (post_id, category_id) VALUES ${values} ON CONFLICT DO NOTHING`,
          [req.params.id, ...safeIds]
        )
      }
    }

    // Re-fetch full post shape so client gets the same shape as GET /api/posts.
    // Only $1 (the viewer) is referenced by postSelectSQL — see the note in the
    // create handler; an unused $2 makes Postgres reject the statement.
    const { rows: fullRows } = await query(
      `${postSelectSQL} WHERE p.id = $2 AND p.deleted_at IS NULL`,
      [userId, req.params.id]
    )
    res.json({ post: fullRows[0] ?? null })
  } catch (err) {
    next(err)
  }
})

// POST /api/posts/:id/notify — author re-sends NEW_POST notifications
// Rate-limited: each press inserts a row per recipient and queues an email +
// Chat message for each, with no dedupe of its own — unbounded, it is a spam
// button pointed at the whole company.
router.post('/:id/notify', requireAuth, postCreateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!UUID_RE.test(req.params.id as string)) return res.status(400).json({ error: 'Invalid post ID' })
    const { id: userId, role } = (req as RequestWithUser).user

    const { rows: postRows } = await query(
      `SELECT author_id, visibility_scope FROM posts WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    )
    const post = postRows[0] as { author_id: string; visibility_scope: string } | undefined
    if (!post) return res.status(404).json({ error: 'Post not found' })
    if (post.author_id !== userId && role !== 'admin') return res.status(403).json({ error: 'Forbidden' })

    let recipientRows: Array<{ id: string }>
    if (post.visibility_scope === 'DEPARTMENT') {
      const { rows } = await query(
        `SELECT DISTINCT u.id FROM users u
         JOIN post_departments pd ON pd.department_id = u.department_id
         WHERE pd.post_id = $1 AND u.id != $2`,
        [req.params.id, userId]
      )
      recipientRows = rows as Array<{ id: string }>
    } else {
      const { rows } = await query(`SELECT id FROM users WHERE id != $1`, [userId])
      recipientRows = rows as Array<{ id: string }>
    }

    for (let i = 0; i < recipientRows.length; i += NOTIFICATION_BATCH_SIZE) {
      const batch = recipientRows.slice(i, i + NOTIFICATION_BATCH_SIZE)
      const values = batch.map((_, j) => `($1, $2, $${j + 3}, 'NEW_POST')`).join(', ')
      await query(
        `INSERT INTO notifications (actor_id, post_id, user_id, type) VALUES ${values}`,
        [userId, req.params.id, ...batch.map(r => r.id)]
      )
    }

    sseManager.broadcast(recipientRows.map(r => r.id), { type: 'NOTIFICATION' })
    res.json({ ok: true, notified: recipientRows.length })
  } catch (err) { next(err) }
})

// DELETE /api/posts/:id (soft delete)
router.delete('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId, role } = (req as RequestWithUser).user

    const { rows } = await query(
      `UPDATE posts SET deleted_at = now(), deleted_by = $1
       WHERE id = $2 AND deleted_at IS NULL
         AND ($3 = 'admin' OR author_id = $1)
       RETURNING id`,
      [userId, req.params.id, role]
    )

    if (!rows[0]) return res.status(404).json({ error: 'Post not found or not authorized' })
    logAudit(userId, 'POST_DELETE', req.params.id as string, { deleted_by_role: role })
    sseManager.broadcastAll({ type: 'DELETE_POST', postId: req.params.id })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
