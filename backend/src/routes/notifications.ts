import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { query } from '../config/db.js'
import { requireAuth } from '../middleware/auth.js'
import type { RequestWithUser } from '../types.js'

const router = Router()

router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query(
      `SELECT n.id, n.post_id, n.type, n.read_at, n.created_at,
              p.title AS post_title, p.post_type,
              u.id AS actor_id, u.full_name AS actor_name
       FROM notifications n
       JOIN posts p ON p.id = n.post_id AND p.deleted_at IS NULL
       LEFT JOIN users u ON u.id = n.actor_id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT 50`,
      [(req as RequestWithUser).user.id]
    )
    res.json({ notifications: rows })
  } catch (err) {
    next(err)
  }
})

router.post('/read', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { ids } = req.body as { ids?: string[] }
    if (Array.isArray(ids) && ids.length > 0) {
      await query(
        `UPDATE notifications SET read_at = now()
         WHERE user_id = $1 AND id = ANY($2::uuid[]) AND read_at IS NULL`,
        [(req as RequestWithUser).user.id, ids]
      )
    } else {
      await query(
        `UPDATE notifications SET read_at = now()
         WHERE user_id = $1 AND read_at IS NULL`,
        [(req as RequestWithUser).user.id]
      )
    }
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
