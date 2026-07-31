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

import type { Server } from 'http'
import authRoutes from './routes/auth.js'
import { testLoginRouter, testLoginEnabled } from './routes/testLogin.js' // ⚠️ TEST-ONLY — see TEST_LOGIN.md
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
import thumbnailRoutes from './routes/thumbnails.js'
import { managedListRouter } from './lib/managedList.js'
import { startNotificationWorker, stopNotificationWorker } from './services/notify.js'
import { startDriveSweep } from './services/driveSweep.js'
import { sseManager } from './services/sse.js'

// Graceful shutdown — release the port FIRST (close SSE streams + keep-alive
// sockets, stop accepting connections), then drain the DB pool. Closing only
// the pool left the HTTP server bound to :3001, so a restarting watcher/PM2
// worker collided with the old process (EADDRINUSE) and the API was dead for
// a window — surfacing to users as intermittent 500s (e.g. on login).
let server: Server | undefined

function releasePort(): void {
  // Stop the notify loop before draining the pool, otherwise a pass can send
  // an email and then fail to record emailed_at — resending it after restart.
  stopNotificationWorker()
  sseManager.closeAll()
  server?.closeAllConnections?.()
}

function gracefulShutdown(signal: string): void {
  console.info(`[shutdown] ${signal} received — closing server, draining pool`)
  releasePort()
  const closeServer = new Promise<void>(resolve => {
    if (!server) return resolve()
    server.close(() => resolve())
    // Hard cap — never hang shutdown on a socket that won't die
    setTimeout(resolve, 3_000).unref()
  })
  closeServer
    .then(() => pool.end())
    .then(() => { console.info('[shutdown] clean exit'); process.exit(0) })
    .catch(err => { console.error('[shutdown] error:', err); process.exit(1) })
}
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.once('SIGINT',  () => gracefulShutdown('SIGINT'))

// Log then exit — process manager (nodemon/PM2/systemd) handles restart.
// Continuing after these events risks undefined application state.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection] shutting down:', reason)
  releasePort()
  server?.close()
  pool.end().finally(() => process.exit(1))
})
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] shutting down:', err)
  releasePort()
  server?.close()
  pool.end().finally(() => process.exit(1))
})

const app: Express = express()

// Behind a reverse proxy every request arrives from the proxy, so without this
// req.ip is always 127.0.0.1 and EVERY user shares one rate-limit bucket —
// the 11th person to sign in on a Monday morning would be locked out for 15
// minutes. One hop (nginx/Caddy); raise if you add another layer.
app.set('trust proxy', 1)

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

// gzip API responses; skip SSE (compression buffers the event stream).
// Must test originalUrl, not path: the filter runs on the first res.write(),
// by which point Express has stripped the router's mount path and req.path is
// '/stream'. With req.path the test never matched, so the event stream was
// gzipped and every event sat in the compressor instead of reaching the client.
app.use(compression({
  filter: (req, res) => req.originalUrl.startsWith('/api/stream') ? false : compression.filter(req, res),
}))

app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
// Serve uploaded avatars without auth (profile photos are not sensitive)
app.use('/uploads', express.static(uploadsRoot, { maxAge: '7d', immutable: false }))

const globalLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false })

app.use(globalLimiter)

app.use('/api/health',        healthRoutes)
app.use('/api/auth',          authRoutes)

// ⚠️ TEST-ONLY LOGIN — remove these three lines and see TEST_LOGIN.md
if (testLoginEnabled()) {
  console.warn('\n⚠️  TEST LOGIN IS ENABLED — anyone can sign in as any user by email.\n' +
               '   Never run with ALLOW_TEST_LOGIN=true in production. See TEST_LOGIN.md.\n')
  app.use('/api/test-login', testLoginRouter())
}

app.use('/api/stream',        streamRoutes)
app.use('/api/posts',         postRoutes)
app.use('/api/posts/:postId/comments', commentRoutes)
app.use('/api/posts/:postId/like',     likeRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/users',         userRoutes)
app.use('/api/admin',         adminRoutes)
app.use('/api/uploads',       uploadRoutes)
app.use('/api/bookmarks',     bookmarkRoutes)
app.use('/api/thumbnails',    thumbnailRoutes)
// Admin-curated lists. Adding a future one (roles, locations, tags…) is a
// single line here plus an entry in the frontend's MANAGED_LISTS.
app.use('/api/departments',   managedListRouter({ table: 'departments', audit: 'DEPARTMENT', maxNameLen: 100, hasColor: false }))
app.use('/api/branches',      managedListRouter({ table: 'branches',    audit: 'BRANCH',     maxNameLen: 80,  hasColor: false }))
app.use('/api/categories',    managedListRouter({ table: 'categories',  audit: 'CATEGORY',   maxNameLen: 60,  hasColor: true }))

app.use(errorHandler)

server = app.listen(env.port, () => {
  console.log(`API running on :${env.port} [${env.isDev ? 'dev' : 'prod'}]`)
  startNotificationWorker()
  startDriveSweep()
})

// Retention sweep every 6 hours. Without it audit_log, notifications and
// post_views grow forever — audit_log alone takes a row per like/bookmark
// toggle, which is millions per year at office scale.
const SIX_HOURS = 6 * 60 * 60 * 1000
const RETENTION_SQL: Array<[string, string]> = [
  ['refresh tokens', `DELETE FROM refresh_tokens
     WHERE expires_at < now()
        OR (rotated_at IS NOT NULL AND rotated_at < now() - interval '1 day')`],
  ['audit rows',     `DELETE FROM audit_log WHERE created_at < now() - interval '12 months'`],
  ['read notifications', `DELETE FROM notifications
     WHERE read_at IS NOT NULL AND created_at < now() - interval '90 days'`],
]

function runRetention(): void {
  for (const [label, sql] of RETENTION_SQL) {
    query(sql)
      .then(({ rowCount }) => { if (rowCount) console.info(`[retention] removed ${rowCount} ${label}`) })
      .catch(err => console.error(`[retention] ${label} failed:`, err))
  }
}
setInterval(runRetention, SIX_HOURS).unref()
