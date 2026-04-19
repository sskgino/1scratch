import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'

const hasDb = !!process.env.DATABASE_URL && !!process.env.DATABASE_URL_ADMIN
const d = hasDb ? describe : describe.skip

d('fetchSince', () => {
  const adminSql = hasDb ? neon(process.env.DATABASE_URL_ADMIN!) : (null as never)
  const userA = `user_pull_A_${randomUUID().slice(0, 8)}`
  const deviceA = `dev_${randomUUID().slice(0, 8)}`

  beforeAll(async () => {
    await adminSql`INSERT INTO users (id, email) VALUES (${userA}, ${userA + '@test.local'})`
  })
  afterAll(async () => {
    await adminSql`DELETE FROM users WHERE id = ${userA}`
  })

  it('returns mutations since a version in order, sets more=false when under limit', async () => {
    const { applyPush } = await import('@/lib/sync/apply-push')
    const { fetchSince } = await import('@/lib/sync/fetch-since')

    const sectionId = randomUUID()
    await applyPush(userA, {
      deviceId: deviceA,
      baseVersion: '0',
      mutations: [
        { id: 'p-1', entityType: 'section', entityId: sectionId, op: 'upsert',
          patch: { name: 'A', position: 0 }, clientVersion: '1' },
      ],
    })

    const res = await fetchSince(userA, '0', 500)
    expect(res.mutations.length).toBeGreaterThan(0)
    expect(res.more).toBe(false)
    expect(BigInt(res.serverVersion)).toBeGreaterThan(0n)
  })

  it('respects limit and sets more=true when more rows exist', async () => {
    const { applyPush } = await import('@/lib/sync/apply-push')
    const { fetchSince } = await import('@/lib/sync/fetch-since')

    const muts = Array.from({ length: 5 }, (_, i) => ({
      id: `lim-${i}`,
      entityType: 'section' as const,
      entityId: randomUUID(),
      op: 'upsert' as const,
      patch: { name: `L${i}`, position: i },
      clientVersion: String(100 + i),
    }))
    await applyPush(userA, { deviceId: deviceA, baseVersion: '0', mutations: muts })

    const res = await fetchSince(userA, '0', 2)
    expect(res.mutations).toHaveLength(2)
    expect(res.more).toBe(true)
  })
})
