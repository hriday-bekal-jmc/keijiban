import type { ErrorRequestHandler } from 'express'

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const status: number =
    (err as { status?: number; statusCode?: number }).status
    || (err as { status?: number; statusCode?: number }).statusCode
    || 500

  if (status >= 500) {
    // Log full error server-side only — never expose stack or DB internals to client
    console.error('[error]', { method: req.method, path: req.path, err })
    return res.status(status).json({ error: 'Internal server error' })
  }

  // 4xx: expected client errors — safe to surface the message
  console.info('[http-error]', { status, path: req.path, message: (err as Error).message })
  res.status(status).json({ error: (err as Error).message || 'Bad request' })
}
