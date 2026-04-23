// Append-only audit trail. Every security-relevant action calls `record`.
// Reads are user-scoped via RLS. See PLAN.md §2.

import { sqlUser, sqlAdmin, withRls } from '@/db/rls'

export type AuthEventKind =
  | 'sign_in'
  | 'sign_out'
  | 'credential_add'
  | 'credential_remove'
  | 'credential_verified'
  | 'credential_invalid'
  | 'decrypt_for_use'
  | 'account_delete_request'
  | 'account_delete_confirm'
  | 'account_delete_cancel'
  | 'account_delete_executed'
  | 'scratch_imported'
  | 'oauth_connected'
  | 'mobile_session_created'
  | 'mobile_session_refreshed'
  | 'mobile_session_revoked'

export interface AuthEventRow {
  id: string
  kind: string
  ip: string | null
  ua: string | null
  meta: Record<string, unknown>
  ts: string
}

interface RawRow {
  id: string | number | bigint
  kind: string
  ip: string | null
  ua: string | null
  meta: unknown
  ts: string | Date
}

function toPublic(r: RawRow): AuthEventRow {
  return {
    id: String(r.id),
    kind: r.kind,
    ip: r.ip,
    ua: r.ua,
    meta: (r.meta as Record<string, unknown>) ?? {},
    ts: typeof r.ts === 'string' ? r.ts : r.ts.toISOString(),
  }
}

// User-scoped insert — used inside request handlers where `userId` is
// the authed subject. Uses RLS (matches user_id).
export async function record(
  userId: string,
  kind: AuthEventKind | string,
  opts: { ip?: string | null; ua?: string | null; meta?: Record<string, unknown> } = {},
): Promise<void> {
  const sql = sqlUser()
  await withRls(userId, [
    sql`INSERT INTO auth_events (user_id, kind, ip, ua, meta)
        VALUES (${userId}, ${kind}, ${opts.ip ?? null}::inet, ${opts.ua ?? null}, ${JSON.stringify(opts.meta ?? {})}::jsonb)`,
  ])
}

// Admin insert — webhook handlers / cron. Used when no user session is
// available (e.g. scheduled executor).
export async function recordAdmin(
  userId: string,
  kind: AuthEventKind | string,
  opts: { ip?: string | null; ua?: string | null; meta?: Record<string, unknown> } = {},
): Promise<void> {
  const sql = sqlAdmin()
  await sql`INSERT INTO auth_events (user_id, kind, ip, ua, meta)
            VALUES (${userId}, ${kind}, ${opts.ip ?? null}::inet, ${opts.ua ?? null}, ${JSON.stringify(opts.meta ?? {})}::jsonb)`
}

export async function listEvents(
  userId: string,
  limit = 100,
): Promise<AuthEventRow[]> {
  const sql = sqlUser()
  const [rows] = await withRls<[RawRow[]]>(userId, [
    sql`SELECT id, kind, ip::text as ip, ua, meta, ts
        FROM auth_events
        WHERE user_id = ${userId}
        ORDER BY ts DESC
        LIMIT ${limit}`,
  ])
  return rows.map(toPublic)
}
