// applyPush — unit-ish integration tests against real Neon (like rls.test.ts).
// Gated on DATABASE_URL_ADMIN.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'

const hasDb = !!process.env.DATABASE_URL && !!process.env.DATABASE_URL_ADMIN
const d = hasDb ? describe : describe.skip

d('applyPush', () => {
  const adminSql = hasDb ? neon(process.env.DATABASE_URL_ADMIN!) : (null as never)
  const userA = `user_push_A_${randomUUID().slice(0, 8)}`
  const deviceA = `dev_${randomUUID().slice(0, 8)}`

  beforeAll(async () => {
    await adminSql`INSERT INTO users (id, email) VALUES (${userA}, ${userA + '@test.local'})`
  })

  afterAll(async () => {
    await adminSql`DELETE FROM users WHERE id = ${userA}`
  })

  it('accepts a section+canvas+card chain and materializes rows', async () => {
    const { applyPush } = await import('@/lib/sync/apply-push')

    const sectionId = randomUUID()
    const canvasId = randomUUID()
    const cardId = randomUUID()

    const res = await applyPush(userA, {
      deviceId: deviceA,
      baseVersion: '0',
      mutations: [
        {
          id: 'm1',
          entityType: 'section',
          entityId: sectionId,
          op: 'upsert',
          patch: { name: 'S1', color: null, position: 0, permanent: false },
          clientVersion: '1',
        },
        {
          id: 'm2',
          entityType: 'canvas',
          entityId: canvasId,
          op: 'upsert',
          patch: {
            sectionId,
            name: 'C1',
            color: null,
            viewport: { panX: 0, panY: 0, zoom: 1 },
            position: 0,
          },
          clientVersion: '2',
        },
        {
          id: 'm3',
          entityType: 'card',
          entityId: cardId,
          op: 'upsert',
          patch: {
            canvasId,
            x: 10,
            y: 20,
            width: 300,
            height: 200,
            zIndex: 1,
            payload: { prompt: 'hi', modelSlot: '0', status: 'complete', response: '', model: '' },
          },
          clientVersion: '3',
        },
      ],
    })

    expect(res.accepted.sort()).toEqual(['m1', 'm2', 'm3'])
    expect(res.rejected).toEqual([])
    expect(BigInt(res.serverVersion)).toBeGreaterThan(0n)

    const [rows] = await adminSql.transaction([
      adminSql`SELECT count(*)::int AS n FROM cards WHERE user_id = ${userA} AND id = ${cardId}`,
    ])
    expect(rows[0].n).toBe(1)
  })

  it('is idempotent on duplicate client_mutation_id', async () => {
    const { applyPush } = await import('@/lib/sync/apply-push')
    const sectionId = randomUUID()

    const push = {
      deviceId: deviceA,
      baseVersion: '0',
      mutations: [
        {
          id: 'dup-1',
          entityType: 'section' as const,
          entityId: sectionId,
          op: 'upsert' as const,
          patch: { name: 'Dup', position: 0, permanent: false },
          clientVersion: '10',
        },
      ],
    }

    const first = await applyPush(userA, push)
    const second = await applyPush(userA, push)

    expect(first.accepted).toEqual(['dup-1'])
    expect(second.accepted).toEqual(['dup-1']) // client still ack'd
    const [rows] = await adminSql.transaction([
      adminSql`SELECT count(*)::int AS n FROM mutations
               WHERE user_id = ${userA} AND client_mutation_id = 'dup-1'`,
    ])
    expect(rows[0].n).toBe(1)
  })

  // Row version is the server-assigned HLC (nextHlc()), not the client version.
  // True LWW guards against concurrent writes from a separate server instance
  // that already advanced the row's version. Simulate that by admin-bumping
  // canvases.version to the bigint ceiling before the second push.
  it('rejects upserts whose serverVersion is below the current row version (LWW)', async () => {
    const { applyPush } = await import('@/lib/sync/apply-push')
    const canvasId = randomUUID()
    const sectionId = randomUUID()

    await applyPush(userA, {
      deviceId: deviceA,
      baseVersion: '0',
      mutations: [
        { id: 'lww-s', entityType: 'section', entityId: sectionId, op: 'upsert',
          patch: { name: 'S', position: 0 }, clientVersion: '1' },
      ],
    })

    await applyPush(userA, {
      deviceId: deviceA,
      baseVersion: '0',
      mutations: [
        { id: 'lww-c-new', entityType: 'canvas', entityId: canvasId, op: 'upsert',
          patch: { sectionId, name: 'NEW', viewport: { panX: 0, panY: 0, zoom: 1 }, position: 0 },
          clientVersion: '1' },
      ],
    })

    await adminSql`UPDATE canvases SET version = 9223372036854775807 WHERE id = ${canvasId}`

    await applyPush(userA, {
      deviceId: deviceA,
      baseVersion: '0',
      mutations: [
        { id: 'lww-c-stale', entityType: 'canvas', entityId: canvasId, op: 'upsert',
          patch: { sectionId, name: 'STALE', viewport: { panX: 0, panY: 0, zoom: 1 }, position: 0 },
          clientVersion: '2' },
      ],
    })

    const [rows] = await adminSql.transaction([
      adminSql`SELECT name FROM canvases WHERE id = ${canvasId}`,
    ])
    expect(rows[0].name).toBe('NEW')
  })

  it('rejects patches larger than 64KB with reason=invalid', async () => {
    const { applyPush } = await import('@/lib/sync/apply-push')
    const big = 'a'.repeat(70_000)
    const res = await applyPush(userA, {
      deviceId: deviceA,
      baseVersion: '0',
      mutations: [
        {
          id: 'too-big',
          entityType: 'card',
          entityId: randomUUID(),
          op: 'upsert',
          patch: { payload: { prompt: big } },
          clientVersion: '1',
        },
      ],
    })
    expect(res.rejected[0]?.id).toBe('too-big')
    expect(res.rejected[0]?.reason).toBe('invalid')
  })
})
