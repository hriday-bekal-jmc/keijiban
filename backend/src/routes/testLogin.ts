/**
 * ⚠️ TEST-ONLY LOGIN — signs in as any user by email, with no credential.
 *
 * This is an authentication bypass. It exists so the app can be exercised as
 * different users (member vs admin, different branches, no-post accounts)
 * without needing their Google credentials.
 *
 * TO REMOVE: see TEST_LOGIN.md in the repo root. Deleting this file plus the
 * three marked lines in index.ts and the one marked block in Login.tsx removes
 * it entirely.
 *
 * Two independent gates, both of which must pass (see testLoginEnabled below):
 *   1. NODE_ENV must not be 'production'
 *   2. ALLOW_TEST_LOGIN must be exactly 'true'
 * The router is not even constructed unless both hold, so in production the
 * route does not exist and returns the normal 404.
 */
import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { query, logAudit } from '../config/db.js'
import { createAccessToken, createRefreshTokenValue, setAccessCookie, setRefreshCookie } from '../middleware/auth.js'
import rateLimit from 'express-rate-limit'

// Declared here rather than imported so this file stays self-contained and
// deletable in one step (auth.ts keeps its own limiter private).
const testLoginLimiter = rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false })

/** Both gates. Checked here and asserted again inside the handler. */
export function testLoginEnabled(): boolean {
  return process.env.NODE_ENV !== 'production' && process.env.ALLOW_TEST_LOGIN === 'true'
}

interface DbUser {
  id: string
  email: string
  full_name: string
  avatar_url: string | null
  role: 'member' | 'admin'
  department_id: string
  department_name: string
  branch_id: string | null
  can_post: boolean
}

export function testLoginRouter(): Router {
  const router = Router()

  // GET /api/test-login/users — the picker list, so you don't have to remember
  // emails. Same gate as the login itself.
  router.get('/users', async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const { rows } = await query(
        `SELECT u.id, u.email, u.full_name, u.role, u.can_post,
                d.name AS department_name, br.name AS branch_name
         FROM users u
         JOIN departments d ON d.id = u.department_id
         LEFT JOIN branches br ON br.id = u.branch_id
         ORDER BY u.role DESC, u.full_name
         LIMIT 200`
      )
      res.json({ users: rows })
    } catch (err) { next(err) }
  })

  // POST /api/test-login { email } — issues a real session for that user.
  router.post('/', testLoginLimiter, async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Belt and braces: if this router is ever mounted unconditionally by
      // mistake, the handler still refuses.
      if (!testLoginEnabled()) return res.status(404).json({ error: 'Not found' })

      const { email } = req.body as { email?: string }
      if (!email?.trim()) return res.status(400).json({ error: 'メールアドレスを入力してください' })

      const { rows } = await query<DbUser>(
        `SELECT u.id, u.email, u.full_name, u.avatar_url, u.role,
                u.department_id, d.name AS department_name, u.branch_id, u.can_post
         FROM users u
         JOIN departments d ON d.id = u.department_id
         WHERE lower(u.email) = lower($1)`,
        [email.trim()]
      )
      const user = rows[0]
      if (!user) return res.status(404).json({ error: 'そのメールアドレスのユーザーはいません' })

      // Same session issuance as a real Google login — the resulting cookies
      // are indistinguishable, so everything downstream behaves normally.
      const { plaintext, hash, expiresAt } = createRefreshTokenValue()
      await query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
        [user.id, hash, expiresAt]
      )
      setAccessCookie(res, createAccessToken({
        id: user.id,
        email: user.email,
        role: user.role,
        departmentId: user.department_id,
        branchId: user.branch_id ?? null,
        canPost: user.can_post,
      }))
      setRefreshCookie(res, plaintext)

      // Recorded in the audit log so a test session is never mistaken for a
      // real sign-in when reading the log later.
      logAudit(user.id, 'TEST_LOGIN', user.id, { email: user.email, ip: req.ip })
      console.warn('[auth:TEST-LOGIN]', { email: user.email, role: user.role, ip: req.ip })

      res.json({ user })
    } catch (err) { next(err) }
  })

  return router
}
