declare module 'busboy' {
  import type { IncomingHttpHeaders } from 'http'
  import type { Readable } from 'stream'
  import type { EventEmitter } from 'events'

  interface BusboyConfig {
    headers: IncomingHttpHeaders
    limits?: {
      fieldNameSize?: number
      fieldSize?: number
      fields?: number
      fileSize?: number
      files?: number
      parts?: number
      headerPairs?: number
    }
  }

  interface FileInfo {
    filename: string
    encoding: string
    mimeType: string
  }

  interface BusboyEvents {
    file: (fieldname: string, stream: Readable, info: FileInfo) => void
    field: (name: string, val: string, info: { nameTruncated: boolean; valueTruncated: boolean; encoding: string; mimeType: string }) => void
    /** Emitted when limits.files is exceeded; extra files are discarded */
    filesLimit: () => void
    /** Emitted when limits.fields is exceeded */
    fieldsLimit: () => void
    /** Emitted when limits.parts is exceeded */
    partsLimit: () => void
    finish: () => void
    error: (err: unknown) => void
  }

  interface Busboy extends EventEmitter {
    on<K extends keyof BusboyEvents>(event: K, listener: BusboyEvents[K]): this
  }

  function Busboy(config: BusboyConfig): Busboy
  export = Busboy
}
