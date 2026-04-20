import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

beforeAll(() => {
  process.env.MOBILE_JWT_SIGNING_KEY ??= Buffer.alloc(32, 3).toString('base64')
  process.env.MOBILE_JWT_ISS = 'https://app.1scratch.ai'
})

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: null })),
}))

describe('resolveAuthedUserId', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns userId from a valid mobile bearer JWT', async () => {
    const { signAccessToken } = await import('./mobile-jwt')
    const { resolveAuthedUserId } = await import('./auth-resolver')
    const jwt = await signAccessToken({ userId: 'user_b1', sessionId: 'sess_1' })
    const req = new Request('https://x', { headers: { Authorization: `Bearer ${jwt}` } })
    expect(await resolveAuthedUserId(req)).toBe('user_b1')
  })

  it('falls back to Clerk auth() when no bearer present', async () => {
    const { auth } = await import('@clerk/nextjs/server')
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ userId: 'user_clerk' })
    const { resolveAuthedUserId } = await import('./auth-resolver')
    const req = new Request('https://x')
    expect(await resolveAuthedUserId(req)).toBe('user_clerk')
  })

  it('returns null on invalid bearer', async () => {
    const { resolveAuthedUserId } = await import('./auth-resolver')
    const req = new Request('https://x', { headers: { Authorization: 'Bearer not-a-jwt' } })
    expect(await resolveAuthedUserId(req)).toBeNull()
  })

  it('returns null when neither bearer nor Clerk session present', async () => {
    const { resolveAuthedUserId } = await import('./auth-resolver')
    expect(await resolveAuthedUserId(new Request('https://x'))).toBeNull()
  })
})
