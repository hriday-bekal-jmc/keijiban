import { Router, Request, Response, NextFunction } from 'express'
import { query, pool, visibilitySQL, UUID_RE, VIBE_TODAY_SQL, logAudit, resolveVisiblePost } from '../config/db.js'
import { requireAuth } from '../middleware/auth.js'
import { commentCreateLimiter } from '../middleware/rateLimits.js'
import { sseManager } from '../services/sse.js'
import type { RequestWithUser } from '../types.js'

const router = Router({ mergeParams: true })

const MAX_COMMENT_LENGTH = 2000

router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    // The POST handler below checks visibility but this one did not, so any
    // authenticated user could read the comments on a DEPARTMENT-scoped post
    // they cannot see just by knowing its id.
    const postId = req.params.postId as string
    if (!UUID_RE.test(postId)) return res.status(400).json({ error: 'Invalid post ID' })
    const { id: userId, departmentId, branchId, role } = (req as RequestWithUser).user
    if (!await resolveVisiblePost(postId, userId, departmentId, branchId, role === 'admin')) {
      return res.status(404).json({ error: 'Post not found' })
    }

    const { rows } = await query(
      `SELECT c.id, c.content, c.created_at, c.updated_at,
              u.id AS author_id, u.full_name AS author_name, u.avatar_url AS author_avatar,
              CASE WHEN ${VIBE_TODAY_SQL} THEN u.vibe_emoji ELSE NULL END AS author_vibe_emoji,
              CASE WHEN ${VIBE_TODAY_SQL} THEN u.vibe_label ELSE NULL END AS author_vibe_label
       FROM comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.post_id = $1 AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC
       LIMIT 500`,
      [postId]
    )
    res.json({ comments: rows })
  } catch (err) {
    next(err)
  }
})

router.post('/', requireAuth, commentCreateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body as { content?: string }
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' })
    if (content.trim().length > MAX_COMMENT_LENGTH) {
      return res.status(400).json({ error: `Comment must be ${MAX_COMMENT_LENGTH} characters or less` })
    }

    const authReq = req as RequestWithUser
    const { id: userId, departmentId, branchId, role } = authReq.user
    const postId = req.params.postId as string

    if (!UUID_RE.test(postId)) return res.status(400).json({ error: 'Invalid post ID' })

    const trimmed = content.trim()

    const client = await pool.connect()
    try {
      await client.query('BEGIN')

      // Verify post exists and is visible to the commenter
      const { rows: postRows } = await client.query(
        `SELECT author_id FROM posts p WHERE p.id = $1 AND p.deleted_at IS NULL AND ${visibilitySQL(2, 3, 4, role === 'admin')}`,
        [postId, userId, departmentId, branchId]
      )
      if (!postRows[0]) {
        await client.query('ROLLBACK')
        return res.status(404).json({ error: 'Post not found' })
      }
      const postAuthorId = (postRows[0] as { author_id: string }).author_id

      const { rows } = await client.query(
        `INSERT INTO comments (post_id, author_id, content)
         VALUES ($1, $2, $3)
         RETURNING id, content, created_at`,
        [postId, userId, trimmed]
      )

      // Notify post author (skip if author is the commenter)
      if (postAuthorId !== userId) {
        await client.query(
          `INSERT INTO notifications (actor_id, post_id, user_id, type)
           VALUES ($1, $2, $3, 'NEW_COMMENT')
           ON CONFLICT DO NOTHING`,
          [userId, postId, postAuthorId]
        )
      }

      await client.query(
        `INSERT INTO audit_log (actor_id, action, target_id, detail)
         VALUES ($1, 'COMMENT_ADD', $2, $3)`,
        [userId, postId, JSON.stringify({ comment_preview: trimmed.slice(0, 100) })]
      )

      await client.query('COMMIT')

      const { rows: countRows } = await query(
        'SELECT COUNT(*)::int AS count FROM comments WHERE post_id = $1 AND deleted_at IS NULL',
        [postId]
      )
      sseManager.broadcastAll({
        type: 'NEW_COMMENT',
        postId,
        count: (countRows[0] as { count: number }).count,
      })
      // Push real-time badge update to post author
      if (postAuthorId !== userId) {
        sseManager.send(postAuthorId, { type: 'NOTIFICATION' })
      }

      res.status(201).json({ comment: rows[0] })
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

router.put('/:commentId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body as { content?: string }
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' })
    if (content.trim().length > MAX_COMMENT_LENGTH) {
      return res.status(400).json({ error: `Comment must be ${MAX_COMMENT_LENGTH} characters or less` })
    }

    const { rows } = await query(
      `UPDATE comments SET content = $1, updated_at = now()
       WHERE id = $2 AND deleted_at IS NULL AND author_id = $3
       RETURNING id`,
      [content.trim(), req.params.commentId, (req as RequestWithUser).user.id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'Comment not found or not authorized' })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

router.delete('/:commentId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId, role } = (req as RequestWithUser).user

    const { rows } = await query(
      `UPDATE comments SET deleted_at = now(), deleted_by = $1
       WHERE id = $2 AND deleted_at IS NULL
         AND ($3 = 'admin' OR author_id = $1)
       RETURNING id`,
      [userId, req.params.commentId, role]
    )
    if (!rows[0]) return res.status(404).json({ error: 'Comment not found or not authorized' })

    logAudit(userId, 'COMMENT_DELETE', req.params.postId as string, { comment_id: req.params.commentId })

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
