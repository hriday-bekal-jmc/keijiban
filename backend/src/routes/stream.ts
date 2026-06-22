import { Router, Request, Response } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { sseManager } from '../services/sse.js'
import type { RequestWithUser } from '../types.js'

const router = Router()

router.get('/', requireAuth, (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // tell Nginx not to buffer
  res.flushHeaders()

  const userId = (req as RequestWithUser).user.id
  sseManager.add(userId, res)

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED' })}\n\n`)

  req.on('close', () => sseManager.remove(userId, res))
})

export default router
