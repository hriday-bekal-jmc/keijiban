import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { query } from '../config/db.js'
import { requireAuth } from '../middleware/auth.js'
import { sseManager } from '../services/sse.js'
import type { RequestWithUser } from '../types.js'

const router = Router({ mergeParams: true })

router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as RequestWithUser).user.id
    await query(
      'INSERT INTO likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.params.postId, userId]
    )
    const { rows } = await query(
      'SELECT COUNT(*)::int AS count FROM likes WHERE post_id = $1',
      [req.params.postId]
    )
    sseManager.broadcastAll({ type: 'LIKE', postId: req.params.postId, count: (rows[0] as { count: number }).count })
    await query(
      `INSERT INTO audit_log (actor_id, action, target_id) VALUES ($1, 'POST_LIKE', $2)`,
      [userId, req.params.postId]
    ).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

router.delete('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as RequestWithUser).user.id
    await query(
      'DELETE FROM likes WHERE post_id = $1 AND user_id = $2',
      [req.params.postId, userId]
    )
    const { rows } = await query(
      'SELECT COUNT(*)::int AS count FROM likes WHERE post_id = $1',
      [req.params.postId]
    )
    sseManager.broadcastAll({ type: 'UNLIKE', postId: req.params.postId, count: (rows[0] as { count: number }).count })
    await query(
      `INSERT INTO audit_log (actor_id, action, target_id) VALUES ($1, 'POST_UNLIKE', $2)`,
      [userId, req.params.postId]
    ).catch(() => {})
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
