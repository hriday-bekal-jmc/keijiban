import { Router, Request, Response, NextFunction } from 'express'
import { query } from '../config/db.js'
import { requireAuth } from '../middleware/auth.js'
import { sseManager } from '../services/sse.js'
import type { RequestWithUser } from '../types.js'

const router = Router({ mergeParams: true })

router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.content, c.created_at, c.updated_at,
              u.id AS author_id, u.full_name AS author_name, u.avatar_url AS author_avatar,
              CASE WHEN date_trunc('day', u.vibe_set_at AT TIME ZONE 'Asia/Tokyo')
                        = date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo')
                   THEN u.vibe_emoji ELSE NULL END AS author_vibe_emoji,
              CASE WHEN date_trunc('day', u.vibe_set_at AT TIME ZONE 'Asia/Tokyo')
                        = date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo')
                   THEN u.vibe_label ELSE NULL END AS author_vibe_label
       FROM comments c
       JOIN users u ON u.id = c.author_id
       WHERE c.post_id = $1 AND c.deleted_at IS NULL
       ORDER BY c.created_at ASC`,
      [req.params.postId]
    )
    res.json({ comments: rows })
  } catch (err) {
    next(err)
  }
})

router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body as { content?: string }
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' })

    const authReq = req as RequestWithUser

    const { rows } = await query(
      `INSERT INTO comments (post_id, author_id, content)
       VALUES ($1, $2, $3)
       RETURNING id, content, created_at`,
      [req.params.postId, authReq.user.id, content.trim()]
    )

    // Audit log
    await query(
      `INSERT INTO audit_log (actor_id, action, target_id, detail)
       VALUES ($1, 'COMMENT_ADD', $2, $3)`,
      [authReq.user.id, req.params.postId, JSON.stringify({ comment_preview: content.trim().slice(0, 100) })]
    ).catch(() => {})

    // Notify post author (skip if author is the commenter)
    const { rows: postRows } = await query(
      `SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.postId]
    )
    const postRow = postRows[0] as { author_id: string } | undefined
    if (postRow && postRow.author_id !== authReq.user.id) {
      await query(
        `INSERT INTO notifications (actor_id, post_id, user_id, type)
         VALUES ($1, $2, $3, 'NEW_COMMENT')
         ON CONFLICT DO NOTHING`,
        [authReq.user.id, req.params.postId, postRow.author_id]
      )
    }

    const { rows: countRows } = await query(
      'SELECT COUNT(*)::int AS count FROM comments WHERE post_id = $1 AND deleted_at IS NULL',
      [req.params.postId]
    )
    sseManager.broadcastAll({
      type: 'NEW_COMMENT',
      postId: req.params.postId,
      count: (countRows[0] as { count: number }).count,
    })

    res.status(201).json({ comment: rows[0] })
  } catch (err) {
    next(err)
  }
})

router.put('/:commentId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { content } = req.body as { content?: string }
    if (!content?.trim()) return res.status(400).json({ error: 'Content required' })

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

    // Audit log (use post_id from params as target so log can display post title)
    await query(
      `INSERT INTO audit_log (actor_id, action, target_id, detail)
       VALUES ($1, 'COMMENT_DELETE', $2, $3)`,
      [userId, req.params.postId, JSON.stringify({ comment_id: req.params.commentId })]
    ).catch(() => {})

    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
