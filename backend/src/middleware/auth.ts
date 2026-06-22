import jwt from 'jsonwebtoken'
import type { Request, Response, NextFunction } from 'express'
import { env } from '../config/env.js'
import type { AuthUser, RequestWithUser } from '../types.js'

export function createToken(payload: AuthUser): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: 8 * 60 * 60 })
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.session
  if (!token) {
    res.status(401).json({ error: 'Not authenticated' })
    return
  }

  try {
    (req as RequestWithUser).user = jwt.verify(token, env.jwtSecret) as AuthUser
    next()
  } catch {
    res.clearCookie('session')
    res.status(401).json({ error: 'Session expired' })
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
