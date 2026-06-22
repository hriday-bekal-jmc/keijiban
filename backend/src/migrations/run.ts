import { readdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { pool } from '../config/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const files: string[] = readdirSync(__dirname)
  .filter((f: string) => f.endsWith('.sql'))
  .sort()

for (const file of files) {
  const sql: string = readFileSync(join(__dirname, file), 'utf8')
  try {
    await pool.query(sql)
    console.log(`✓ ${file}`)
  } catch (err) {
    console.error(`✗ ${file}:`, (err as Error).message)
    process.exit(1)
  }
}

await pool.end()
console.log('All migrations applied.')
