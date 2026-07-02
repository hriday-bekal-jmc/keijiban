import express, { Express, Request, Response, NextFunction } from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import cors from 'cors'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { env } from './config/env.js'
import { pool, query } from './config/db.js'
import { errorHandler } from './middleware/errorHandler.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
// Ensure uploads directory exists (backend/uploads/)
const uploadsRoot = path.resolve(__dirname, '../uploads')
fs.mkdirSync(path.join(uploadsRoot, 'avatars'), { recursive: true })

import authRoutes from './routes/auth.js'
import postRoutes from './routes/posts.js'
import commentRoutes from './routes/comments.js'
import likeRoutes from './routes/likes.js'
import streamRoutes from './routes/stream.js'
import notificationRoutes from './routes/notifications.js'
import userRoutes from './routes/users.js'
import healthRoutes from './routes/health.js'
import adminRoutes from './routes/admin.js'
import uploadRoutes from './routes/uploads.js'
import bookmarkRoutes from './routes/bookmarks.js'
import { startNotificationWorker } from './services/notify.js'

// Graceful shutdown — drain the connection pool before exiting so in-flight
// queries can finish and the DB doesn't see hard disconnects.
function gracefulShutdown(signal: string): void {
  console.info(`[shutdown] ${signal} received — draining pool`)
  pool.end()
    .then(() => { console.info('[shutdown] pool drained'); process.exit(0) })
    .catch(err => { console.error('[shutdown] pool.end error:', err); process.exit(1) })
}
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.once('SIGINT',  () => gracefulShutdown('SIGINT'))

// Log then exit — process manager (nodemon/PM2/systemd) handles restart.
// Continuing after these events risks undefined application state.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] shutting down:', reason)
  pool.end().finally(() => process.exit(1))
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] shutting down:', err)
  pool.end().finally(() => process.exit(1))
})

const app: Express = express()

const ALLOWED_ORIGIN = env.isDev ? 'http://localhost:5173' : `https://${env.cookieDomain}`

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'img-src': ["'self'", 'data:'],
      // upgrade-insecure-requests breaks plain-http localhost in dev
      ...(env.isDev ? { upgradeInsecureRequests: null } : {}),
    },
  },
}))
app.use(cors({ origin: ALLOWED_ORIGIN, credentials: true }))

// CSRF hardening: cookies are SameSite=strict; additionally reject any
// state-changing request whose Origin header is present but foreign.
app.use('/api', (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const origin = req.headers.origin
    if (origin && origin !== ALLOWED_ORIGIN) {
      return res.status(403).json({ error: 'Cross-origin request blocked' })
    }
  }
  next()
})

// gzip API responses; skip SSE (compression buffers the event stream)
app.use(compression({
  filter: (req, res) => req.path.startsWith('/api/stream') ? false : compression.filter(req, res),
}))

app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
// Serve uploaded avatars without auth (profile photos are not sensitive)
app.use('/uploads', express.static(uploadsRoot, { maxAge: '7d', immutable: false }))

const globalLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false })

app.use(globalLimiter)

app.use('/api/health',        healthRoutes)
app.use('/api/auth',          authRoutes)
app.use('/api/stream',        streamRoutes)
app.use('/api/posts',         postRoutes)
app.use('/api/posts/:postId/comments', commentRoutes)
app.use('/api/posts/:postId/like',     likeRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/users',         userRoutes)
app.use('/api/admin',         adminRoutes)
app.use('/api/uploads',       uploadRoutes)
app.use('/api/bookmarks',     bookmarkRoutes)

app.use(errorHandler)

app.listen(env.port, () => {
  console.log(`API running on :${env.port} [${env.isDev ? 'dev' : 'prod'}]`)
  startNotificationWorker()
})

// Purge expired + day-old rotated refresh tokens every 6 hours.
// Rotated rows are kept 1 day for token-reuse (theft) detection.
const SIX_HOURS = 6 * 60 * 60 * 1000
setInterval(() => {
  query(`DELETE FROM refresh_tokens
         WHERE expires_at < now()
            OR (rotated_at IS NOT NULL AND rotated_at < now() - interval '1 day')`)
    .then(({ rowCount }) => { if (rowCount) console.info(`[token-cleanup] removed ${rowCount} stale refresh tokens`) })
    .catch(err => console.error('[token-cleanup] error:', err))
}, SIX_HOURS).unref()
