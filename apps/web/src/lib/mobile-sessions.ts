import { createHash, randomBytes } from 'node:crypto'
import { sqlAdmin } from '@/db/rls'
import { signAccessToken } from '@/lib/mobile-jwt'

const REFRESH_BYTES = 48

function hashRefresh(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

function newRefresh(): string {
  return randomBytes(REFRESH_BYTES).toString('base64url')
}

export interface SessionPair {
  sessionId: string
  userId: string
  accessToken: string
  accessExp: number
  refreshToken: string
}

export async function createSession(opts: {
  userId: string
  deviceId: string
  deviceLabel?: string | null
}): Promise<SessionPair> {
  const sql = sqlAdmin()
  const refresh = newRefresh()
  const refreshHash = hashRefresh(refresh)
  // ON CONFLICT (user_id, device_id) DO UPDATE — rotate-in-place if a row already exists.
  const rows = (await sql`
    INSERT INTO device_sessions (user_id, device_id, device_label, refresh_hash)
    VALUES (${opts.userId}, ${opts.deviceId}, ${opts.deviceLabel ?? null}, ${refreshHash})
    ON CONFLICT (user_id, device_id) DO UPDATE
      SET refresh_hash = EXCLUDED.refresh_hash,
          device_label = COALESCE(EXCLUDED.device_label, device_sessions.device_label),
          last_used_at = now(),
          revoked_at = NULL
    RETURNING id`) as { id: string }[]
  const sessionId = rows[0]!.id
  const expiresInSeconds = 15 * 60
  const accessToken = await signAccessToken({ userId: opts.userId, sessionId, expiresInSeconds })
  return {
    sessionId,
    userId: opts.userId,
    accessToken,
    accessExp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    refreshToken: refresh,
  }
}

export async function rotateSession(presentedRefresh: string): Promise<SessionPair | null> {
  const sql = sqlAdmin()
  const refreshHash = hashRefresh(presentedRefresh)
  // Atomic: revoke the existing row by hash, fetch its (user, device), insert a new active row.
  const rows = (await sql`
    UPDATE device_sessions
       SET revoked_at = now()
     WHERE refresh_hash = ${refreshHash} AND revoked_at IS NULL
   RETURNING user_id, device_id, device_label`) as {
    user_id: string
    device_id: string
    device_label: string | null
  }[]
  if (rows.length === 0) return null
  const { user_id: userId, device_id: deviceId, device_label: deviceLabel } = rows[0]!
  return await createSession({ userId, deviceId, deviceLabel })
}

export async function revokeSession(presentedRefresh: string): Promise<void> {
  const sql = sqlAdmin()
  await sql`
    UPDATE device_sessions
       SET revoked_at = now()
     WHERE refresh_hash = ${hashRefresh(presentedRefresh)} AND revoked_at IS NULL`
}

export async function findSessionByRefresh(presentedRefresh: string): Promise<{
  sessionId: string
  userId: string
} | null> {
  const sql = sqlAdmin()
  const rows = (await sql`
    SELECT id, user_id FROM device_sessions
     WHERE refresh_hash = ${hashRefresh(presentedRefresh)} AND revoked_at IS NULL
     LIMIT 1`) as { id: string; user_id: string }[]
  if (rows.length === 0) return null
  return { sessionId: rows[0]!.id, userId: rows[0]!.user_id }
}
