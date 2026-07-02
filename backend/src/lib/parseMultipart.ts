import Busboy from 'busboy'
import type { IncomingHttpHeaders } from 'http'
import type { Request } from 'express'

export interface UploadedFile {
  fieldname: string
  filename: string
  mimetype: string
  buffer: Buffer
}

export function parseMultipart(
  req: Request,
  maxFileSize = 20 * 1024 * 1024
): Promise<{ fields: Record<string, string>; files: UploadedFile[] }> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({
      headers: req.headers as IncomingHttpHeaders,
      limits: { fileSize: maxFileSize, files: 5 },
    })

    const fields: Record<string, string> = {}
    const files: UploadedFile[] = []
    const pending: Promise<void>[] = []

    bb.on('field', (name, val) => { fields[name] = val })

    bb.on('file', (fieldname, stream, info) => {
      const p = new Promise<void>((res, rej) => {
        const chunks: Buffer[] = []
        stream.on('data', (c: Buffer) => chunks.push(c))
        stream.on('limit', () => rej(new Error('File too large (max 20 MB)')))
        stream.on('end', () => {
          files.push({ fieldname, filename: info.filename, mimetype: info.mimeType, buffer: Buffer.concat(chunks) })
          res()
        })
        stream.on('error', rej)
      })
      pending.push(p)
    })

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
