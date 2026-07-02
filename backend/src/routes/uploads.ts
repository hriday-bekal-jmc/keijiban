import { Router, Request, Response, NextFunction } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { env } from '../config/env.js'
import { parseMultipart } from '../lib/parseMultipart.js'
import { uploadFile, streamFile } from '../services/drive.js'
import { query, visibilitySQL } from '../config/db.js'
import type { RequestWithUser } from '../types.js'

const router = Router()

// POST /api/uploads/:postId — upload and attach files to an existing post
router.post('/:postId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!env.googleServiceAccountKey) {
      return res.status(503).json({ error: 'ファイルアップロードが設定されていません' })
    }

    const postId = req.params.postId as string
    const { id: userId, role } = (req as RequestWithUser).user

    const { rows: postRows } = await query(
      `SELECT author_id FROM posts WHERE id = $1 AND deleted_at IS NULL`,
      [postId]
    )
    if (!postRows[0]) return res.status(404).json({ error: 'Post not found' })
    const p = postRows[0] as { author_id: string }
    if (p.author_id !== userId && role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' })
    }

    const { files } = await parseMultipart(req)
    if (files.length === 0) return res.json({ attachments: [] })

    const attachments = await Promise.all(
      files.map(async (f) => {
        const result = await uploadFile(f.buffer, f.filename, f.mimetype)
        const { rows } = await query(
          `INSERT INTO attachments
             (post_id, drive_file_id, drive_url, file_name, mime_type, size_bytes, thumbnail_path)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, drive_url, file_name, mime_type, size_bytes, thumbnail_path`,
          [
            postId,
            result.driveFileId,
            result.driveUrl,
            f.filename,
            result.finalMimeType,
            f.buffer.length,
            result.thumbnailPath,
          ]
        )
        return rows[0]
      })
    )

    res.status(201).json({ attachments })
  } catch (err) {
    next(err)
  }
})

// GET /api/uploads/:driveFileId/content — proxy Drive file to authenticated user
// Visibility check: only serve the file if the requesting user can see the post it belongs to.
router.get('/:driveFileId/content', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!env.googleServiceAccountKey) {
      return res.status(503).json({ error: 'Drive not configured' })
    }

    const { id: userId, departmentId } = (req as RequestWithUser).user

    const { rows } = await query(
      `SELECT a.id FROM attachments a
       JOIN posts p ON p.id = a.post_id AND p.deleted_at IS NULL
       WHERE a.drive_file_id = $1 AND ${visibilitySQL(2, 3)}`,
      [req.params.driveFileId, userId, departmentId]
    )

    if (!rows[0]) return res.status(404).json({ error: 'File not found' })

    const { stream, mimeType } = await streamFile(req.params.driveFileId as string)
    res.setHeader('Content-Type', mimeType)
    res.setHeader('Cache-Control', 'private, max-age=86400')
    stream.on('error', next)
    stream.pipe(res)
  } catch (err) {
    next(err)
  }
})

export default router
