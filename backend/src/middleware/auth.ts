import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { env } from '../config/env.js'
import type { AuthUser, RequestWithUser } from '../types.js'

// Access token: 15 minutes. Short enough that stale permissions (canPost, role)
// expire quickly; refresh re-reads from DB so changes take effect within 15min.
const ACCESS_TOKEN_TTL_SEC = 15 * 60

// Refresh token: 7 days. Rotated on every use.
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function createAccessToken(payload: AuthUser): string {
  return jwt.sign(payload, env.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL_SEC,
  })
}

/** Returns { plaintext, hash, expiresAt } — store hash in DB, send plaintext to client. */
export function createRefreshTokenValue(): {
  plaintext: string
  hash: string
  expiresAt: Date
} {
  const plaintext = crypto.randomBytes(32).toString('hex')
  const hash = crypto.createHash('sha256').update(plaintext).digest('hex')
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS)
  return { plaintext, hash, expiresAt }
}

export function hashRefreshToken(plaintext: string): string {
  return crypto.createHash('sha256').update(plaintext).digest('hex')
}

export function setAccessCookie(res: Response, token: string): void {
  res.cookie('session', token, {
    httpOnly: true,
    secure: !env.isDev,
    sameSite: 'strict',
    maxAge: ACCESS_TOKEN_TTL_SEC * 1000,
  })
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie('refresh_token', token, {
    httpOnly: true,
    secure: !env.isDev,
    sameSite: 'strict',
    maxAge: REFRESH_TOKEN_TTL_MS,
    path: '/api/auth',  // only sent to auth endpoints, not every API call
  })
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie('session', { path: '/' })
  res.clearCookie('refresh_token', { path: '/api/auth' })
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.session
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    const claims = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] }) as AuthUser
    // Tokens issued before branches existed carry no branchId. Default to null
    // (全社 posts only) rather than undefined, which would break SQL binding.
    claims.branchId = claims.branchId ?? null
    ;(req as RequestWithUser).user = claims
    next()
  } catch {
    // Do NOT clear the refresh_token cookie here — client will use it to refresh.
    res.status(401).json({ error: 'Token expired' })
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  requireAuth(req, res, () => {
    if ((req as RequestWithUser).user.role !== 'admin') {
      res.status(403).json({ error: 'Admin only' })
      return
    }
    next()
  })
}
