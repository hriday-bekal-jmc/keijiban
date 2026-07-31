import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { query, UUID_RE, logAudit } from '../config/db.js'
import { requireAuth, requireAdmin } from '../middleware/auth.js'
import type { RequestWithUser } from '../types.js'

const router = Router()

const MAX_NAME_LEN = 60
const VALID_PATTERNS = new Set(['none', 'dots', 'grid', 'rays'])
const HEX_COLOR = /^#[0-9a-f]{6}$/i

/**
 * `background` is admin-supplied CSS that ends up in a style attribute, so it
 * is validated against an allowlist rather than sanitised: gradients and
 * colour literals only. This blocks `url(...)` (which could beacon out to a
 * third party or pull remote content), extra declarations via `;`, rule
 * escapes via `{}`, and attribute-breaking quotes. The page CSP is a second
 * layer, but the value should never be storable in the first place.
 */
export function isSafeBackground(css: string): boolean {
  const v = css.trim()
  if (!v || v.length > 400) return false
  if (/url\(|expression|javascript:|@import|[;{}<>"']/i.test(v)) return false
  if (!/^(#|rgb|rgba|hsl|hsla|linear-gradient|radial-gradient|conic-gradient|repeating-linear-gradient)/i.test(v)) return false
  // Whatever remains may only be colour/gradient syntax
  return /^[#a-z0-9(),.%\s-]+$/i.test(v)
}

interface PresetBody {
  name?: string
  background?: string
  text_color?: string
  pattern?: string
  sort_order?: number
  is_active?: boolean
}

/** Returns an error string when invalid, or null when the body is acceptable. */
function validatePreset(b: PresetBody, { partial }: { partial: boolean }): string | null {
  if (!partial || b.name !== undefined) {
    if (!b.name?.trim()) return '名前が必要です'
    if (b.name.trim().length > MAX_NAME_LEN) return `名前は${MAX_NAME_LEN}文字以内にしてください`
  }
  if (!partial || b.background !== undefined) {
    if (!b.background?.trim()) return '背景が必要です'
    if (!isSafeBackground(b.background)) {
      return '背景はグラデーションまたは色の指定のみ使用できます'
    }
  }
  if (b.text_color !== undefined && !HEX_COLOR.test(b.text_color)) {
    return '文字色は #RRGGBB 形式で指定してください'
  }
  if (b.pattern !== undefined && !VALID_PATTERNS.has(b.pattern)) {
    return '不明なパターンです'
  }
  if (b.sort_order !== undefined && !Number.isInteger(b.sort_order)) {
    return '並び順は整数で指定してください'
  }
  return null
}

// GET /api/thumbnails — preset library. Every authenticated user needs this to
// render existing posts and to pick a design in the composer. Admins also get
// deactivated presets so they can manage them.
router.get('/', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const isAdmin = (req as RequestWithUser).user.role === 'admin'
    const { rows } = await query(
      `SELECT id, name, background, text_color, pattern, sort_order, is_active
       FROM thumbnail_presets
       ${isAdmin ? '' : 'WHERE is_active = TRUE'}
       ORDER BY sort_order, name`
    )
    res.json({ presets: rows })
  } catch (err) { next(err) }
})

// POST /api/thumbnails — admin only
router.post('/', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = req.body as PresetBody
    const invalid = validatePreset(body, { partial: false })
    if (invalid) return res.status(400).json({ error: invalid })

    const { rows } = await query(
      `INSERT INTO thumbnail_presets (name, background, text_color, pattern, sort_order)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO NOTHING
       RETURNING id, name, background, text_color, pattern, sort_order, is_active`,
      [
        body.name!.trim(),
        body.background!.trim(),
        body.text_color ?? '#FFFFFF',
        body.pattern ?? 'none',
        body.sort_order ?? 0,
      ]
    )
    if (!rows[0]) return res.status(409).json({ error: '同じ名前のデザインが既にあります' })

    logAudit((req as RequestWithUser).user.id, 'THUMBNAIL_CREATE', rows[0].id, { name: rows[0].name })
    res.status(201).json({ preset: rows[0] })
  } catch (err) { next(err) }
})

// PUT /api/thumbnails/:id — admin only; partial update
router.put('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!UUID_RE.test(req.params.id as string)) return res.status(400).json({ error: 'Invalid preset ID' })
    const body = req.body as PresetBody
    const invalid = validatePreset(body, { partial: true })
    if (invalid) return res.status(400).json({ error: invalid })

    const { rows } = await query(
      `UPDATE thumbnail_presets
       SET name       = COALESCE($2, name),
           background = COALESCE($3, background),
           text_color = COALESCE($4, text_color),
           pattern    = COALESCE($5, pattern),
           sort_order = COALESCE($6, sort_order),
           is_active  = COALESCE($7, is_active)
       WHERE id = $1
       RETURNING id, name, background, text_color, pattern, sort_order, is_active`,
      [
        req.params.id,
        body.name?.trim() ?? null,
        body.background?.trim() ?? null,
        body.text_color ?? null,
        body.pattern ?? null,
        body.sort_order ?? null,
        body.is_active ?? null,
      ]
    )
    if (!rows[0]) return res.status(404).json({ error: 'デザインが見つかりません' })

    logAudit((req as RequestWithUser).user.id, 'THUMBNAIL_UPDATE', req.params.id as string, { name: rows[0].name })
    res.json({ preset: rows[0] })
  } catch (err) { next(err) }
})

// DELETE /api/thumbnails/:id — admin only.
// Posts referencing it fall back to the plain style (FK is ON DELETE SET NULL).
router.delete('/:id', requireAdmin, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!UUID_RE.test(req.params.id as string)) return res.status(400).json({ error: 'Invalid preset ID' })
    const { rows } = await query(
      'DELETE FROM thumbnail_presets WHERE id = $1 RETURNING name', [req.params.id]
    )
    if (!rows[0]) return res.status(404).json({ error: 'デザインが見つかりません' })

    logAudit((req as RequestWithUser).user.id, 'THUMBNAIL_DELETE', req.params.id as string, { name: rows[0].name })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
