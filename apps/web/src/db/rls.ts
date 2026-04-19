// RLS-scoped DB helper. Neon HTTP is stateless per request, so we wrap
// the GUC set + query in a single `sql.transaction([...])` call — the
// set_config applies only for that one transaction, and RLS policies
// evaluate `app.user_id` against it.
//
// This sidesteps the drizzle-orm 0.36 neon-http bug where db.execute()
// throws "can only be called as a tagged-template function" (see
// PLAN.md build log 2026-04-17). Drizzle's query builder stays usable
// for admin/non-RLS paths.

import {
  neon,
  type NeonQueryFunction,
  type NeonQueryPromise,
} from '@neondatabase/serverless'

let _sql: NeonQueryFunction<false, false> | null = null
let _adminSql: NeonQueryFunction<false, false> | null = null

export function sqlUser(): NeonQueryFunction<false, false> {
  if (!_sql) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is not set')
    _sql = neon(url)
  }
  return _sql
}

// Admin (BYPASSRLS) connection — use only in webhook handlers and
// migrations. Falls back to DATABASE_URL if ADMIN is not set so local
// dev doesn't require both URLs.
export function sqlAdmin(): NeonQueryFunction<false, false> {
  if (!_adminSql) {
    const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL_ADMIN / DATABASE_URL not set')
    _adminSql = neon(url)
  }
  return _adminSql
}

// Run `queries` in a single transaction with app.user_id bound to userId.
// Returns the results of `queries` (the set_config result is discarded).
export async function withRls<T extends unknown[]>(
  userId: string,
  queries: NeonQueryPromise<false, false>[],
): Promise<T> {
  const sql = sqlUser()
  const results = (await sql.transaction([
    sql`SELECT set_config('app.user_id', ${userId}, true)`,
    ...queries,
  ])) as unknown[]
  return results.slice(1) as T
}
