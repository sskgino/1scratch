// Integration — .scratch import lands rows scoped to the caller's user_id;
// cross-tenant isolation holds via RLS.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'

const hasDb = !!process.env.DATABASE_URL && !!process.env.DATABASE_URL_ADMIN
const d = hasDb ? describe : describe.skip

d('scratch file import', () => {
  const adminSql = hasDb
    ? neon(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL!)
    : (null as never)

  const userA = `user_import_A_${randomUUID().slice(0, 8)}`
  const userB = `user_import_B_${randomUUID().slice(0, 8)}`

  beforeAll(async () => {
    await adminSql`INSERT INTO users (id, email) VALUES (${userA}, ${userA + '@test.local'}), (${userB}, ${userB + '@test.local'})`
  })

  afterAll(async () => {
    await adminSql`DELETE FROM users WHERE id IN (${userA}, ${userB})`
  })

  it('imports a legacy file and scopes all rows to the caller', async () => {
    const { importScratchFile } = await import('@/lib/import-scratch')
    const file = {
      version: 1 as const,
      id: 'local-abc',
      name: 'Legacy canvas',
      viewport: { panX: 0, panY: 0, zoom: 1 },
      cards: {
        c1: {
          id: 'c1',
          x: 10,
          y: 20,
          width: 300,
          height: 200,
          zIndex: 1,
          type: 'card' as const,
          prompt: 'hello',
          modelSlot: '0',
          status: 'complete' as const,
          response: 'hi',
          model: 'claude-haiku-4.5',
          inputTokens: 3,
          outputTokens: 2,
        },
        c2: {
          id: 'c2',
          x: 200,
          y: 120,
          width: 250,
          height: 150,
          zIndex: 2,
          type: 'card' as const,
          prompt: 'second',
          modelSlot: '0',
          status: 'idle' as const,
          response: '',
          model: '',
        },
      },
    }
    const res = await importScratchFile(userA, file)
    expect(res.cardCount).toBe(2)
    expect(res.canvasId).toMatch(/^[0-9a-f-]{36}$/)

    const canvases = (await adminSql`SELECT id, user_id, name FROM canvases WHERE id = ${res.canvasId}`) as Array<{
      id: string
      user_id: string
      name: string
    }>
    expect(canvases).toHaveLength(1)
    expect(canvases[0]!.user_id).toBe(userA)
    expect(canvases[0]!.name).toBe('Legacy canvas')

    const cards = (await adminSql`SELECT id, user_id, payload FROM cards WHERE canvas_id = ${res.canvasId} ORDER BY z_index`) as Array<{
      id: string
      user_id: string
      payload: { prompt: string; response: string }
    }>
    expect(cards).toHaveLength(2)
    expect(cards.every((c) => c.user_id === userA)).toBe(true)
    expect(cards[0]!.payload.prompt).toBe('hello')
    expect(cards[0]!.payload.response).toBe('hi')
  })

  it('second import reuses the default workspace + Imported section', async () => {
    const { importScratchFile } = await import('@/lib/import-scratch')
    const base = {
      version: 1 as const,
      id: 'local-xyz',
      name: 'Second',
      viewport: { panX: 0, panY: 0, zoom: 1 },
      cards: {},
    }
    const r1 = await importScratchFile(userB, base)
    const r2 = await importScratchFile(userB, { ...base, id: 'local-xyz2', name: 'Third' })
    expect(r1.workspaceId).toBe(r2.workspaceId)
    expect(r1.sectionId).toBe(r2.sectionId)
    expect(r1.canvasId).not.toBe(r2.canvasId)

    const workspaces = (await adminSql`SELECT COUNT(*)::int AS n FROM workspaces WHERE user_id = ${userB}`) as Array<{ n: number }>
    expect(workspaces[0]!.n).toBe(1)
  })
})
