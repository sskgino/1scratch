import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'

vi.mock('@clerk/nextjs/server', () => ({
  auth: async () => ({ userId: null }),
}))

const { POST } = await import('@/app/api/ai/route')

const hasDb = !!process.env.DATABASE_URL && !!process.env.DATABASE_URL_ADMIN
const hasGateway = !!process.env.AI_GATEWAY_API_KEY || !!process.env.VERCEL_OIDC_TOKEN
const d = hasDb && hasGateway ? describe : describe.skip

d('POST /api/ai (transcribe)', () => {
  const admin = hasDb
    ? neon(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL!)
    : (null as never)
  const userId = `user_test_transcribe_${randomUUID().slice(0, 8)}`

  beforeAll(async () => {
    await admin`INSERT INTO users (id, email, daily_ai_cap_cents) VALUES (${userId}, ${userId + '@test.local'}, 100)`
  })
  afterAll(async () => {
    await admin`DELETE FROM ai_usage WHERE user_id = ${userId}`
    await admin`DELETE FROM users WHERE id = ${userId}`
  })

  it('rejects non-multipart with 415', async () => {
    const req = new Request('http://x/api/ai', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    })
    const res = await POST(req)
    expect(res.status).toBe(415)
  })

  it('rejects missing audio with 400', async () => {
    if (!process.env.TEST_MOBILE_BEARER) return
    const fd = new FormData()
    fd.append('transcribe', 'true')
    const req = new Request('http://x/api/ai', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.TEST_MOBILE_BEARER}` },
      body: fd,
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 401 without auth', async () => {
    const fd = new FormData()
    fd.append('transcribe', 'true')
    fd.append('audio', new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: 'audio/webm' }))
    const req = new Request('http://x/api/ai', { method: 'POST', body: fd })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })
})
