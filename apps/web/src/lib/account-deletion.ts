// Account deletion with a 24-hr cool-off window. PLAN.md §5.
//
// Flow:
//   1. request(userId)              → insert pending row, return {token, requestId}
//                                     token is sent to user via email; only its hash is stored
//   2. confirm(token)               → flip pending → confirmed (starts 24-hr clock)
//   3. cancel(userId)               → flip pending|confirmed → cancelled
//   4. listDueForExecution()        → cron: rows with status=confirmed AND executes_after <= now
//   5. execute(requestId, userId)   → delete the user row (FKs cascade everything else)

import { createHash, randomBytes } from 'node:crypto'
import { sqlUser, sqlAdmin, withRls } from '@/db/rls'

export const COOL_OFF_MS = 24 * 60 * 60 * 1000

export type DeletionStatus = 'pending' | 'confirmed' | 'cancelled' | 'executed'

export interface DeletionRequestPublic {
  id: string
  status: DeletionStatus
  requestedAt: string
  confirmedAt: string | null
  executesAfter: string
  cancelledAt: string | null
  executedAt: string | null
}

interface RawRow {
  id: string
  user_id: string
  status: DeletionStatus
  requested_at: string | Date
  confirmed_at: string | Date | null
  executes_after: string | Date
  cancelled_at: string | Date | null
  executed_at: string | Date | null
}

function iso(v: string | Date | null): string | null {
  if (v === null) return null
  return typeof v === 'string' ? v : v.toISOString()
}

function toPublic(r: RawRow): DeletionRequestPublic {
  return {
    id: r.id,
    status: r.status,
    requestedAt: iso(r.requested_at) as string,
    confirmedAt: iso(r.confirmed_at),
    executesAfter: iso(r.executes_after) as string,
    cancelledAt: iso(r.cancelled_at),
    executedAt: iso(r.executed_at),
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export class DeletionError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export async function getActiveRequest(userId: string): Promise<DeletionRequestPublic | null> {
  const sql = sqlUser()
  const [rows] = await withRls<[RawRow[]]>(userId, [
    sql`SELECT id, user_id, status, requested_at, confirmed_at, executes_after, cancelled_at, executed_at
        FROM account_deletion_requests
        WHERE user_id = ${userId} AND status IN ('pending', 'confirmed')
        ORDER BY requested_at DESC
        LIMIT 1`,
  ])
  return rows[0] ? toPublic(rows[0]) : null
}

// Starts a new deletion request. Returns the plaintext token so the caller
// can email it to the user; the hash is persisted.
export async function requestDeletion(
  userId: string,
): Promise<{ request: DeletionRequestPublic; token: string }> {
  const existing = await getActiveRequest(userId)
  if (existing) {
    throw new DeletionError('already_pending', 'an active deletion request already exists')
  }
  const token = randomBytes(32).toString('base64url')
  const tokenHash = hashToken(token)
  const executesAfter = new Date(Date.now() + COOL_OFF_MS)
  const sql = sqlUser()
  const [rows] = await withRls<[RawRow[]]>(userId, [
    sql`INSERT INTO account_deletion_requests (user_id, confirm_token_hash, executes_after)
        VALUES (${userId}, ${tokenHash}, ${executesAfter.toISOString()}::timestamptz)
        RETURNING id, user_id, status, requested_at, confirmed_at, executes_after, cancelled_at, executed_at`,
  ])
  return { request: toPublic(rows[0]!), token }
}

// Confirm by token (public endpoint — no auth; token is the proof). On
// confirm, the 24-hr clock starts: executes_after = now() + 24h.
export async function confirmDeletion(
  token: string,
): Promise<{ userId: string; request: DeletionRequestPublic }> {
  const sql = sqlAdmin()
  const tokenHash = hashToken(token)
  const newExecutes = new Date(Date.now() + COOL_OFF_MS).toISOString()
  const rows = (await sql`UPDATE account_deletion_requests
        SET status = 'confirmed',
            confirmed_at = now(),
            executes_after = ${newExecutes}::timestamptz
        WHERE confirm_token_hash = ${tokenHash} AND status = 'pending'
        RETURNING id, user_id, status, requested_at, confirmed_at, executes_after, cancelled_at, executed_at`) as RawRow[]
  const row = rows[0]
  if (!row) throw new DeletionError('invalid_token', 'token not found or already used')
  return { userId: row.user_id, request: toPublic(row) }
}

export async function cancelDeletion(userId: string): Promise<DeletionRequestPublic | null> {
  const sql = sqlUser()
  const [rows] = await withRls<[RawRow[]]>(userId, [
    sql`UPDATE account_deletion_requests
        SET status = 'cancelled', cancelled_at = now()
        WHERE user_id = ${userId} AND status IN ('pending', 'confirmed')
        RETURNING id, user_id, status, requested_at, confirmed_at, executes_after, cancelled_at, executed_at`,
  ])
  return rows[0] ? toPublic(rows[0]) : null
}

// Cron-called: returns confirmed requests whose window has elapsed.
export async function listDueForExecution(): Promise<
  Array<{ id: string; userId: string }>
> {
  const sql = sqlAdmin()
  const rows = (await sql`SELECT id, user_id
      FROM account_deletion_requests
      WHERE status = 'confirmed' AND executes_after <= now()
      LIMIT 500`) as Array<{ id: string; user_id: string }>
  return rows.map((r) => ({ id: r.id, userId: r.user_id }))
}

// Execute: delete the users row (FKs cascade to every user-scoped table).
// Marks the request `executed` first so a crash mid-delete doesn't re-run.
export async function executeDeletion(requestId: string, userId: string): Promise<void> {
  const sql = sqlAdmin()
  await sql`UPDATE account_deletion_requests
            SET status = 'executed', executed_at = now()
            WHERE id = ${requestId} AND status = 'confirmed'`
  await sql`DELETE FROM users WHERE id = ${userId}`
}
