import { Router, Request, Response, NextFunction } from 'express'
import { query, pool } from '../config/db.js'
import { requireAuth } from '../middleware/auth.js'
import { sseManager } from '../services/sse.js'
import type { RequestWithUser } from '../types.js'

const router = Router()

// Visibility filter used in all post queries — single chokepoint per §3.4
const visibilitySQL = `(
  p.visibility_scope = 'COMPANY_WIDE'
  OR EXISTS (
    SELECT 1 FROM post_departments pd
    WHERE pd.post_id = p.id AND pd.department_id = $2
  )
  OR p.author_id = $1
)`

// No GROUP BY: correlated subqueries for counts avoid the N×M fan-out that
// LEFT JOIN likes × LEFT JOIN comments creates when posts have many engagements.
// Each subquery does a single PK/index scan per row instead of a cross-join.
const postSelectSQL = `
  SELECT
    p.id, p.title, p.content, p.post_type, p.visibility_scope,
    p.tags, p.created_at, p.updated_at, p.event_date, p.is_pinned,
    u.id         AS author_id,
    u.full_name  AS author_name,
    u.avatar_url AS author_avatar,
    d.name       AS author_dept,
    (SELECT COUNT(*)::int FROM likes    WHERE post_id = p.id)                       AS likes_count,
    (SELECT COUNT(*)::int FROM comments WHERE post_id = p.id AND deleted_at IS NULL) AS comments_count,
    EXISTS(SELECT 1 FROM likes     WHERE post_id = p.id AND user_id = $1) AS liked_by_me,
    EXISTS(SELECT 1 FROM bookmarks WHERE post_id = p.id AND user_id = $1) AS is_bookmarked_by_me,
    (SELECT COALESCE(
      json_agg(json_build_object(
        'id',             att.id,
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
`

// GET /api/posts
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { cursor_created_at, cursor_id, type, q, tag, limit = '15' } = req.query as Record<string, string | undefined>
    const { id: userId, departmentId } = (req as RequestWithUser).user
    const pageSize = Math.min(parseInt(limit ?? '15') || 15, 50)

    const params: unknown[] = [userId, departmentId, pageSize]
    const conditions: string[] = [`p.deleted_at IS NULL`, visibilitySQL]

    if (cursor_created_at && cursor_id) {
      params.push(cursor_created_at, cursor_id)
      conditions.push(`(p.created_at, p.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`)
    }

    if (type) {
      params.push(type.toUpperCase())
      conditions.push(`p.post_type = $${params.length}`)
    }

    if (q?.trim()) {
      params.push(`%${q.trim()}%`)
      conditions.push(`(p.title ILIKE $${params.length} OR p.content ILIKE $${params.length})`)
    }

    if (tag?.trim()) {
      params.push(tag.trim())
      conditions.push(`$${params.length} = ANY(p.tags)`)
    }

    const { rows } = await query(
      `${postSelectSQL}
       WHERE ${conditions.join(' AND ')}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $3`,
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
router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      title, content, post_type, visibility_scope,
      tags = [], department_ids = [], event_date = null,
    } = req.body as {
      title?: string
      content?: string
      post_type?: string
      visibility_scope?: string
      tags?: string[]
      department_ids?: string[]
      event_date?: string | null
    }

    if (!(req as RequestWithUser).user.canPost) {
      return res.status(403).json({ error: '投稿権限がありません' })
    }

    if (!title?.trim() || !content?.trim()) {
      return res.status(400).json({ error: 'Title and content required' })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      const { rows } = await client.query(
        `INSERT INTO posts (author_id, title, content, post_type, visibility_scope, tags, event_date)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [(req as RequestWithUser).user.id, title.trim(), content.trim(), post_type, visibility_scope, tags, event_date ?? null]
      )
      const post = rows[0] as { id: string }

      if (visibility_scope === 'DEPARTMENT' && department_ids.length > 0) {
        for (const deptId of department_ids) {
          await client.query(
            'INSERT INTO post_departments (post_id, department_id) VALUES ($1, $2)',
            [post.id, deptId]
          )
        }
      }

      // Fan-out notification rows
      let recipientRows: Array<{ id: string }>
      if (visibility_scope === 'DEPARTMENT' && department_ids.length > 0) {
        const { rows: deptUsers } = await client.query(
          `SELECT id FROM users
           WHERE department_id = ANY($1::uuid[]) AND id != $2`,
          [department_ids, (req as RequestWithUser).user.id]
        )
        recipientRows = deptUsers as Array<{ id: string }>
      } else {
        const { rows: allUsers } = await client.query(
          `SELECT id FROM users WHERE id != $1`,
          [(req as RequestWithUser).user.id]
        )
        recipientRows = allUsers as Array<{ id: string }>
      }

      if (recipientRows.length > 0) {
        const values = recipientRows
          .map((_, i) => `($1, $2, $${i + 3}, 'NEW_POST')`)
          .join(', ')
        await client.query(
          `INSERT INTO notifications (actor_id, post_id, user_id, type) VALUES ${values}`,
          [(req as RequestWithUser).user.id, post.id, ...recipientRows.map(r => r.id)]
        )
      }

      await client.query(
        `INSERT INTO audit_log (actor_id, action, target_id, detail)
         VALUES ($1, 'POST_CREATE', $2, $3)`,
        [(req as RequestWithUser).user.id, post.id,
          JSON.stringify({ title: title.trim(), post_type, visibility_scope })]
      )

      await client.query('COMMIT')

      sseManager.broadcastAll({ type: 'NEW_POST', postId: post.id })

      res.status(201).json({ post })
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
    const { id: userId, departmentId } = (req as RequestWithUser).user
    const { rows } = await query(
      `${postSelectSQL}
       WHERE p.is_pinned = TRUE AND p.deleted_at IS NULL AND ${visibilitySQL}
       GROUP BY p.id, u.id, d.name
       ORDER BY p.pinned_at DESC`,
      [userId, departmentId]
    )
    res.json({ posts: rows })
  } catch (err) { next(err) }
})

// GET /api/posts/:id
router.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId, departmentId } = (req as RequestWithUser).user

    const { rows } = await query(
      `${postSelectSQL}
       WHERE p.id = $3 AND p.deleted_at IS NULL AND ${visibilitySQL}
       GROUP BY p.id, u.id, d.name`,
      [userId, departmentId, req.params.id]
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
    const { title, content, tags } = req.body as { title?: string; content?: string; tags?: string[] }
    const { id: userId, role } = (req as RequestWithUser).user

    const { rows } = await query(
      `UPDATE posts
       SET title = COALESCE($3, title),
           content = COALESCE($4, content),
           tags = COALESCE($5, tags),
           updated_at = now()
       WHERE id = $1 AND deleted_at IS NULL
         AND ($2 = 'admin' OR author_id = $6)
       RETURNING id`,
      [req.params.id, role, title?.trim(), content?.trim(), tags, userId]
    )

    if (!rows[0]) return res.status(404).json({ error: 'Post not found or not authorized' })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
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
    await query(
      `INSERT INTO audit_log (actor_id, action, target_id, detail)
       VALUES ($1, 'POST_DELETE', $2, $3)`,
      [userId, req.params.id, JSON.stringify({ deleted_by_role: role })]
    )
    sseManager.broadcastAll({ type: 'DELETE_POST', postId: req.params.id })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
