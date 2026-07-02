import { Router, Request, Response, NextFunction } from 'express'
import { OAuth2Client } from 'google-auth-library'
import { query, VIBE_TODAY_SQL } from '../config/db.js'
import {
  createAccessToken,
  createRefreshTokenValue,
  hashRefreshToken,
  setAccessCookie,
  setRefreshCookie,
  clearAuthCookies,
  requireAuth,
} from '../middleware/auth.js'
import { env } from '../config/env.js'
import type { RequestWithUser } from '../types.js'
import rateLimit from 'express-rate-limit'

// 10 login attempts / 15 min per IP — throttles token stuffing without locking out real users.
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: env.isDev ? 500 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'ログイン試行が多すぎます。しばらくしてから再試行してください。' },
})

const router = Router()
const googleClient = new OAuth2Client(env.googleClientId)

// ── helpers ───────────────────────────────────────────────────────────────────

interface DbUser {
  id: string
  email: string
  role: 'member' | 'admin'
  department_id: string
  can_post: boolean
  full_name?: string
  avatar_url?: string
  department_name?: string
}

/** Issue both cookies and store the refresh token hash in DB. */
async function issueSession(res: Response, user: DbUser, ip: string): Promise<void> {
  const accessPayload = {
    id: user.id,
    email: user.email,
    role: user.role,
    departmentId: user.department_id,
    canPost: user.can_post,
  }
  const accessToken = createAccessToken(accessPayload)
  const { plaintext, hash, expiresAt } = createRefreshTokenValue()

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [user.id, hash, expiresAt]
  )

  setAccessCookie(res, accessToken)
  setRefreshCookie(res, plaintext)

  console.info('[auth:session-issued]', { userId: user.id, email: user.email, role: user.role, ip })
}

// ── POST /api/auth/google ─────────────────────────────────────────────────────

router.post('/google', loginLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { idToken } = req.body as { idToken?: string }
    if (!idToken) return res.status(400).json({ error: 'Missing idToken' })

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.googleClientId,
    })
    const payload = ticket.getPayload()
    if (!payload) return res.status(400).json({ error: 'Invalid token payload' })

    // Check both email domain AND Google's hosted-domain claim (hd).
    // Email alone can be spoofed with consumer Google accounts if client_id is leaked;
    // hd is set by Google Workspace and cannot be faked in a valid id_token.
    const emailOk = payload.email?.endsWith(`@${env.allowedDomain}`) && payload.email_verified
    const hdOk = !payload.hd || payload.hd === env.allowedDomain // hd absent = consumer account
    if ((!emailOk || !hdOk) && !env.isDev) {
      console.warn('[auth:blocked]', { email: payload.email, hd: payload.hd, ip: req.ip })
      return res.status(403).json({ error: 'Access restricted to JMC accounts' })
    }
    if (!emailOk && env.isDev) {
      console.warn('[auth:dev-bypass]', { email: payload.email })
    }

    const isSuperAdmin = env.superAdminEmails.has((payload.email ?? '').toLowerCase())

    // 1. Claim a pre-provisioned account (admin created user before first login).
    //    Atomically links google_id so concurrent logins are safe.
    const { rows: claimed } = await query(
      `UPDATE users
       SET google_id  = $1,
           full_name  = $3,
           avatar_url = COALESCE(avatar_url, $4),
           role       = CASE WHEN $5 = 'admin' THEN 'admin'::VARCHAR ELSE role END,
           updated_at = now()
       WHERE email = $2 AND google_id IS NULL
       RETURNING id, email, full_name, avatar_url, role, department_id, can_post`,
      [payload.sub, payload.email, payload.name, payload.picture, isSuperAdmin ? 'admin' : 'member']
    )

    if (claimed[0]) {
      const { rows: deptRows } = await query(
        'SELECT d.name AS department_name FROM departments d JOIN users u ON d.id = u.department_id WHERE u.id = $1',
        [claimed[0].id]
      )
      const user = { ...claimed[0], department_name: deptRows[0]?.department_name } as DbUser
      await issueSession(res, user, req.ip ?? '')
      console.info('[auth:account-claimed]', { userId: user.id, email: user.email, ip: req.ip })
      return res.json({ user })
    }

    // 2. Normal upsert for new or returning users (google_id already linked).
    const { rows } = await query(
      `WITH upserted AS (
         INSERT INTO users (google_id, email, full_name, avatar_url, department_id, role)
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
         RETURNING id, email, full_name, avatar_url, role, department_id, can_post
       )
       SELECT u.id, u.email, u.full_name, u.avatar_url, u.role, u.department_id, u.can_post,
              d.name AS department_name
       FROM upserted u
       JOIN departments d ON d.id = u.department_id`,
      [payload.sub, payload.email, payload.name, payload.picture, isSuperAdmin ? 'admin' : 'member']
    )

    const user = rows[0] as DbUser
    await issueSession(res, user, req.ip ?? '')
    res.json({ user })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
// Silent token refresh. Client calls this when access token expires (401).
// Rotates the refresh token: the old row is kept, marked rotated_at (swept
// after 1 day) so reuse is detectable. Presenting a token rotated >30s ago is
// a theft signal — ALL of that user's sessions are revoked. Reuse within 30s
// is treated as a benign concurrent refresh (multiple tabs racing) and gets a
// fresh session instead of a lockout.

const ROTATION_GRACE_MS = 30_000

router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const incoming = (req as Request & { cookies?: Record<string, string> }).cookies?.refresh_token
    if (!incoming) return res.status(401).json({ error: 'No refresh token' })

    const hash = hashRefreshToken(incoming)

    const { rows } = await query<{
      id: string; user_id: string; expires_at: string; rotated_at: string | null
    }>(
      `SELECT id, user_id, expires_at, rotated_at FROM refresh_tokens WHERE token_hash = $1`,
      [hash]
    )

    if (!rows[0]) {
      clearAuthCookies(res)
      console.warn('[auth:refresh-unknown-token]', { ip: req.ip })
      return res.status(401).json({ error: 'Invalid refresh token' })
    }

    const row = rows[0]

    if (row.rotated_at && Date.now() - new Date(row.rotated_at).getTime() > ROTATION_GRACE_MS) {
      // Reuse of an already-rotated token — assume theft, revoke everything.
      await query('DELETE FROM refresh_tokens WHERE user_id = $1', [row.user_id])
      clearAuthCookies(res)
      console.warn('[auth:refresh-token-reuse]', { userId: row.user_id, ip: req.ip })
      return res.status(401).json({ error: 'Invalid refresh token' })
    }

    if (new Date(row.expires_at) < new Date()) {
      clearAuthCookies(res)
      return res.status(401).json({ error: 'Refresh token expired' })
    }

    if (!row.rotated_at) {
      await query('UPDATE refresh_tokens SET rotated_at = now() WHERE id = $1', [row.id])
    }

    // Re-read user from DB — this is what ensures permission changes (canPost, role)
    // take effect within one refresh cycle (≤15 min after the access token was issued).
    const { rows: userRows } = await query(
      `SELECT u.id, u.email, u.role, u.department_id, u.can_post,
              u.full_name, u.avatar_url, d.name AS department_name
       FROM users u
       JOIN departments d ON d.id = u.department_id
       WHERE u.id = $1`,
      [row.user_id]
    )

    if (!userRows[0]) {
      clearAuthCookies(res)
      return res.status(401).json({ error: 'User not found' })
    }

    await issueSession(res, userRows[0] as DbUser, req.ip ?? '')
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/auth/logout ─────────────────────────────────────────────────────

router.post('/logout', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const incoming = (req as Request & { cookies?: Record<string, string> }).cookies?.refresh_token
    if (incoming) {
      const hash = hashRefreshToken(incoming)
      await query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash])
    }
    clearAuthCookies(res)
    console.info('[auth:logout]', { userId: (req as RequestWithUser).user.id, ip: req.ip })
    res.json({ ok: true })
  } catch (err) {
    next(err)
  }
})

// ── POST /api/auth/logout-all ─────────────────────────────────────────────────
// "Log out other devices": revokes every refresh token for the user EXCEPT the
// one presented, so the current session survives. Used from Profile settings
// and useful after a device is lost or a session looks compromised.

router.post('/logout-all', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = (req as RequestWithUser).user.id
    const incoming = (req as Request & { cookies?: Record<string, string> }).cookies?.refresh_token
    const keepHash = incoming ? hashRefreshToken(incoming) : null
    const { rowCount } = await query(
      `DELETE FROM refresh_tokens WHERE user_id = $1 AND ($2::text IS NULL OR token_hash != $2)`,
      [userId, keepHash]
    )
    console.info('[auth:logout-all]', { userId, sessionsRevoked: rowCount, ip: req.ip })
    res.json({ ok: true, sessionsRevoked: rowCount })
  } catch (err) {
    next(err)
  }
})

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

router.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.full_name, u.avatar_url, u.role, u.can_post,
              u.email_notifications, u.in_app_notifications,
              u.notif_new_post_email, u.notif_new_post_chat,
              u.notif_comment_email,  u.notif_comment_chat,
              u.notif_like_email,     u.notif_like_chat,
              u.department_id, d.name AS department_name,
              CASE WHEN ${VIBE_TODAY_SQL} THEN u.vibe_emoji ELSE NULL END AS vibe_emoji,
              CASE WHEN ${VIBE_TODAY_SQL} THEN u.vibe_label ELSE NULL END AS vibe_label
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
