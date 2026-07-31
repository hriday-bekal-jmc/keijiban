import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { query, UUID_RE, resolveVisiblePost } from '../config/db.js'
import { requireAuth } from '../middleware/auth.js'
import { sseManager } from '../services/sse.js'
import type { RequestWithUser } from '../types.js'

const router = Router({ mergeParams: true })

router.post('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId, departmentId, branchId, role } = (req as RequestWithUser).user
    const postId = req.params.postId as string

    if (!UUID_RE.test(postId)) return res.status(400).json({ error: 'Invalid post ID' })

    const post = await resolveVisiblePost(postId, userId, departmentId, branchId, role === 'admin')
    if (!post) return res.status(404).json({ error: 'Post not found' })

    await query(
      'INSERT INTO likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [postId, userId]
    )
    const { rows } = await query(
      'SELECT COUNT(*)::int AS count FROM likes WHERE post_id = $1',
      [postId]
    )
    sseManager.broadcastAll({ type: 'LIKE', postId, count: (rows[0] as { count: number }).count })
    // Notify post author (skip self-like)
    if (post.author_id !== userId) {
      query(
        `INSERT INTO notifications (actor_id, post_id, user_id, type)
         VALUES ($1, $2, $3, 'LIKE') ON CONFLICT DO NOTHING`,
        [userId, postId, post.author_id]
      ).then(() => sseManager.send(post.author_id, { type: 'NOTIFICATION' }))
       .catch(err => console.error('[notif] LIKE:', err))
    }
    // Not audited: likes/unlikes are not security events, and auditing them
    // was the single largest source of audit_log growth.
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

router.delete('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId, departmentId, branchId, role } = (req as RequestWithUser).user
    const postId = req.params.postId as string

    if (!UUID_RE.test(postId)) return res.status(400).json({ error: 'Invalid post ID' })

    const post = await resolveVisiblePost(postId, userId, departmentId, branchId, role === 'admin')
    if (!post) return res.status(404).json({ error: 'Post not found' })

    await query(
      'DELETE FROM likes WHERE post_id = $1 AND user_id = $2',
      [postId, userId]
    )
    const { rows } = await query(
      'SELECT COUNT(*)::int AS count FROM likes WHERE post_id = $1',
      [postId]
    )
    sseManager.broadcastAll({ type: 'UNLIKE', postId, count: (rows[0] as { count: number }).count })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

export default router
