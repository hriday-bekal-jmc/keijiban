import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { query } from '../config/db.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { sseManager } from '../services/sse.js'
import type { RequestWithUser } from '../types.js'

const router = Router()

// GET /api/admin/departments — available to all auth'd users (for composer dept picker)
router.get('/departments', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query('SELECT id, name FROM departments ORDER BY name')
    res.json({ departments: rows })
  } catch (err) { next(err) }
})

// PUT /api/admin/departments — admin only
router.post('/departments', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body as { name?: string }
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' })
    const { rows } = await query(
      'INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *',
      [name.trim()]
    )
    res.status(201).json({ department: rows[0] })
  } catch (err) { next(err) }
})

// GET /api/admin/users
router.get('/users', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.full_name, u.avatar_url, u.role,
              u.department_id, d.name AS department_name, u.created_at
       FROM users u JOIN departments d ON d.id = u.department_id
       ORDER BY u.created_at DESC`
    )
    res.json({ users: rows })
  } catch (err) { next(err) }
})

// PUT /api/admin/users/:id — change dept, role, deactivate
router.put('/users/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { department_id, role, full_name, can_post } = req.body as {
      department_id?: string
      role?: 'member' | 'admin'
      full_name?: string
      can_post?: boolean
    }
    const { rows } = await query(
      `UPDATE users
       SET department_id = COALESCE($2, department_id),
           role          = COALESCE($3, role),
           full_name     = COALESCE($4, full_name),
           can_post      = COALESCE($5, can_post),
           updated_at    = now()
       WHERE id = $1
       RETURNING id, full_name, role, department_id, can_post`,
      [req.params.id, department_id ?? null, role ?? null, full_name ?? null, can_post ?? null]
    )
    if (!rows[0]) return res.status(404).json({ error: 'User not found' })

    await query(
      `INSERT INTO audit_log (actor_id, action, target_id, detail)
       VALUES ($1, 'USER_UPDATE', $2, $3)`,
      [(req as RequestWithUser).user.id, req.params.id, JSON.stringify(req.body)]
    )

    res.json({ user: rows[0] })
  } catch (err) { next(err) }
})

// POST /api/admin/posts/:id/pin — pin a post
router.post('/posts/:id/pin', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actorId = (req as RequestWithUser).user.id
    const { rows } = await query(
      `UPDATE posts SET is_pinned = TRUE, pinned_at = now(), pinned_by = $2
       WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [req.params.id as string, actorId]
    )
    if (!rows[0]) return res.status(404).json({ error: 'Post not found' })
    await query(
      `INSERT INTO audit_log (actor_id, action, target_id) VALUES ($1, 'POST_PIN', $2)`,
      [actorId, req.params.id]
    )
    sseManager.broadcastAll({ type: 'PIN_POST', postId: req.params.id as string, isPinned: true })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// DELETE /api/admin/posts/:id/pin — unpin a post
router.delete('/posts/:id/pin', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actorId = (req as RequestWithUser).user.id
    const { rows } = await query(
      `UPDATE posts SET is_pinned = FALSE, pinned_at = NULL, pinned_by = NULL
       WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [req.params.id as string]
    )
    if (!rows[0]) return res.status(404).json({ error: 'Post not found' })
    await query(
      `INSERT INTO audit_log (actor_id, action, target_id) VALUES ($1, 'POST_UNPIN', $2)`,
      [actorId, req.params.id]
    )
    sseManager.broadcastAll({ type: 'PIN_POST', postId: req.params.id as string, isPinned: false })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// GET /api/admin/audit-log
router.get('/audit-log', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { action, actor_id, limit = '60', offset = '0' } = req.query as Record<string, string | undefined>
    const params: unknown[] = [parseInt(limit) || 60, parseInt(offset) || 0]
    const conditions: string[] = []

    if (action) { params.push(action.toUpperCase()); conditions.push(`a.action = $${params.length}`) }
    if (actor_id) { params.push(actor_id); conditions.push(`a.actor_id = $${params.length}::uuid`) }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const { rows } = await query(
      `SELECT
         a.id, a.action, a.target_id, a.detail, a.created_at,
         u.id        AS actor_id,
         u.full_name AS actor_name,
         u.email     AS actor_email,
         p.title     AS target_post_title
       FROM audit_log a
       JOIN users u ON u.id = a.actor_id
       LEFT JOIN posts p ON p.id = a.target_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    )

    res.json({ logs: rows })
  } catch (err) { next(err) }
})

export default router
