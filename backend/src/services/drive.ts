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

async function makePublic(drive: ReturnType<typeof getDrive>, fileId: string) {
  await drive.permissions.create({
    fileId,
    requestBody: { role: 'reader', type: 'anyone' },
    supportsAllDrives: true,
  })
}

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
  await makePublic(drive, fileId)

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

    const thumbId = thumbCreated.data.id!
    await makePublic(drive, thumbId)
    thumbnailPath = `/api/uploads/${thumbId}/content`
  }

  return {
    driveFileId: fileId,
    driveUrl: created.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`,
    thumbnailPath,
    finalMimeType: uploadMime,
  }
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
