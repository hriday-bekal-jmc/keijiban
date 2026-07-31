/**
 * Checks that master-data changes reach connected clients with no page reload.
 *
 * Covers the two things that have broken here before:
 *   1. the SSE stream must not be gzipped (compression buffers it silently —
 *      curl hides this because it does not ask for gzip, browsers do)
 *   2. an admin write must announce MASTER_DATA to already-connected clients
 *
 * Run against a live server:  npm run check:live
 */
import assert from 'node:assert/strict'
import { pool, query } from '../config/db.js'
import { createAccessToken } from '../middleware/auth.js'

const BASE = process.env.CHECK_BASE_URL ?? 'http://localhost:3001/api'

const { rows: [admin] } = await query<{
  id: string; email: string; role: 'member' | 'admin'
  department_id: string; branch_id: string | null; can_post: boolean
}>(`SELECT id, email, role, department_id, branch_id, can_post
    FROM users WHERE role = 'admin' LIMIT 1`)
assert(admin, 'needs an admin user in the database')

const headers = {
  cookie: `session=${createAccessToken({
    id: admin.id, email: admin.email, role: admin.role,
    departmentId: admin.department_id, branchId: admin.branch_id, canPost: admin.can_post,
  })}`,
  'content-type': 'application/json',
}

// 1. Connect the way a browser does — Accept-Encoding: gzip is implicit here.
const stream = await fetch(`${BASE}/stream`, { headers })
assert.equal(stream.status, 200, 'SSE stream must connect')
assert.equal(stream.headers.get('content-encoding'), null,
  'SSE must not be compressed — gzip buffers events until the client gives up')

const events: Array<{ type: string; kind?: string }> = []
const reader = stream.body!.getReader()
void (async () => {
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    buf += decoder.decode(value, { stream: true })
    for (const line of buf.split('\n')) {
      if (line.startsWith('data: ')) events.push(JSON.parse(line.slice(6)))
    }
    buf = buf.slice(buf.lastIndexOf('\n') + 1)
  }
})().catch(() => { /* closed */ })

const settle = (): Promise<unknown> => new Promise(r => setTimeout(r, 700))
await settle()
assert(events.some(e => e.type === 'CONNECTED'), 'stream must deliver its first event promptly')

// 2. An admin adds a category; everyone already connected is told.
const name = `__check_${Date.now()}`
const created = await fetch(`${BASE}/categories`, {
  method: 'POST', headers, body: JSON.stringify({ name, color: '#123456' }),
})
const body = await created.json() as { item: { id: string } }
assert.equal(created.status, 201, JSON.stringify(body))
await settle()
assert.deepEqual(
  events.filter(e => e.type === 'MASTER_DATA'),
  [{ type: 'MASTER_DATA', kind: 'categories' }],
  'creating a category must announce MASTER_DATA'
)

const listed = await (await fetch(`${BASE}/categories`, { headers })).json() as { items: Array<{ name: string }> }
assert(listed.items.some(i => i.name === name), 'the new category must be readable immediately')

// 3. Clean up; deletes announce too.
const removed = await fetch(`${BASE}/categories/${body.item.id}`, { method: 'DELETE', headers })
assert.equal(removed.status, 200, await removed.text())
await settle()
assert.equal(events.filter(e => e.type === 'MASTER_DATA').length, 2, 'deleting must announce as well')

console.log('OK — stream uncompressed; create and delete both announced MASTER_DATA')
await reader.cancel()
await pool.end()
