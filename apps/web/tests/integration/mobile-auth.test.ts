import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'

const hasDb = !!process.env.DATABASE_URL_ADMIN
const d = hasDb ? describe : describe.skip

d('mobile auth routes', () => {
  const adminSql = hasDb ? neon(process.env.DATABASE_URL_ADMIN!) : (null as never)
  const users: string[] = []

  beforeAll(() => {
    process.env.MOBILE_JWT_SIGNING_KEY ??= Buffer.alloc(32, 9).toString('base64')
    process.env.MOBILE_JWT_ISS = 'https://app.1scratch.ai'
  })

  afterAll(async () => {
    if (users.length > 0) await adminSql`DELETE FROM users WHERE id = ANY(${users}::text[])`
  })

  async function seedUser(): Promise<string> {
    const id = `user_mauth_${randomUUID().slice(0, 8)}`
    users.push(id)
    await adminSql`INSERT INTO users (id, email) VALUES (${id}, ${id + '@test.local'})`
    return id
  }

  it('exchange issues access + refresh, audit row written', async () => {
    const userId = await seedUser()
    vi.doMock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId }) }))
    vi.resetModules()
    const { POST } = await import('@/app/api/mobile/exchange/route')
    const req = new Request('https://x/api/mobile/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_id: 'dev-ex-1', device_label: 'Pixel 8' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      access_jwt: string
      refresh_token: string
      user: { id: string }
    }
    expect(body.access_jwt.split('.').length).toBe(3)
    expect(body.refresh_token.length).toBeGreaterThan(40)
    expect(body.user.id).toBe(userId)
    const audits = (await adminSql`
      SELECT kind FROM auth_events WHERE user_id = ${userId} AND kind = 'mobile_session_created'`) as {
      kind: string
    }[]
    expect(audits.length).toBe(1)
    vi.doUnmock('@clerk/nextjs/server')
    vi.resetModules()
  })

  it('exchange returns 401 with no Clerk session', async () => {
    vi.doMock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }) }))
    vi.resetModules()
    const { POST } = await import('@/app/api/mobile/exchange/route')
    const res = await POST(new Request('https://x', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(401)
    vi.doUnmock('@clerk/nextjs/server')
    vi.resetModules()
  })
})
