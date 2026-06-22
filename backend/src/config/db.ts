import pg from 'pg'
import { env } from './env.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
})

pool.on('error', (err: Error) => {
  console.error('Unexpected DB pool error', err)
})

export const query = <T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> => pool.query<T>(text, params)
