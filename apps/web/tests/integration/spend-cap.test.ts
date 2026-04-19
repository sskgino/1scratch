import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'
import { checkCap, recordUsage, estimateCostMicros } from '@/lib/spend-cap'

const hasDb = !!process.env.DATABASE_URL && !!process.env.DATABASE_URL_ADMIN
const d = hasDb ? describe : describe.skip

d('spend cap', () => {
  const admin = hasDb
    ? neon(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL!)
    : (null as never)
  const userId = `user_test_cap_${randomUUID().slice(0, 8)}`

  beforeAll(async () => {
    // $0.10 cap so a single recordUsage can trip it.
    await admin`INSERT INTO users (id, email, daily_ai_cap_cents) VALUES (${userId}, ${userId + '@test.local'}, 10)`
  })
  afterAll(async () => {
    await admin`DELETE FROM users WHERE id = ${userId}`
  })

  it('allows before any usage', async () => {
    const c = await checkCap(userId)
    expect(c.allowed).toBe(true)
    expect(c.capCents).toBe(10)
  })

  it('blocks after usage exceeds cap', async () => {
    // 100K output tokens ≈ $1.50 at default pricing → well over $0.10 cap.
    await recordUsage({
      userId,
      provider: 'anthropic',
      model: 'claude-haiku-4.5',
      inputTokens: 1000,
      outputTokens: 100_000,
    })
    const c = await checkCap(userId)
    expect(c.allowed).toBe(false)
    expect(c.usedCents).toBeGreaterThanOrEqual(10)
  })

  it('estimateCostMicros math', () => {
    expect(estimateCostMicros(1_000_000, 0)).toBe(30_000_000n)
    expect(estimateCostMicros(0, 1_000_000)).toBe(150_000_000n)
  })
})
