import rateLimit from 'express-rate-limit'
import { env } from '../config/env.js'

// Per-user rate limits — keyed by userId (set by requireAuth) rather than IP
// so users behind the same VPN/NAT don't share a bucket.
export const postCreateLimiter = rateLimit({
  windowMs: 60_000,
  max: env.isDev ? 100 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => (req as { user?: { id?: string } }).user?.id ?? req.ip ?? 'anon',
  message: { error: '投稿の頻度が多すぎます。しばらくしてから再試行してください。' },
})

export const commentCreateLimiter = rateLimit({
  windowMs: 60_000,
  max: env.isDev ? 200 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: req => (req as { user?: { id?: string } }).user?.id ?? req.ip ?? 'anon',
  message: { error: 'コメントの頻度が多すぎます。' },
})
