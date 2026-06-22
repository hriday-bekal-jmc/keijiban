import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import { query } from '../config/db.js'
import { requireAuth } from '../middleware/auth.js'
import { parseMultipart } from '../lib/parseMultipart.js'
import type { RequestWithUser } from '../types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const AVATAR_DIR = path.resolve(__dirname, '../../uploads/avatars')

const router = Router()

// Reusable SQL fragment: vibe is only valid if set today (JST midnight boundary)
const VIBE_TODAY_SQL = `
  date_trunc('day', vibe_set_at AT TIME ZONE 'Asia/Tokyo')
  = date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo')
`

// GET /api/users/me
router.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.email, u.full_name, u.avatar_url, u.role, u.can_post,
              u.email_notifications, u.in_app_notifications,
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
  } catch (err) { next(err) }
})

// PUT /api/users/me
router.put('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { full_name, email_notifications, in_app_notifications } = req.body as {
      full_name?: string
      email_notifications?: boolean
      in_app_notifications?: boolean
    }
    const { rows } = await query(
      `UPDATE users
       SET full_name            = COALESCE($2, full_name),
           email_notifications  = COALESCE($3, email_notifications),
           in_app_notifications = COALESCE($4, in_app_notifications),
           updated_at           = now()
       WHERE id = $1
       RETURNING id, full_name, email_notifications, in_app_notifications`,
      [(req as RequestWithUser).user.id, full_name ?? null, email_notifications ?? null, in_app_notifications ?? null]
    )
    res.json({ user: rows[0] })
  } catch (err) { next(err) }
})

// PUT /api/users/me/vibe — set today's vibe
router.put('/me/vibe', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { emoji, label } = req.body as { emoji?: string; label?: string }
    if (!emoji?.trim()) return res.status(400).json({ error: 'emoji required' })
    const uid = (req as RequestWithUser).user.id
    await query(
      `UPDATE users SET vibe_emoji = $2, vibe_label = $3, vibe_set_at = now() WHERE id = $1`,
      [uid, emoji.trim(), label?.trim() ?? null]
    )
    await query(
      `INSERT INTO audit_log (actor_id, action, target_id, detail)
       VALUES ($1, 'VIBE_SET', $1, $2)`,
      [uid, JSON.stringify({ emoji: emoji.trim(), label: label?.trim() ?? null })]
    ).catch(() => {})
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// DELETE /api/users/me/vibe — clear vibe
router.delete('/me/vibe', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const uid = (req as RequestWithUser).user.id
    await query(
      `UPDATE users SET vibe_emoji = NULL, vibe_label = NULL, vibe_set_at = NULL WHERE id = $1`,
      [uid]
    )
    await query(
      `INSERT INTO audit_log (actor_id, action, target_id) VALUES ($1, 'VIBE_CLEAR', $1)`,
      [uid]
    ).catch(() => {})
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// PUT /api/users/me/avatar — upload a custom profile photo (multipart, max 4 MB)
router.put('/me/avatar', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId } = (req as RequestWithUser).user
    const { files } = await parseMultipart(req, 4 * 1024 * 1024)
    const file = files[0]
    if (!file) return res.status(400).json({ error: 'No file provided' })
    if (!file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Image files only' })

    const ext = file.mimetype === 'image/png' ? 'png'
      : file.mimetype === 'image/gif' ? 'gif'
      : file.mimetype === 'image/webp' ? 'webp'
      : 'jpg'

    // Remove any previous avatar files for this user
    for (const e of ['jpg', 'jpeg', 'png', 'gif', 'webp']) {
      try { fs.unlinkSync(path.join(AVATAR_DIR, `${userId}.${e}`)) } catch {}
    }

    fs.mkdirSync(AVATAR_DIR, { recursive: true })
    fs.writeFileSync(path.join(AVATAR_DIR, `${userId}.${ext}`), file.buffer)

    const avatarUrl = `/uploads/avatars/${userId}.${ext}`
    await query(`UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1`, [userId, avatarUrl])
    res.json({ avatar_url: avatarUrl })
  } catch (err) { next(err) }
})

// DELETE /api/users/me/avatar — remove custom photo, revert to Google photo or null
router.delete('/me/avatar', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId } = (req as RequestWithUser).user

    // Remove file from disk
    for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp']) {
      try { fs.unlinkSync(path.join(AVATAR_DIR, `${userId}.${ext}`)) } catch {}
    }

    // Fetch Google picture from the stored google_id token is not feasible here;
    // set to null — the Google photo will be restored on next login.
    await query(`UPDATE users SET avatar_url = NULL, updated_at = now() WHERE id = $1`, [userId])
    res.json({ ok: true, avatar_url: null })
  } catch (err) { next(err) }
})

// GET /api/users/me/stats
// Activity metrics (posts, likes, comments) are scoped to the current JST calendar month —
// all-time numbers grow unbounded and lose signal. Bookmarks is all-time (it's a collection).
router.get('/me/stats', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const uid = (req as RequestWithUser).user.id
    const { rows } = await query(
      `SELECT
         (SELECT COUNT(*)::int FROM posts
          WHERE author_id = $1 AND deleted_at IS NULL
            AND date_trunc('month', created_at AT TIME ZONE 'Asia/Tokyo')
              = date_trunc('month', now() AT TIME ZONE 'Asia/Tokyo'))                                   AS posts_count,
         (SELECT COUNT(*)::int FROM likes l JOIN posts p ON p.id = l.post_id
          WHERE p.author_id = $1 AND p.deleted_at IS NULL
            AND date_trunc('month', l.created_at AT TIME ZONE 'Asia/Tokyo')
              = date_trunc('month', now() AT TIME ZONE 'Asia/Tokyo'))                                   AS likes_received,
         (SELECT COUNT(*)::int FROM bookmarks WHERE user_id = $1)                                       AS bookmarks_count,
         (SELECT COUNT(*)::int FROM comments
          WHERE author_id = $1 AND deleted_at IS NULL
            AND date_trunc('month', created_at AT TIME ZONE 'Asia/Tokyo')
              = date_trunc('month', now() AT TIME ZONE 'Asia/Tokyo'))                                   AS comments_made,
         (SELECT COUNT(*)::int FROM likes
          WHERE user_id = $1
            AND date_trunc('month', created_at AT TIME ZONE 'Asia/Tokyo')
              = date_trunc('month', now() AT TIME ZONE 'Asia/Tokyo'))                                   AS likes_given`,
      [uid]
    )
    res.json(rows[0])
  } catch (err) { next(err) }
})

// GET /api/users/me/posts — current user's posts (profile grid)
router.get('/me/posts', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const uid = (req as RequestWithUser).user.id
    const limit = Math.min(parseInt((req.query.limit as string) ?? '24') || 24, 48)
    const offset = parseInt((req.query.offset as string) ?? '0') || 0
    const { rows } = await query(
      `SELECT p.id, p.title, p.content, p.post_type, p.tags,
              p.created_at, p.is_pinned, p.event_date,
              (SELECT COUNT(*)::int FROM likes    WHERE post_id = p.id)                       AS likes_count,
              (SELECT COUNT(*)::int FROM comments WHERE post_id = p.id AND deleted_at IS NULL) AS comments_count
       FROM posts p
       WHERE p.author_id = $1 AND p.deleted_at IS NULL
       ORDER BY p.created_at DESC
       LIMIT $2 OFFSET $3`,
      [uid, limit, offset]
    )
    res.json({ posts: rows })
  } catch (err) { next(err) }
})

// GET /api/users/:id — public profile (anyone can view)
router.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.full_name, u.avatar_url, u.role, u.can_post,
              u.department_id, d.name AS department_name,
              CASE WHEN ${VIBE_TODAY_SQL} THEN u.vibe_emoji ELSE NULL END AS vibe_emoji,
              CASE WHEN ${VIBE_TODAY_SQL} THEN u.vibe_label ELSE NULL END AS vibe_label,
              (SELECT COUNT(*)::int FROM posts
               WHERE author_id = u.id AND deleted_at IS NULL
                 AND date_trunc('month', created_at AT TIME ZONE 'Asia/Tokyo')
                   = date_trunc('month', now() AT TIME ZONE 'Asia/Tokyo'))                        AS posts_count,
              (SELECT COUNT(*)::int FROM comments
               WHERE author_id = u.id AND deleted_at IS NULL
                 AND date_trunc('month', created_at AT TIME ZONE 'Asia/Tokyo')
                   = date_trunc('month', now() AT TIME ZONE 'Asia/Tokyo'))                        AS comments_made
       FROM users u
       JOIN departments d ON d.id = u.department_id
       WHERE u.id = $1`,
      [req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'User not found' })
    res.json({ user: rows[0] })
  } catch (err) { next(err) }
})

// GET /api/users/:id/posts — another user's recent posts (public posts only)
router.get('/:id/posts', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = Math.min(parseInt((req.query.limit as string) ?? '12') || 12, 24)
    const { rows } = await query(
      `SELECT p.id, p.title, p.post_type, p.created_at, p.is_pinned,
              (SELECT COUNT(*)::int FROM likes    WHERE post_id = p.id)                        AS likes_count,
              (SELECT COUNT(*)::int FROM comments WHERE post_id = p.id AND deleted_at IS NULL) AS comments_count
       FROM posts p
       WHERE p.author_id = $1 AND p.deleted_at IS NULL
         AND (p.visibility_scope = 'COMPANY_WIDE'
              OR p.author_id = $2
              OR EXISTS (SELECT 1 FROM users u2 WHERE u2.id = $2 AND u2.department_id = p.department_id))
       ORDER BY p.created_at DESC
       LIMIT $3`,
      [req.params.id, (req as RequestWithUser).user.id, limit]
    )
    res.json({ posts: rows })
  } catch (err) { next(err) }
})

export default router
