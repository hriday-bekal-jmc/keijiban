import express, { Express } from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { env } from './config/env.js'
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

const app: Express = express()

app.use(helmet({ contentSecurityPolicy: false }))
app.use(cors({
  origin: env.isDev ? 'http://localhost:5173' : `https://${env.cookieDomain}`,
  credentials: true,
}))
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
// Serve uploaded avatars without auth (profile photos are not sensitive)
app.use('/uploads', express.static(uploadsRoot, { maxAge: '7d', immutable: false }))

const globalLimiter = rateLimit({ windowMs: 60_000, max: 300, standardHeaders: true, legacyHeaders: false })
const authLimiter  = rateLimit({ windowMs: 60_000, max: env.isDev ? 100 : 10, standardHeaders: true, legacyHeaders: false })
app.use(globalLimiter)

app.use('/api/health',        healthRoutes)
app.use('/api/auth',          authLimiter, authRoutes)
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
})
