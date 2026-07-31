import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import ExcelJS from 'exceljs'
import { query, UUID_RE, parsePage, logAudit } from '../config/db.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { sseManager } from '../services/sse.js'
import { runDriveSweep } from '../services/driveSweep.js'
import type { RequestWithUser } from '../types.js'

const router = Router()

const VALID_ROLES    = new Set(['member', 'admin'])
const MAX_NAME_LEN   = 100
const MAX_DEPT_LEN   = 100
const AUDIT_LOG_LIMIT = 100

// GET /api/admin/departments — available to all auth'd users (for composer dept picker)
router.get('/departments', requireAuth, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query('SELECT id, name FROM departments ORDER BY name')
    res.json({ departments: rows })
  } catch (err) { next(err) }
})

// POST /api/admin/departments — admin only
router.post('/departments', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { name } = req.body as { name?: string }
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' })
    if (name.trim().length > MAX_DEPT_LEN) {
      return res.status(400).json({ error: `Department name must be ${MAX_DEPT_LEN} characters or less` })
    }
    const { rows } = await query(
      'INSERT INTO departments (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING *',
      [name.trim()]
    )
    res.status(201).json({ department: rows[0] })
  } catch (err) { next(err) }
})

// POST /api/admin/users — pre-register a user (google_id linked on first login)
router.post('/users', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email, full_name, department_id, branch_id, role, can_post, chat_webhook_url } = req.body as {
      email?: string
      full_name?: string
      department_id?: string
      branch_id?: string | null
      role?: string
      can_post?: boolean
      chat_webhook_url?: string | null
    }

    if (!email?.trim()) return res.status(400).json({ error: 'Email required' })
    if (!full_name?.trim()) return res.status(400).json({ error: 'Name required' })
    if (!department_id || !UUID_RE.test(department_id)) return res.status(400).json({ error: 'Valid department required' })
    // Optional: null/omitted leaves the user unassigned, seeing 全社 posts only
    if (branch_id != null && branch_id !== '' && !UUID_RE.test(branch_id)) {
      return res.status(400).json({ error: 'Invalid branch_id' })
    }
    if (role !== undefined && !VALID_ROLES.has(role)) return res.status(400).json({ error: 'Invalid role' })
    if (full_name.trim().length > MAX_NAME_LEN) return res.status(400).json({ error: `Name must be ${MAX_NAME_LEN} chars or less` })
    if (chat_webhook_url) {
      if (!chat_webhook_url.startsWith('https://chat.googleapis.com')) {
        return res.status(400).json({ error: 'chat_webhook_url must start with https://chat.googleapis.com' })
      }
    }

    const normalEmail = email.trim().toLowerCase()

    const { rows: existing } = await query('SELECT id FROM users WHERE email = $1', [normalEmail])
    if (existing[0]) return res.status(409).json({ error: 'User with this email already exists' })

    const { rows } = await query(
      `INSERT INTO users (email, full_name, department_id, branch_id, role, can_post, chat_webhook_url)
       VALUES ($1, $2, $3, $4::uuid, $5, $6, $7)
       RETURNING id, email, full_name, role, department_id, branch_id, can_post, created_at`,
      [normalEmail, full_name.trim(), department_id, branch_id || null,
       role ?? 'member', can_post ?? true, chat_webhook_url || null]
    )

    const actorId = (req as RequestWithUser).user.id
    logAudit(actorId, 'USER_CREATE', rows[0].id, { email: normalEmail, role: role ?? 'member' })

    console.info('[admin:user-created]', { by: actorId, email: normalEmail })
    res.status(201).json({ user: rows[0] })
  } catch (err) { next(err) }
})

// GET /api/admin/users — paginated, optional ?search= over name/email (ILIKE,
// indexed via pg_trgm — see migration 014). Search runs server-side so a
// match outside the current page is still found instead of only filtering
// whatever the client happens to have already loaded.
router.get('/users', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { limit, offset } = parsePage(req.query, 50, 200)

    const { search } = req.query as Record<string, string | undefined>
    const term = search?.trim() ? `%${search.trim()}%` : null
    // Two independent param lists — same filter, different placeholder position
    // in each query, so a single `where` string can't serve both.
    const whereMain  = term ? 'WHERE u.full_name ILIKE $3 OR u.email ILIKE $3' : ''
    const whereCount = term ? 'WHERE u.full_name ILIKE $1 OR u.email ILIKE $1' : ''

    const [{ rows }, { rows: countRows }] = await Promise.all([
      query(
        `SELECT u.id, u.email, u.full_name, u.avatar_url, u.role, u.can_post,
                u.department_id, d.name AS department_name, u.created_at,
                u.branch_id, br.name AS branch_name,
                u.chat_webhook_url
         FROM users u
         JOIN departments d ON d.id = u.department_id
         LEFT JOIN branches br ON br.id = u.branch_id
         ${whereMain}
         ORDER BY u.created_at DESC
         LIMIT $1 OFFSET $2`,
        term ? [limit, offset, term] : [limit, offset]
      ),
      query(`SELECT COUNT(*)::int AS count FROM users u ${whereCount}`, term ? [term] : []),
    ])
    res.json({ users: rows, total: (countRows[0] as { count: number }).count })
  } catch (err) { next(err) }
})

// PUT /api/admin/users/:id — change dept, role, name, can_post
router.put('/users/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!UUID_RE.test(req.params.id as string)) return res.status(400).json({ error: 'Invalid user ID' })

    const { department_id, branch_id, role, full_name, can_post, chat_webhook_url } = req.body as {
      department_id?:    string
      branch_id?:        string | null
      role?:             string
      full_name?:        string
      can_post?:         boolean
      chat_webhook_url?: string | null
    }

    if (department_id !== undefined && !UUID_RE.test(department_id)) {
      return res.status(400).json({ error: 'Invalid department_id' })
    }
    // null is meaningful — it unassigns the user from any branch
    if (branch_id != null && !UUID_RE.test(branch_id)) {
      return res.status(400).json({ error: 'Invalid branch_id' })
    }
    if (role !== undefined && !VALID_ROLES.has(role)) {
      return res.status(400).json({ error: 'Invalid role — must be member or admin' })
    }
    if (full_name !== undefined && full_name.trim().length > MAX_NAME_LEN) {
      return res.status(400).json({ error: `full_name must be ${MAX_NAME_LEN} characters or less` })
    }
    if (chat_webhook_url !== undefined && chat_webhook_url !== null && chat_webhook_url !== '') {
      if (!chat_webhook_url.startsWith('https://chat.googleapis.com')) {
        return res.status(400).json({ error: 'chat_webhook_url must start with https://chat.googleapis.com' })
      }
    }

    // Normalize empty string to null (clears the webhook)
    const webhookVal = chat_webhook_url === '' ? null : (chat_webhook_url ?? undefined)

    const { rows } = await query(
      `UPDATE users
       SET department_id    = COALESCE($2, department_id),
           role             = COALESCE($3, role),
           full_name        = COALESCE($4, full_name),
           can_post         = COALESCE($5, can_post),
           chat_webhook_url = CASE WHEN $6::boolean THEN $7 ELSE chat_webhook_url END,
           branch_id        = CASE WHEN $8::boolean THEN $9::uuid ELSE branch_id END,
           updated_at       = now()
       WHERE id = $1
       RETURNING id, full_name, role, department_id, branch_id, can_post, chat_webhook_url`,
      [
        req.params.id,
        department_id ?? null,
        role ?? null,
        full_name?.trim() ?? null,
        can_post ?? null,
        chat_webhook_url !== undefined,  // $6: whether to update webhook
        webhookVal ?? null,              // $7: new value (null = clear)
        branch_id !== undefined,         // $8: whether to update branch
        branch_id ?? null,               // $9: new value (null = unassign)
      ]
    )
    if (!rows[0]) return res.status(404).json({ error: 'User not found' })

    const actorId = (req as RequestWithUser).user.id
    const auditDetail = {
      ...(department_id    !== undefined && { department_id }),
      ...(branch_id        !== undefined && { branch_id }),
      ...(role             !== undefined && { role }),
      ...(full_name        !== undefined && { full_name: full_name.trim() }),
      ...(can_post         !== undefined && { can_post }),
      ...(chat_webhook_url !== undefined && { chat_webhook_url: !!webhookVal }),
    }
    logAudit(actorId, 'USER_UPDATE', req.params.id as string, auditDetail)

    res.json({ user: rows[0] })
  } catch (err) { next(err) }
})

// POST /api/admin/posts/:id/pin — pin a post
router.post('/posts/:id/pin', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actorId = (req as RequestWithUser).user.id
    const { rows } = await query(
      `UPDATE posts SET is_pinned = TRUE, pinned_at = now(), pinned_by = $2
       WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [req.params.id as string, actorId]
    )
    if (!rows[0]) return res.status(404).json({ error: 'Post not found' })
    logAudit(actorId, 'POST_PIN', req.params.id as string)
    sseManager.broadcastAll({ type: 'PIN_POST', postId: req.params.id as string, isPinned: true })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// DELETE /api/admin/posts/:id/pin — unpin a post
router.delete('/posts/:id/pin', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actorId = (req as RequestWithUser).user.id
    const { rows } = await query(
      `UPDATE posts SET is_pinned = FALSE, pinned_at = NULL, pinned_by = NULL
       WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [req.params.id as string]
    )
    if (!rows[0]) return res.status(404).json({ error: 'Post not found' })
    logAudit(actorId, 'POST_UNPIN', req.params.id as string)
    sseManager.broadcastAll({ type: 'PIN_POST', postId: req.params.id as string, isPinned: false })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// GET /api/admin/audit-log
router.get('/audit-log', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { action, actor_id } = req.query as Record<string, string | undefined>
    const { limit, offset } = parsePage(req.query, 60, AUDIT_LOG_LIMIT)
    const params: unknown[] = [limit, offset]
    const conditions: string[] = []

    if (action) {
      params.push(action.toUpperCase())
      conditions.push(`a.action = $${params.length}`)
    }
    if (actor_id) {
      if (!UUID_RE.test(actor_id)) return res.status(400).json({ error: 'Invalid actor_id' })
      params.push(actor_id)
      conditions.push(`a.actor_id = $${params.length}::uuid`)
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const { rows } = await query(
      `SELECT
         a.id, a.action, a.target_id, a.detail, a.created_at,
         u.id        AS actor_id,
         u.full_name AS actor_name,
         u.email     AS actor_email,
         p.title     AS target_post_title
       FROM audit_log a
       JOIN users u ON u.id = a.actor_id
       LEFT JOIN posts p ON p.id = a.target_id
       ${where}
       ORDER BY a.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    )

    res.json({ logs: rows })
  } catch (err) { next(err) }
})

// POST /api/admin/webhooks/import — upload Excel, match by アドレス column, set chat_webhook_url
// Accepts raw binary body (Content-Type: application/octet-stream or any)
router.post('/webhooks/import', requireAdmin,
  // Allow raw binary body (xlsx file) up to 10 MB
  (req, _res, next) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => { (req as any).rawBody = Buffer.concat(chunks); next() })
    req.on('error', next)
  },
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const buf: Buffer = (req as any).rawBody
      if (!buf || buf.length === 0) return res.status(400).json({ error: 'No file data received' })

      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(buf as any)
      const ws = wb.worksheets[0]
      if (!ws) return res.status(400).json({ error: 'ワークシートが見つかりません' })

      // Map header row → column indexes
      const headers: Record<string, number> = {}
      ws.getRow(1).eachCell((cell, col) => { headers[String(cell.text).trim()] = col })
      const emailCol = headers['アドレス']
      const hookCol  = headers['Google Chat WebHook']
      if (!emailCol || !hookCol) {
        return res.status(400).json({ error: 'ヘッダー行に「アドレス」「Google Chat WebHook」列が必要です' })
      }

      let updated = 0
      let skipped = 0

      for (let i = 2; i <= ws.rowCount; i++) {
        const row = ws.getRow(i)
        const email      = String(row.getCell(emailCol).text ?? '').trim().toLowerCase()
        const webhookUrl = String(row.getCell(hookCol).text ?? '').trim()

        if (!email || !webhookUrl || !webhookUrl.startsWith('https://')) {
          skipped++
          continue
        }

        const { rowCount } = await query(
          `UPDATE users SET chat_webhook_url = $1 WHERE LOWER(email) = $2`,
          [webhookUrl, email]
        )
        if ((rowCount ?? 0) > 0) updated++
        else skipped++
      }

      res.json({ ok: true, updated, skipped })
    } catch (err) {
      next(err)
    }
  }
)

// POST /api/admin/drive/sweep — run the orphan sweep on demand.
// ?dryRun=1 reports what would be deleted without touching anything; worth
// running first after enabling Drive.
router.post('/drive/sweep', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const dryRun = req.query.dryRun !== undefined
    const result = await runDriveSweep({ dryRun })
    logAudit((req as RequestWithUser).user.id, 'DRIVE_SWEEP', (req as RequestWithUser).user.id, result)
    res.json(result)
  } catch (err) {
    // Unconfigured Drive is an operator problem, not a server fault
    const msg = (err as Error).message
    if (/not configured|required/i.test(msg)) return res.status(503).json({ error: msg })
    next(err)
  }
})

// GET /api/admin/webhooks — list users with their webhook status
router.get('/webhooks', requireAdmin, async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const { rows } = await query(
      `SELECT id, full_name, email,
              CASE WHEN chat_webhook_url IS NOT NULL THEN TRUE ELSE FALSE END AS has_webhook
       FROM users
       ORDER BY full_name`
    )
    res.json({ users: rows })
  } catch (err) { next(err) }
})

export default router
