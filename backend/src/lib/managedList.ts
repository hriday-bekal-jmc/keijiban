import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { query, UUID_RE, logAudit } from '../config/db.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import { sseManager } from '../services/sse.js'
import type { RequestWithUser } from '../types.js'

const HEX_COLOR = /^#[0-9a-f]{6}$/i

interface Options {
  /** Table name. Interpolated into SQL, so only ever a literal from our code. */
  table: string
  /** Audit action prefix, e.g. 'BRANCH' → BRANCH_CREATE / BRANCH_UPDATE. */
  audit: string
  maxNameLen: number
  /** Whether the table carries a `color` column. */
  hasColor: boolean
}

/**
 * Branches and categories are the same thing structurally: a small
 * admin-curated list of named, ordered, deactivatable rows that everyone can
 * read and only admins can change. One factory rather than two near-identical
 * route files — the only real difference is whether rows carry a colour.
 */
export function managedListRouter({ table, audit, maxNameLen, hasColor }: Options): Router {
  const router = Router()
  const cols = `id, name, ${hasColor ? 'color, ' : ''}sort_order, is_active`

  // Tell every connected client the list changed, so a new 拠点 or カテゴリ
  // appears in their pickers and filters without them reloading the page.
  const announce = (): void => sseManager.broadcastAll({ type: 'MASTER_DATA', kind: table })

  interface Body {
    name?: string
    color?: string
    sort_order?: number
    is_active?: boolean
  }

  const validate = (b: Body, partial: boolean): string | null => {
    if (!partial || b.name !== undefined) {
      if (!b.name?.trim()) return '名前が必要です'
      if (b.name.trim().length > maxNameLen) return `名前は${maxNameLen}文字以内にしてください`
    }
    if (hasColor && b.color !== undefined && !HEX_COLOR.test(b.color)) {
      return '色は #RRGGBB 形式で指定してください'
    }
    if (b.sort_order !== undefined && !Number.isInteger(b.sort_order)) {
      return '並び順は整数で指定してください'
    }
    return null
  }

  // Everyone reads the list — it is needed to render posts and to filter.
  // Admins additionally see deactivated rows so they can manage them.
  router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const isAdmin = (req as RequestWithUser).user.role === 'admin'
      const { rows } = await query(
        `SELECT ${cols} FROM ${table}
         ${isAdmin ? '' : 'WHERE is_active = TRUE'}
         ORDER BY sort_order, name`
      )
      res.json({ items: rows })
    } catch (err) { next(err) }
  })

  router.post('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const b = req.body as Body
      const invalid = validate(b, false)
      if (invalid) return res.status(400).json({ error: invalid })

      const fields = hasColor ? 'name, color, sort_order' : 'name, sort_order'
      const values = hasColor ? '$1, $2, $3' : '$1, $2'
      const params = hasColor
        ? [b.name!.trim(), b.color ?? '#1E5FA8', b.sort_order ?? 0]
        : [b.name!.trim(), b.sort_order ?? 0]

      const { rows } = await query(
        `INSERT INTO ${table} (${fields}) VALUES (${values})
         ON CONFLICT (name) DO NOTHING
         RETURNING ${cols}`,
        params
      )
      if (!rows[0]) return res.status(409).json({ error: '同じ名前が既に存在します' })

      logAudit((req as RequestWithUser).user.id, `${audit}_CREATE`, rows[0].id, { name: rows[0].name })
      announce()
      res.status(201).json({ item: rows[0] })
    } catch (err) { next(err) }
  })

  router.put('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!UUID_RE.test(req.params.id as string)) return res.status(400).json({ error: 'Invalid ID' })
      const b = req.body as Body
      const invalid = validate(b, true)
      if (invalid) return res.status(400).json({ error: invalid })

      const { rows } = await query(
        `UPDATE ${table}
         SET name       = COALESCE($2, name),
             ${hasColor ? 'color = COALESCE($5, color),' : ''}
             sort_order = COALESCE($3, sort_order),
             is_active  = COALESCE($4, is_active)
         WHERE id = $1
         RETURNING ${cols}`,
        hasColor
          ? [req.params.id, b.name?.trim() ?? null, b.sort_order ?? null, b.is_active ?? null, b.color ?? null]
          : [req.params.id, b.name?.trim() ?? null, b.sort_order ?? null, b.is_active ?? null]
      )
      if (!rows[0]) return res.status(404).json({ error: '見つかりません' })

      logAudit((req as RequestWithUser).user.id, `${audit}_UPDATE`, req.params.id as string, { name: rows[0].name })
      announce()
      res.json({ item: rows[0] })
    } catch (err) { next(err) }
  })

  // Most references degrade to "unassigned" (ON DELETE SET NULL) or vanish
  // (CASCADE), but departments are referenced by users.department_id which is
  // NOT NULL — deleting one that is still in use raises a foreign-key
  // violation. Report that as a 409 the admin can act on rather than a 500.
  router.delete('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!UUID_RE.test(req.params.id as string)) return res.status(400).json({ error: 'Invalid ID' })
      const { rows } = await query(`DELETE FROM ${table} WHERE id = $1 RETURNING name`, [req.params.id])
      if (!rows[0]) return res.status(404).json({ error: '見つかりません' })

      logAudit((req as RequestWithUser).user.id, `${audit}_DELETE`, req.params.id as string, { name: rows[0].name })
      announce()
      res.json({ ok: true })
    } catch (err) {
      if ((err as { code?: string }).code === '23503') {
        return res.status(409).json({
          error: '使用中のため削除できません。先に所属を変更するか、無効化してください。',
        })
      }
      next(err)
    }
  })

  return router
}
