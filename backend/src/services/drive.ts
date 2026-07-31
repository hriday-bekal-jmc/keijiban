import { google } from 'googleapis'
import { Readable } from 'stream'
import sharp from 'sharp'
import { fileTypeFromBuffer } from 'file-type'
import { env } from '../config/env.js'

const ALLOWED_MIME = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

// Magic-byte signatures the detected content may legitimately have.
// OOXML (docx/xlsx/pptx) detects as its exact mime or generic zip;
// legacy Office (doc/xls/ppt) detects as CFB. Images must detect as images
// (sharp re-encodes them anyway, which is the stronger guarantee).
const DETECTED_OK = new Set([
  'application/pdf',
  'application/zip',
  'application/x-cfb',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

function getDrive() {
  if (!env.googleServiceAccountKey) throw new Error('Drive not configured')
  const auth = new google.auth.GoogleAuth({
    credentials: env.googleServiceAccountKey as object,
    scopes: ['https://www.googleapis.com/auth/drive'],
  })
  return google.drive({ version: 'v3', auth })
}

// Files are deliberately NOT shared publicly. Everything is served through
// GET /api/uploads/:driveFileId/content, which authenticates the caller and
// checks they can see the owning post before streaming bytes via the service
// account. A public "anyone with the link" grant would let a leaked file id
// bypass that check entirely — including for DEPARTMENT-scoped posts.

export interface DriveUploadResult {
  driveFileId: string
  driveUrl: string
  thumbnailPath: string | null
  finalMimeType: string
}

export async function uploadFile(
  buffer: Buffer,
  originalFilename: string,
  mimeType: string
): Promise<DriveUploadResult> {
  if (!ALLOWED_MIME.has(mimeType)) throw new Error(`File type not allowed: ${mimeType}`)

  // Never trust the client's Content-Type — verify the actual bytes.
  const isImage = mimeType.startsWith('image/')
  const detected = await fileTypeFromBuffer(buffer)
  if (isImage) {
    if (!detected?.mime.startsWith('image/')) throw new Error('File content is not an image')
  } else if (!detected || !DETECTED_OK.has(detected.mime)) {
    throw new Error(`File content does not match declared type: ${mimeType}`)
  }

  const drive = getDrive()

  let uploadBuffer = buffer
  let uploadMime = mimeType
  let filename = originalFilename

  if (isImage) {
    uploadBuffer = await sharp(buffer)
      .resize({ width: 1600, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
    uploadMime = 'image/jpeg'
    filename = filename.replace(/\.[^.]+$/, '.jpg')
  }

  const fileMeta: { name: string; parents?: string[] } = { name: filename }
  if (env.driveSharedDriveId) fileMeta.parents = [env.driveSharedDriveId]

  const created = await drive.files.create({
    requestBody: fileMeta,
    media: { mimeType: uploadMime, body: Readable.from(uploadBuffer) },
    fields: 'id,webViewLink',
    supportsAllDrives: !!env.driveSharedDriveId,
  })

  const fileId = created.data.id!

  let thumbnailPath: string | null = null

  if (isImage) {
    const thumbBuf = await sharp(buffer)
      .resize({ width: 800, withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer()

    const thumbMeta: { name: string; parents?: string[] } = { name: `thumb_${filename}` }
    if (env.driveSharedDriveId) thumbMeta.parents = [env.driveSharedDriveId]

    const thumbCreated = await drive.files.create({
      requestBody: thumbMeta,
      media: { mimeType: 'image/jpeg', body: Readable.from(thumbBuf) },
      fields: 'id',
      supportsAllDrives: !!env.driveSharedDriveId,
    })

    thumbnailPath = `/api/uploads/${thumbCreated.data.id!}/content`
  }

  return {
    driveFileId: fileId,
    driveUrl: created.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`,
    thumbnailPath,
    finalMimeType: uploadMime,
  }
}

// ── Orphan sweep ──────────────────────────────────────────────────────────────

/** Files younger than this are never touched: an upload that has reached Drive
 *  but whose attachments row is still being written must not be collected. */
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000
/** Bounded so one pass can never runaway-delete or hammer the API. */
const SWEEP_MAX_DELETES = 200

export interface SweepResult { scanned: number; orphaned: number; deleted: number; dryRun: boolean }

/**
 * Deletes Drive files the database no longer references.
 *
 * Orphans come from partially-failed uploads and from hard-deleted posts
 * (attachments cascade away, the Drive objects do not). Each attachment row
 * points at two files — the full-size `drive_file_id` and the thumbnail id
 * embedded in `thumbnail_path` — so both are collected as "referenced".
 *
 * Only ever runs inside the configured shared drive, only on files older than
 * ORPHAN_MIN_AGE_MS, and only up to SWEEP_MAX_DELETES per pass.
 */
export async function sweepOrphanedDriveFiles(
  referencedIds: Set<string>,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<SweepResult> {
  if (!env.googleServiceAccountKey) throw new Error('Drive not configured')
  // Without a shared drive we cannot scope the listing, and enumerating the
  // service account's whole Drive risks deleting something unrelated.
  if (!env.driveSharedDriveId) throw new Error('DRIVE_SHARED_DRIVE_ID required for the orphan sweep')

  const drive = getDrive()
  const cutoff = new Date(Date.now() - ORPHAN_MIN_AGE_MS).toISOString()
  const result: SweepResult = { scanned: 0, orphaned: 0, deleted: 0, dryRun }

  let pageToken: string | undefined
  do {
    const list = await drive.files.list({
      corpora: 'drive',
      driveId: env.driveSharedDriveId,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
      q: `'${env.driveSharedDriveId}' in parents and trashed = false and createdTime < '${cutoff}'`,
      fields: 'nextPageToken, files(id, name, createdTime)',
      pageSize: 200,
      pageToken,
    })

    for (const f of list.data.files ?? []) {
      result.scanned++
      if (!f.id || referencedIds.has(f.id)) continue
      result.orphaned++
      if (dryRun || result.deleted >= SWEEP_MAX_DELETES) continue
      try {
        await drive.files.delete({ fileId: f.id, supportsAllDrives: true })
        result.deleted++
      } catch (err) {
        console.error('[drive-sweep] delete failed', { fileId: f.id, message: (err as Error).message })
      }
    }
    pageToken = list.data.nextPageToken ?? undefined
  } while (pageToken && result.deleted < SWEEP_MAX_DELETES)

  return result
}

export async function streamFile(driveFileId: string): Promise<{ stream: NodeJS.ReadableStream; mimeType: string }> {
  const drive = getDrive()
  const metaRes = await drive.files.get({ fileId: driveFileId, fields: 'mimeType', supportsAllDrives: true })
  const mimeType = metaRes.data.mimeType ?? 'application/octet-stream'
  const streamRes = await drive.files.get(
    { fileId: driveFileId, alt: 'media', supportsAllDrives: true },
    { responseType: 'stream' }
  )
  return { stream: streamRes.data as unknown as NodeJS.ReadableStream, mimeType }
}
