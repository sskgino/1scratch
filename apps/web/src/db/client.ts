// Per-request Postgres client that sets the `app.user_id` GUC so RLS
// policies in migrations/0001_rls.sql can scope every query.
//
// Usage (server only):
//   const db = await dbForUser(userId)
//   const rows = await db.select().from(cards)        // RLS auto-filters

import { neon, neonConfig } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { sql } from 'drizzle-orm'
import * as schema from './schema'

neonConfig.fetchConnectionCache = true

let _baseDb: ReturnType<typeof drizzle<typeof schema>> | null = null

function baseDb() {
  if (!_baseDb) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    _baseDb = drizzle(neon(url), { schema })
  }
  return _baseDb
}

export async function dbForUser(userId: string) {
  const db = baseDb()
  // SET LOCAL would only work inside an explicit transaction; with the
  // HTTP driver every statement is its own transaction, so we use the
  // session-scoped form. Neon's HTTP driver pools per fetch — the GUC
  // resets between requests so cross-tenant leaks are not possible.
  await db.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`)
  return db
}

export function rawDb() {
  return baseDb()
}
