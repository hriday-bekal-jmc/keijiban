import { Router, Request, Response, NextFunction } from 'express'
import { OAuth2Client } from 'google-auth-library'
import { query, pool } from '../config/db.js'
import { createToken, requireAuth } from '../middleware/auth.js'
import { env } from '../config/env.js'
import type { RequestWithUser } from '../types.js'

const router = Router()
const googleClient = new OAuth2Client(env.googleClientId)

router.post('/google', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { idToken } = req.body as { idToken?: string }
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' })

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.googleClientId,
    })
    const payload = ticket.getPayload()
    if (!payload) return res.status(400).json({ error: 'Invalid token payload' })

    const emailOk = payload.email?.endsWith(`@${env.allowedDomain}`) && payload.email_verified
    // In dev allow any verified Google account so you can test without a Workspace account
    if (!emailOk && !env.isDev) {
      console.warn('[auth] blocked:', payload.email, 'hd:', payload.hd)
      return res.status(403).json({ error: 'Access restricted to JMC accounts' })
    }
    if (!emailOk && env.isDev) {
      console.warn('[auth] DEV MODE: allowing non-JMC account:', payload.email)
    }

    const isSuperAdmin = env.superAdminEmails.has((payload.email ?? '').toLowerCase())

    // Upsert user — department_id falls back to first dept for new users
    // Super admins are always forced to role='admin' on every login
    const { rows } = await query(
      `INSERT INTO users (google_id, email, full_name, avatar_url, department_id, role)
       VALUES ($1, $2, $3, $4, (SELECT id FROM departments ORDER BY created_at LIMIT 1), $5)
       ON CONFLICT (google_id) DO UPDATE
         SET full_name  = EXCLUDED.full_name,
             avatar_url = CASE
               WHEN users.avatar_url IS NULL
                 OR users.avatar_url LIKE 'https://lh3.googleusercontent.com%'
                 OR users.avatar_url LIKE 'https://lh%ggpht.com%'
               THEN EXCLUDED.avatar_url
               ELSE users.avatar_url
             END,
             role       = CASE WHEN $5 = 'admin' THEN 'admin'::VARCHAR ELSE users.role END,
             updated_at = now()
       RETURNING id, email, full_name, avatar_url, role, department_id, can_post`,
      [payload.sub, payload.email, payload.name, payload.picture, isSuperAdmin ? 'admin' : 'member']
    )

    const user = rows[0] as {
      id: string
      email: string
      full_name: string
      avatar_url: string
      role: 'member' | 'admin'
      department_id: string
      can_post: boolean
    }
    const token = createToken({
      id: user.id,
      email: user.email,
      role: user.role,
      departmentId: user.department_id,
      canPost: user.can_post,
    })

    res.cookie('session', token, {
      httpOnly: true,
      secure: !env.isDev,
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
    })

    res.json({ user })
  } catch (err) {
    next(err)
  }
})

router.post('/logout', requireAuth, (req: Request, res: Response) => {
  res.clearCookie('session')
  res.json({ ok: true })
})

router.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.full_name, u.avatar_url, u.role, u.can_post,
              u.email_notifications, u.in_app_notifications,
              u.department_id, d.name AS department_name
       FROM users u
       JOIN departments d ON d.id = u.department_id
       WHERE u.id = $1`,
      [(req as RequestWithUser).user.id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'User not found' })
    res.json({ user: rows[0] })
  } catch (err) {
    next(err)
  }
})

export default router
