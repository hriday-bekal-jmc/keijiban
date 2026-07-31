/**
 * Checks the branch axis of visibilitySQL against the real database.
 *
 * Members read only their own branch (plus 全社 posts, which carry no branch).
 * Admins moderate every site and are exempt from the branch axis — the
 * department axis still applies to them.
 *
 * Run:  npm run check:visibility
 */
import assert from 'node:assert/strict'
import { pool, query, visibilitySQL } from '../config/db.js'

const { rows: [author] } = await query<{ id: string; department_id: string }>(
  `SELECT id, department_id FROM users LIMIT 1`
)
assert(author, 'needs at least one user in the database')

const suffix = Date.now()
const { rows: [branchA] } = await query<{ id: string }>(
  `INSERT INTO branches (name, sort_order) VALUES ($1, 9000) RETURNING id`, [`__A_${suffix}`])
const { rows: [branchB] } = await query<{ id: string }>(
  `INSERT INTO branches (name, sort_order) VALUES ($1, 9001) RETURNING id`, [`__B_${suffix}`])

// A company-wide post that belongs to branch A. The department axis passes for
// everyone, so anything that filters it out is the branch axis doing its job.
const { rows: [post] } = await query<{ id: string }>(
  `INSERT INTO posts (author_id, title, content, visibility_scope, branch_id)
   VALUES ($1, $2, 'check', 'COMPANY_WIDE', $3) RETURNING id`,
  [author.id, `__check_${suffix}`, branchA!.id]
)

/** Rows a viewer with this branch and role can see of the test post. */
const visibleTo = async (branchId: string | null, isAdmin: boolean): Promise<number> => {
  const { rows } = await query(
    `SELECT 1 FROM posts p
     WHERE p.id = $4 AND p.deleted_at IS NULL AND ${visibilitySQL(1, 2, 3, isAdmin)}`,
    // A viewer who is not the author — the author always sees their own post.
    ['00000000-0000-4000-8000-000000000000', author.department_id, branchId, post!.id]
  )
  return rows.length
}

try {
  assert.equal(await visibleTo(branchA!.id, false), 1, 'member of the same branch must see it')
  assert.equal(await visibleTo(branchB!.id, false), 0, 'member of another branch must NOT see it')
  assert.equal(await visibleTo(null,        false), 0, 'unassigned member must NOT see a branch post')
  assert.equal(await visibleTo(branchB!.id, true),  1, 'admin must see every branch')
  assert.equal(await visibleTo(null,        true),  1, 'admin without a branch must still see it')
  console.log('OK — members are confined to their branch; admins see all branches')
} finally {
  await query(`DELETE FROM posts WHERE id = $1`, [post!.id])
  await query(`DELETE FROM branches WHERE id = ANY($1::uuid[])`, [[branchA!.id, branchB!.id]])
  await pool.end()
}
