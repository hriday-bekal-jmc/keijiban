import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import sharp from 'sharp'
import { query, UUID_RE, VIBE_TODAY_SQL, parsePage, logAudit } from '../config/db.js'
import { requireAuth } from '../middleware/auth.js'
import { parseMultipart } from '../lib/parseMultipart.js'
import type { RequestWithUser } from '../types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname  = path.dirname(__filename)
const AVATAR_DIR = path.resolve(__dirname, '../../uploads/avatars')

const router = Router()

const MAX_NAME_LEN  = 100
const MAX_EMOJI_LEN = 10
const MAX_LABEL_LEN = 100

// PUT /api/users/me
router.put('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const {
      full_name, email_notifications, in_app_notifications,
      notif_new_post_email, notif_new_post_chat,
      notif_comment_email,  notif_comment_chat,
      notif_like_email,     notif_like_chat,
    } = req.body as {
      full_name?: string
      email_notifications?: boolean
      in_app_notifications?: boolean
      notif_new_post_email?: boolean
      notif_new_post_chat?: boolean
      notif_comment_email?: boolean
      notif_comment_chat?: boolean
      notif_like_email?: boolean
      notif_like_chat?: boolean
    }

    if (full_name !== undefined && full_name.trim().length > MAX_NAME_LEN) {
      return res.status(400).json({ error: `full_name must be ${MAX_NAME_LEN} characters or less` })
    }

    const { rows } = await query(
      `UPDATE users
       SET full_name              = COALESCE($2,  full_name),
           email_notifications    = COALESCE($3,  email_notifications),
           in_app_notifications   = COALESCE($4,  in_app_notifications),
           notif_new_post_email   = COALESCE($5,  notif_new_post_email),
           notif_new_post_chat    = COALESCE($6,  notif_new_post_chat),
           notif_comment_email    = COALESCE($7,  notif_comment_email),
           notif_comment_chat     = COALESCE($8,  notif_comment_chat),
           notif_like_email       = COALESCE($9,  notif_like_email),
           notif_like_chat        = COALESCE($10, notif_like_chat),
           updated_at             = now()
       WHERE id = $1
       RETURNING id, full_name, email_notifications, in_app_notifications,
                 notif_new_post_email, notif_new_post_chat,
                 notif_comment_email,  notif_comment_chat,
                 notif_like_email,     notif_like_chat`,
      [
        (req as RequestWithUser).user.id,
        full_name?.trim()        ?? null,
        email_notifications      ?? null,
        in_app_notifications     ?? null,
        notif_new_post_email     ?? null,
        notif_new_post_chat      ?? null,
        notif_comment_email      ?? null,
        notif_comment_chat       ?? null,
        notif_like_email         ?? null,
        notif_like_chat          ?? null,
      ]
    )
    res.json({ user: rows[0] })
  } catch (err) { next(err) }
})

// PUT /api/users/me/vibe — set today's vibe
router.put('/me/vibe', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { emoji, label } = req.body as { emoji?: string; label?: string }
    if (!emoji?.trim()) return res.status(400).json({ error: 'emoji required' })
    if (emoji.trim().length > MAX_EMOJI_LEN) {
      return res.status(400).json({ error: `emoji must be ${MAX_EMOJI_LEN} characters or less` })
    }
    if (label !== undefined && label.trim().length > MAX_LABEL_LEN) {
      return res.status(400).json({ error: `label must be ${MAX_LABEL_LEN} characters or less` })
    }

    const uid = (req as RequestWithUser).user.id
    await query(
      `UPDATE users SET vibe_emoji = $2, vibe_label = $3, vibe_set_at = now() WHERE id = $1`,
      [uid, emoji.trim(), label?.trim() ?? null]
    )
    logAudit(uid, 'VIBE_SET', uid, { emoji: emoji.trim(), label: label?.trim() ?? null })
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
    logAudit(uid, 'VIBE_CLEAR', uid)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// PUT /api/users/me/avatar — upload a custom profile photo (multipart, max 4 MB)
router.put('/me/avatar', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId } = (req as RequestWithUser).user
    const { files } = await parseMultipart(req, { maxFileSize: 4 * 1024 * 1024, maxFiles: 1 })
    const file = files[0]
    if (!file) return res.status(400).json({ error: 'No file provided' })
    if (!file.mimetype.startsWith('image/')) return res.status(400).json({ error: 'Image files only' })

    // Re-encode through sharp: validates the bytes are a real image (sharp
    // throws otherwise) and strips any embedded payload/EXIF. animated:true
    // preserves GIF animation (output WebP supports it).
    let processed: Buffer
    try {
      processed = await sharp(file.buffer, { animated: true })
        .rotate()
        .resize(512, 512, { fit: 'cover' })
        .webp({ quality: 88 })
        .toBuffer()
    } catch {
      return res.status(400).json({ error: '画像ファイルとして読み込めません' })
    }

    // Remove any previous avatar files for this user
    for (const e of ['jpg', 'jpeg', 'png', 'gif', 'webp']) {
      try { fs.unlinkSync(path.join(AVATAR_DIR, `${userId}.${e}`)) } catch {}
    }

    fs.mkdirSync(AVATAR_DIR, { recursive: true })
    fs.writeFileSync(path.join(AVATAR_DIR, `${userId}.webp`), processed)

    // ?v= cache-buster: the file path never changes, and /uploads is served
    // with a 7-day max-age — without this, browsers keep the old picture.
    const avatarUrl = `/uploads/avatars/${userId}.webp?v=${Date.now()}`
    await query(`UPDATE users SET avatar_url = $2, updated_at = now() WHERE id = $1`, [userId, avatarUrl])
    res.json({ avatar_url: avatarUrl })
  } catch (err) { next(err) }
})

// DELETE /api/users/me/avatar — remove custom photo, revert to Google photo or null
router.delete('/me/avatar', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId } = (req as RequestWithUser).user

    for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp']) {
      try { fs.unlinkSync(path.join(AVATAR_DIR, `${userId}.${ext}`)) } catch {}
    }

    // Set to null — the Google photo will be restored on next login.
    await query(`UPDATE users SET avatar_url = NULL, updated_at = now() WHERE id = $1`, [userId])
    res.json({ ok: true, avatar_url: null })
  } catch (err) { next(err) }
})

// GET /api/users/me/stats
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
    const { limit, offset } = parsePage(req.query, 24, 48)
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

// GET /api/users/vibing — users with a vibe set today (JST); excludes self
router.get('/vibing', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id: userId } = (req as RequestWithUser).user
    const { rows } = await query(
      `SELECT u.id, u.full_name, u.avatar_url, u.vibe_emoji, u.vibe_label
       FROM users u
       WHERE ${VIBE_TODAY_SQL}
         AND u.vibe_emoji IS NOT NULL
         AND u.id != $1
       ORDER BY u.vibe_set_at DESC
       LIMIT 20`,
      [userId]
    )
    res.json({ users: rows })
  } catch (err) { next(err) }
})

// GET /api/users/:id — public profile (anyone can view)
router.get('/:id', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!UUID_RE.test(req.params.id as string)) return res.status(400).json({ error: 'Invalid user ID' })

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
    if (!UUID_RE.test(req.params.id as string)) return res.status(400).json({ error: 'Invalid user ID' })

    const { limit } = parsePage(req.query, 12, 24)
    const { rows } = await query(
      `SELECT p.id, p.title, p.post_type, p.created_at, p.is_pinned,
              (SELECT COUNT(*)::int FROM likes    WHERE post_id = p.id)                        AS likes_count,
              (SELECT COUNT(*)::int FROM comments WHERE post_id = p.id AND deleted_at IS NULL) AS comments_count
       FROM posts p
       WHERE p.author_id = $1 AND p.deleted_at IS NULL
         AND (p.visibility_scope = 'COMPANY_WIDE'
              OR p.author_id = $2
              OR EXISTS (
                SELECT 1 FROM post_departments pd
                JOIN users u2 ON u2.id = $2 AND u2.department_id = pd.department_id
                WHERE pd.post_id = p.id
              ))
       ORDER BY p.created_at DESC
       LIMIT $3`,
      [req.params.id, (req as RequestWithUser).user.id, limit]
    )
    res.json({ posts: rows })
  } catch (err) { next(err) }
})

export default router
