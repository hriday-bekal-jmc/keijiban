import { Router } from 'express'
import type { Request, Response } from 'express'
import { pool } from '../config/db.js'

const router = Router()

router.get('/', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1')
    res.json({ status: 'ok', db: 'ok' })
  } catch {
    res.status(503).json({ status: 'error', db: 'unreachable' })
  }
})

export default router
