import pg from 'pg'
import { env } from './env.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // Without a cap, one slow query holds a connection indefinitely; enough of
  // them exhaust the pool and every later request fails on connect timeout —
  // a total API outage caused by a single slow page.
  statement_timeout: 10_000,
  idle_in_transaction_session_timeout: 15_000,
})

pool.on('error', (err: Error) => {
  console.error('Unexpected DB pool error', err)
})

export const query = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> => pool.query<T>(text, params)

/** Parameterised visibility clause for posts table aliased as `p`.
 *
 *  Two independent axes, both of which must pass:
 *   - department scope: COMPANY_WIDE, or the viewer's department is targeted
 *   - branch scope: the post has no branch (全社), or it matches the viewer's
 *
 *  The author always sees their own post regardless of either.
 *
 *  Admins are exempt from the branch axis only — they moderate every site, so
 *  they read and filter across all branches. The department axis still applies
 *  to them: 部署内 posts stay within their department.
 *
 *  @param userParam   — SQL param index for the viewer's user_id
 *  @param deptParam   — SQL param index for the viewer's department_id
 *  @param branchParam — SQL param index for the viewer's branch_id
 *  @param isAdmin     — required, not defaulted: adding it deliberately broke
 *                       every call site so each one had to be reviewed
 */
export function visibilitySQL(
  userParam: number, deptParam: number, branchParam: number, isAdmin: boolean,
): string {
  const branchScope = isAdmin
    // Always true, but it still references the parameter: every caller passes
    // the same params for both roles, and Postgres rejects a statement that
    // declares a parameter it never uses. The planner folds this to TRUE.
    ? `($${branchParam}::uuid IS NOT NULL OR TRUE)`
    : `(p.branch_id IS NULL OR p.branch_id = $${branchParam}::uuid)`
  return `(
    p.author_id = $${userParam}
    OR (
      (p.visibility_scope = 'COMPANY_WIDE'
        OR EXISTS (SELECT 1 FROM post_departments pd WHERE pd.post_id = p.id AND pd.department_id = $${deptParam}))
      AND ${branchScope}
    )
  )`
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** SQL fragment: vibe is only valid if set today (JST midnight boundary).
 *  Column is unqualified — valid wherever exactly one table in scope has vibe_set_at (users). */
export const VIBE_TODAY_SQL = `
  date_trunc('day', vibe_set_at AT TIME ZONE 'Asia/Tokyo')
  = date_trunc('day', now() AT TIME ZONE 'Asia/Tokyo')
`

/** Clamped limit/offset pagination params from the query string. */
export function parsePage(
  q: Record<string, unknown>, defLimit: number, maxLimit: number,
): { limit: number; offset: number } {
  return {
    limit:  Math.min(parseInt((q.limit  as string) ?? String(defLimit)) || defLimit, maxLimit),
    offset: Math.max(parseInt((q.offset as string) ?? '0') || 0, 0),
  }
}

/** Fire-and-forget audit-log insert — never blocks or fails the request. */
export function logAudit(
  actorId: string, action: string, targetId: string, detail?: unknown,
): void {
  const params = detail === undefined
    ? [actorId, action, targetId]
    : [actorId, action, targetId, JSON.stringify(detail)]
  query(
    detail === undefined
      ? `INSERT INTO audit_log (actor_id, action, target_id) VALUES ($1, $2, $3)`
      : `INSERT INTO audit_log (actor_id, action, target_id, detail) VALUES ($1, $2, $3, $4)`,
    params
  ).catch(err => console.error(`[audit] ${action}:`, err))
}

/** Post visible to the viewer (not deleted, dept + branch scope), or null. */
export async function resolveVisiblePost(
  postId: string, userId: string, departmentId: string, branchId: string | null,
  isAdmin: boolean,
): Promise<{ id: string; author_id: string } | null> {
  const { rows } = await query(
    `SELECT id, author_id FROM posts p WHERE p.id = $1 AND p.deleted_at IS NULL AND ${visibilitySQL(2, 3, 4, isAdmin)}`,
    [postId, userId, departmentId, branchId]
  )
  return (rows[0] as { id: string; author_id: string } | undefined) ?? null
}
