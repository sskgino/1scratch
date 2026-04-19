// Integration test — two users, RLS prevents cross-tenant reads on cards.
// Requires a live Neon branch + DATABASE_URL (admin). Gated on env so CI
// without DB stays green.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'

// Seeding requires BYPASSRLS (admin role). Without it RLS blocks INSERT.
const hasDb = !!process.env.DATABASE_URL && !!process.env.DATABASE_URL_ADMIN
const d = hasDb ? describe : describe.skip

d('RLS isolation between users', () => {
  // Lazy so describe.skip branches don't crash when DATABASE_URL is absent.
  const sql = hasDb ? neon(process.env.DATABASE_URL!) : (null as never)
  const adminSql = hasDb
    ? neon(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL!)
    : (null as never)

  const userA = `user_test_A_${randomUUID().slice(0, 8)}`
  const userB = `user_test_B_${randomUUID().slice(0, 8)}`
  const workspaceA = randomUUID()
  const workspaceB = randomUUID()
  const sectionA = randomUUID()
  const sectionB = randomUUID()
  const canvasA = randomUUID()
  const canvasB = randomUUID()
  const cardA = randomUUID()
  const cardB = randomUUID()

  beforeAll(async () => {
    // Seed via admin (bypasses RLS).
    await adminSql`INSERT INTO users (id, email) VALUES (${userA}, ${userA + '@test.local'}), (${userB}, ${userB + '@test.local'})`
    await adminSql`INSERT INTO workspaces (id, user_id, name) VALUES (${workspaceA}, ${userA}, 'A'), (${workspaceB}, ${userB}, 'B')`
    await adminSql`INSERT INTO sections (id, user_id, workspace_id, name, position) VALUES (${sectionA}, ${userA}, ${workspaceA}, 'a', 0), (${sectionB}, ${userB}, ${workspaceB}, 'b', 0)`
    await adminSql`INSERT INTO canvases (id, user_id, workspace_id, section_id, name, viewport, position, version) VALUES (${canvasA}, ${userA}, ${workspaceA}, ${sectionA}, 'ca', '{}'::jsonb, 0, 1), (${canvasB}, ${userB}, ${workspaceB}, ${sectionB}, 'cb', '{}'::jsonb, 0, 1)`
    await adminSql`INSERT INTO cards (id, user_id, workspace_id, canvas_id, x, y, width, height, payload, version) VALUES (${cardA}, ${userA}, ${workspaceA}, ${canvasA}, 0, 0, 100, 100, '{}'::jsonb, 1), (${cardB}, ${userB}, ${workspaceB}, ${canvasB}, 0, 0, 100, 100, '{}'::jsonb, 1)`
  })

  afterAll(async () => {
    await adminSql`DELETE FROM users WHERE id IN (${userA}, ${userB})`
  })

  it('user A sees only their own card', async () => {
    const [, rows] = (await sql.transaction([
      sql`SELECT set_config('app.user_id', ${userA}, true)`,
      sql`SELECT id FROM cards`,
    ])) as unknown as [unknown, Array<{ id: string }>]
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(cardA)
    expect(ids).not.toContain(cardB)
  })

  it('user B sees only their own card', async () => {
    const [, rows] = (await sql.transaction([
      sql`SELECT set_config('app.user_id', ${userB}, true)`,
      sql`SELECT id FROM cards`,
    ])) as unknown as [unknown, Array<{ id: string }>]
    const ids = rows.map((r) => r.id)
    expect(ids).toContain(cardB)
    expect(ids).not.toContain(cardA)
  })

  it('user A cannot insert a card owned by B', async () => {
    await expect(
      sql.transaction([
        sql`SELECT set_config('app.user_id', ${userA}, true)`,
        sql`INSERT INTO cards (id, user_id, workspace_id, canvas_id, x, y, width, height, payload, version)
            VALUES (${randomUUID()}, ${userB}, ${workspaceB}, ${canvasB}, 0, 0, 100, 100, '{}'::jsonb, 2)`,
      ]),
    ).rejects.toThrow()
  })

  it('no GUC set → zero rows returned (fail-closed)', async () => {
    const rows = (await sql`SELECT id FROM cards`) as Array<{ id: string }>
    expect(rows.length).toBe(0)
  })
})
