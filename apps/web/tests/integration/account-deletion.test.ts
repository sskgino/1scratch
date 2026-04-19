// Integration — deletion cool-off: request → confirm → cancel paths, plus
// execute-deletion cascades user data (cards, canvases, etc.).

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'

const hasDb = !!process.env.DATABASE_URL && !!process.env.DATABASE_URL_ADMIN
const d = hasDb ? describe : describe.skip

d('account deletion cool-off', () => {
  const adminSql = hasDb
    ? neon(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL!)
    : (null as never)

  const users: string[] = []

  beforeAll(async () => {
    // empty — users added per-case below
  })

  afterAll(async () => {
    if (users.length > 0) {
      await adminSql`DELETE FROM users WHERE id = ANY(${users}::text[])`
    }
  })

  async function seedUser(): Promise<string> {
    const id = `user_del_${randomUUID().slice(0, 8)}`
    users.push(id)
    await adminSql`INSERT INTO users (id, email) VALUES (${id}, ${id + '@test.local'})`
    return id
  }

  it('request → confirm → cancel flips statuses correctly', async () => {
    const { requestDeletion, confirmDeletion, cancelDeletion, getActiveRequest } = await import(
      '@/lib/account-deletion'
    )
    const userId = await seedUser()
    const { token, request } = await requestDeletion(userId)
    expect(request.status).toBe('pending')

    const confirmed = await confirmDeletion(token)
    expect(confirmed.userId).toBe(userId)
    expect(confirmed.request.status).toBe('confirmed')
    expect(confirmed.request.confirmedAt).not.toBeNull()

    const active = await getActiveRequest(userId)
    expect(active?.status).toBe('confirmed')

    const cancelled = await cancelDeletion(userId)
    expect(cancelled?.status).toBe('cancelled')

    const afterCancel = await getActiveRequest(userId)
    expect(afterCancel).toBeNull()
  })

  it('rejects a second request while one is active', async () => {
    const { requestDeletion } = await import('@/lib/account-deletion')
    const userId = await seedUser()
    await requestDeletion(userId)
    await expect(requestDeletion(userId)).rejects.toThrow(/already exists/)
  })

  it('invalid token fails to confirm', async () => {
    const { confirmDeletion } = await import('@/lib/account-deletion')
    await expect(confirmDeletion('not-a-real-token')).rejects.toThrow(/token not found/)
  })

  it('execute cascades owned rows via FK', async () => {
    const { requestDeletion, confirmDeletion, executeDeletion } = await import(
      '@/lib/account-deletion'
    )
    const userId = await seedUser()
    const workspaceId = randomUUID()
    const sectionId = randomUUID()
    const canvasId = randomUUID()
    const cardId = randomUUID()
    await adminSql`INSERT INTO workspaces (id, user_id, name) VALUES (${workspaceId}, ${userId}, 'w')`
    await adminSql`INSERT INTO sections (id, user_id, workspace_id, name, position) VALUES (${sectionId}, ${userId}, ${workspaceId}, 's', 0)`
    await adminSql`INSERT INTO canvases (id, user_id, workspace_id, section_id, name, viewport, position, version) VALUES (${canvasId}, ${userId}, ${workspaceId}, ${sectionId}, 'c', '{}'::jsonb, 0, 1)`
    await adminSql`INSERT INTO cards (id, user_id, workspace_id, canvas_id, x, y, width, height, payload, version) VALUES (${cardId}, ${userId}, ${workspaceId}, ${canvasId}, 0, 0, 100, 100, '{}'::jsonb, 1)`

    const { token } = await requestDeletion(userId)
    const { request } = await confirmDeletion(token)
    await executeDeletion(request.id, userId)

    // FK cascade: every owned row is gone.
    const remaining = (await adminSql`
      SELECT
        (SELECT COUNT(*)::int FROM users WHERE id = ${userId}) AS u,
        (SELECT COUNT(*)::int FROM workspaces WHERE id = ${workspaceId}) AS w,
        (SELECT COUNT(*)::int FROM sections WHERE id = ${sectionId}) AS s,
        (SELECT COUNT(*)::int FROM canvases WHERE id = ${canvasId}) AS c,
        (SELECT COUNT(*)::int FROM cards WHERE id = ${cardId}) AS ca
    `) as Array<{ u: number; w: number; s: number; c: number; ca: number }>
    const r = remaining[0]!
    expect(r).toMatchObject({ u: 0, w: 0, s: 0, c: 0, ca: 0 })
    // User fully removed — pop from tracker so afterAll doesn't try again.
    users.pop()
  })
})
