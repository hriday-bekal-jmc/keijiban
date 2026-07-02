import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { query, visibilitySQL, UUID_RE, resolveVisiblePost, parsePage, logAudit } from '../config/db.js'
import { requireAuth } from '../middleware/auth.js'
import type { RequestWithUser } from '../types.js'

const router = Router()

// GET /api/bookmarks — current user's saved posts (paginated)
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId } = (req as RequestWithUser).user
    const { limit, offset } = parsePage(req.query, 30, 100)

    const { rows } = await query(
      `SELECT p.id, p.title, p.content, p.post_type, p.visibility_scope,
              p.tags, p.created_at, p.event_date, p.is_pinned,
              u.id AS author_id, u.full_name AS author_name, d.name AS author_dept,
              b.created_at AS bookmarked_at,
              COUNT(DISTINCT l.user_id)::int AS likes_count,
              COUNT(DISTINCT c.id)::int AS comments_count
       FROM bookmarks b
       JOIN posts p ON p.id = b.post_id AND p.deleted_at IS NULL
       JOIN users u ON u.id = p.author_id
       JOIN departments d ON d.id = u.department_id
       LEFT JOIN likes l ON l.post_id = p.id
       LEFT JOIN comments c ON c.post_id = p.id AND c.deleted_at IS NULL
       WHERE b.user_id = $1
       GROUP BY p.id, u.id, d.name, b.created_at
       ORDER BY b.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    )
    res.json({ bookmarks: rows })
  } catch (err) { next(err) }
})

// POST /api/bookmarks/:postId — save a post
router.post('/:postId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId, departmentId } = (req as RequestWithUser).user
    const postId = req.params.postId as string

    if (!UUID_RE.test(postId)) return res.status(400).json({ error: 'Invalid post ID' })

    const post = await resolveVisiblePost(postId, userId, departmentId)
    if (!post) return res.status(404).json({ error: 'Post not found' })

    await query(
      `INSERT INTO bookmarks (user_id, post_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [userId, postId]
    )
    logAudit(userId, 'POST_BOOKMARK', postId)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// DELETE /api/bookmarks/:postId — unsave a post
router.delete('/:postId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId } = (req as RequestWithUser).user
    const postId = req.params.postId as string

    if (!UUID_RE.test(postId)) return res.status(400).json({ error: 'Invalid post ID' })

    await query(
      `DELETE FROM bookmarks WHERE user_id = $1 AND post_id = $2`,
      [userId, postId]
    )
    logAudit(userId, 'POST_UNBOOKMARK', postId)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// GET /api/bookmarks/events — upcoming + past events (posts with event_date), capped at 200
// $1=userId, $2=departmentId match the original visibilitySQL param order
router.get('/events', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId, departmentId } = (req as RequestWithUser).user
    const { rows } = await query(
      `SELECT p.id, p.title, p.content, p.post_type, p.visibility_scope,
              p.tags, p.created_at, p.event_date,
              u.id AS author_id, u.full_name AS author_name, d.name AS author_dept
       FROM posts p
       JOIN users u ON u.id = p.author_id
       JOIN departments d ON d.id = u.department_id
       WHERE p.event_date IS NOT NULL AND p.deleted_at IS NULL
         AND ${visibilitySQL(1, 2)}
       ORDER BY p.event_date ASC
       LIMIT 200`,
      [userId, departmentId]
    )
    res.json({ events: rows })
  } catch (err) { next(err) }
})

export default router
