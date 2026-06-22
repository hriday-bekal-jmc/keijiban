import type { ErrorRequestHandler } from 'express'

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  console.error(err)
  const status: number = (err as { status?: number; statusCode?: number }).status
    || (err as { status?: number; statusCode?: number }).statusCode
    || 500
  res.status(status).json({ error: (err as Error).message || 'Internal server error' })
}
