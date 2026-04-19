#!/usr/bin/env node
// One-shot migration runner for 0002_phase2_audit_and_deletion.sql.
// Usage: DATABASE_URL_ADMIN=... node scripts/apply-0002.mjs
// Drizzle-kit 0.36 handwritten SQL needs journal maintenance; after this
// script succeeds, regenerate the journal with `pnpm db:generate` so future
// migrations see the new snapshot baseline.

import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'

const here = dirname(fileURLToPath(import.meta.url))
const sqlPath = join(here, '..', 'src', 'db', 'migrations', '0002_phase2_audit_and_deletion.sql')

// DATABASE_URL connects as `neondb_owner` (owns the schema); only this
// role can CREATE TABLE in public. DATABASE_URL_ADMIN is `admin_user`
// which has BYPASSRLS at request time but not DDL privs.
const url = process.env.DATABASE_URL
if (!url) {
  console.error('DATABASE_URL not set')
  process.exit(1)
}
const sql = neon(url)

const raw = readFileSync(sqlPath, 'utf8')
// Strip line comments + split on `;` at statement boundaries. Neon HTTP
// driver rejects multi-statement prepared strings; run each statement
// separately.
const stripped = raw
  .split('\n')
  .filter((l) => !l.trim().startsWith('--'))
  .join('\n')
const statements = stripped
  .split(/;\s*$/m)
  .map((s) => s.trim())
  .filter(Boolean)

// neondb_owner session is pinned to `SET ROLE app_user` by default
// (PLAN.md build log 2026-04-17). Neon HTTP driver doesn't persist session
// state across separate queries, so stitch each statement to a leading
// RESET ROLE in a single prepared-statement string via raw text transaction.
const queries = [
  sql`RESET ROLE`,
  ...statements.map((s) => sql.query(s)),
]
await sql.transaction(queries)
console.log(`applied 0002_phase2_audit_and_deletion.sql (${statements.length} statements)`)
