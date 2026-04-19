import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'

const hasDb = !!process.env.DATABASE_URL && !!process.env.DATABASE_URL_ADMIN
const d = hasDb ? describe : describe.skip

d('sync push/pull end-to-end', () => {
  const adminSql = hasDb ? neon(process.env.DATABASE_URL_ADMIN!) : (null as never)
  const user = `user_sync_${randomUUID().slice(0, 8)}`
  const devA = `A_${randomUUID().slice(0, 8)}`
  const devB = `B_${randomUUID().slice(0, 8)}`

  beforeAll(async () => {
    await adminSql`INSERT INTO users (id, email) VALUES (${user}, ${user + '@test.local'})`
  })
  afterAll(async () => {
    await adminSql`DELETE FROM users WHERE id = ${user}`
  })

  it('device A pushes, device B pulls and sees the mutations', async () => {
    const { applyPush } = await import('@/lib/sync/apply-push')
    const { fetchSince } = await import('@/lib/sync/fetch-since')

    const sectionId = randomUUID()
    await applyPush(user, {
      deviceId: devA,
      baseVersion: '0',
      mutations: [
        { id: 'e2e-1', entityType: 'section', entityId: sectionId, op: 'upsert',
          patch: { name: 'X', position: 0 }, clientVersion: '1' },
      ],
    })

    const pull = await fetchSince(user, '0', 500)
    expect(pull.mutations.map((m) => m.id)).toContain('e2e-1')
    expect(pull.mutations.every((m) => m.deviceId === devA)).toBe(true)
  })

  it('device A pull includes additional[] from device B via push response', async () => {
    const { applyPush } = await import('@/lib/sync/apply-push')

    // device B writes first
    const sectionB = randomUUID()
    const pushB = await applyPush(user, {
      deviceId: devB,
      baseVersion: '0',
      mutations: [
        { id: 'e2e-b', entityType: 'section', entityId: sectionB, op: 'upsert',
          patch: { name: 'B-wrote', position: 1 }, clientVersion: '5' },
      ],
    })

    // device A pushes from a stale baseVersion — server returns B's mutation as additional
    const sectionA = randomUUID()
    const pushA = await applyPush(user, {
      deviceId: devA,
      baseVersion: '0',
      mutations: [
        { id: 'e2e-a', entityType: 'section', entityId: sectionA, op: 'upsert',
          patch: { name: 'A-wrote', position: 2 }, clientVersion: '6' },
      ],
    })

    expect(pushA.additional.map((m) => m.id)).toContain('e2e-b')
    expect(pushA.additional.every((m) => m.deviceId === devB)).toBe(true)
  })
})
