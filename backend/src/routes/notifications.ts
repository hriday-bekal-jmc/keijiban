import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { query, parsePage } from '../config/db.js'
import { requireAuth } from '../middleware/auth.js'
import type { RequestWithUser } from '../types.js'

const router = Router()

const MAX_IDS_PER_REQUEST = 100

router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit, offset } = parsePage(req.query, 50, 100)

    const { rows } = await query(
      `SELECT n.id, n.post_id, n.type, n.read_at, n.created_at,
              p.title AS post_title, p.post_type,
              u.id AS actor_id, u.full_name AS actor_name
       FROM notifications n
       JOIN posts p ON p.id = n.post_id AND p.deleted_at IS NULL
       LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2 OFFSET $3`,
      [(req as RequestWithUser).user.id, limit, offset]
    )
    res.json({ notifications: rows })
  } catch (err) {
    next(err)
  }
})

router.post('/read', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body as { ids?: unknown }
    const userId = (req as RequestWithUser).user.id

    if (Array.isArray(ids) && ids.length > 0) {
      if (ids.length > MAX_IDS_PER_REQUEST) {
        return res.status(400).json({ error: `Cannot mark more than ${MAX_IDS_PER_REQUEST} notifications at once` })
      }
      // Ensure all entries are strings before passing to PostgreSQL
      const safeIds = ids.filter(id => typeof id === 'string')
      if (safeIds.length === 0) return res.json({ ok: true })

      await query(
        `UPDATE notifications SET read_at = now()
         WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL`,
        [userId, safeIds]
      )
    } else {
      // Mark all unread as read
      await query(
        `UPDATE notifications SET read_at = now()
         WHERE user_id = $1 AND read_at IS NULL`,
        [userId]
      )
    }
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
