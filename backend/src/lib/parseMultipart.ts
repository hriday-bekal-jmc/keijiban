import Busboy from 'busboy'
import type { IncomingHttpHeaders } from 'http'
import type { Request } from 'express'

export interface UploadedFile {
  fieldname: string
  filename: string
  mimetype: string
  buffer: Buffer
}

interface ParseOptions {
  maxFileSize?: number
  /** Busboy drops files past this silently, so we surface it as an error
   *  instead — a vanished upload is worse than a rejected one. */
  maxFiles?: number
  /** Everything is buffered in memory, so the per-file cap alone is not a
   *  sufficient bound once many files are allowed. */
  maxTotalBytes?: number
}

export function parseMultipart(
  req: Request,
  { maxFileSize = 20 * 1024 * 1024, maxFiles = 50, maxTotalBytes = 150 * 1024 * 1024 }: ParseOptions = {}
): Promise<{ fields: Record<string, string>; files: UploadedFile[] }> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: req.headers as IncomingHttpHeaders,
      limits: { fileSize: maxFileSize, files: maxFiles },
    })

    const fields: Record<string, string> = {}
    const files: UploadedFile[] = []
    const pending: Promise<void>[] = []
    let totalBytes = 0

    bb.on('field', (name, val) => { fields[name] = val })

    bb.on('file', (fieldname, stream, info) => {
      const p = new Promise<void>((res, rej) => {
        const chunks: Buffer[] = []
        stream.on('data', (c: Buffer) => {
          totalBytes += c.length
          if (totalBytes > maxTotalBytes) {
            rej(new Error(`Upload too large (max ${Math.floor(maxTotalBytes / 1024 / 1024)} MB total)`))
            return
          }
          chunks.push(c)
        })
        stream.on('limit', () => rej(new Error(`File too large (max ${Math.floor(maxFileSize / 1024 / 1024)} MB)`)))
        stream.on('end', () => {
          files.push({ fieldname, filename: info.filename, mimetype: info.mimeType, buffer: Buffer.concat(chunks) })
          res()
        })
        stream.on('error', rej)
      })
      pending.push(p)
    })

    // Busboy ignores files beyond `limits.files` without raising — fail loudly
    // so an image can never disappear between the editor and the post.
    bb.on('filesLimit', () => reject(new Error(`Too many files in one upload (max ${maxFiles})`)))

    bb.on('finish', async () => {
      try {
        await Promise.all(pending)
        resolve({ fields, files })
      } catch (err) {
        reject(err)
      }
    })

    bb.on('error', reject)
    req.on('error', reject)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req.pipe(bb as any)
  })
}
