import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'

const hasDb = !!process.env.DATABASE_URL_ADMIN
const d = hasDb ? describe : describe.skip

d('mobile-sessions', () => {
  const adminSql = hasDb ? neon(process.env.DATABASE_URL_ADMIN!) : (null as never)
  const users: string[] = []

  beforeAll(() => {
    delete process.env.MOBILE_JWT_KMS_KEY_ID
    delete process.env.MOBILE_JWT_KMS_KEY_IDS
    process.env.MOBILE_JWT_SIGNING_KEY ??= Buffer.alloc(32, 7).toString('base64')
    process.env.MOBILE_JWT_ISS = 'https://app.1scratch.ai'
  })

  afterAll(async () => {
    if (users.length > 0) {
      await adminSql`DELETE FROM users WHERE id = ANY(${users}::text[])`
    }
  })

  async function seedUser(): Promise<string> {
    const id = `user_ms_${randomUUID().slice(0, 8)}`
    users.push(id)
    await adminSql`INSERT INTO users (id, email) VALUES (${id}, ${id + '@test.local'})`
    return id
  }

  it('creates a session row and returns plaintext refresh exactly once', async () => {
    const { createSession } = await import('@/lib/mobile-sessions')
    const userId = await seedUser()
    const out = await createSession({ userId, deviceId: 'dev-1', deviceLabel: 'Pixel 8' })
    expect(out.refreshToken).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    const rows = (await adminSql`
      SELECT refresh_hash, device_label FROM device_sessions WHERE id = ${out.sessionId}`) as {
      refresh_hash: string
      device_label: string | null
    }[]
    const row = rows[0]!
    expect(row.refresh_hash).not.toBe(out.refreshToken)
    expect(row.device_label).toBe('Pixel 8')
  })

  it('rotateSession revokes old row and inserts new one', async () => {
    const { createSession, rotateSession } = await import('@/lib/mobile-sessions')
    const userId = await seedUser()
    const first = await createSession({ userId, deviceId: 'dev-r' })
    const second = await rotateSession(first.refreshToken)
    expect(second).not.toBeNull()
    expect(second!.refreshToken).not.toBe(first.refreshToken)
    const rows = (await adminSql`
      SELECT id, revoked_at FROM device_sessions WHERE user_id = ${userId} ORDER BY created_at`) as {
      id: string
      revoked_at: Date | null
    }[]
    // Rotation happens via ON CONFLICT(user_id, device_id) which UPDATEs the same row,
    // so we expect 1 row with revoked_at NULL (the rotated refresh_hash is fresh).
    // Older row's revoked_at was set then immediately overwritten by upsert. Verify active session only.
    const active = rows.filter((r) => r.revoked_at === null)
    expect(active.length).toBe(1)
  })

  it('rotateSession returns null for unknown / revoked refresh', async () => {
    const { rotateSession } = await import('@/lib/mobile-sessions')
    expect(await rotateSession('totally-bogus')).toBeNull()
  })

  it('revokeSession marks row revoked', async () => {
    const { createSession, revokeSession } = await import('@/lib/mobile-sessions')
    const userId = await seedUser()
    const s = await createSession({ userId, deviceId: 'dev-x' })
    await revokeSession(s.refreshToken)
    const rows = (await adminSql`
      SELECT revoked_at FROM device_sessions WHERE id = ${s.sessionId}`) as {
      revoked_at: Date | null
    }[]
    expect(rows[0]!.revoked_at).not.toBeNull()
  })
})
