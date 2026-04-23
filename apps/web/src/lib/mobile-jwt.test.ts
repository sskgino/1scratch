import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(() => {
  delete process.env.MOBILE_JWT_KMS_KEY_ID
  delete process.env.MOBILE_JWT_KMS_KEY_IDS
  process.env.MOBILE_JWT_SIGNING_KEY ??= Buffer.alloc(32, 1).toString('base64')
  process.env.MOBILE_JWT_ISS = 'https://app.1scratch.ai'
})

describe('mobile-jwt', () => {
  it('signs and verifies an access token round-trip', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./mobile-jwt')
    const jwt = await signAccessToken({ userId: 'user_abc', sessionId: 'sess_1' })
    const payload = await verifyAccessToken(jwt)
    expect(payload.sub).toBe('user_abc')
    expect(payload.sid).toBe('sess_1')
    expect(payload.iss).toBe('https://app.1scratch.ai')
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('rejects a token signed with the wrong key', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./mobile-jwt')
    const original = process.env.MOBILE_JWT_SIGNING_KEY
    const jwt = await signAccessToken({ userId: 'u', sessionId: 's' })
    process.env.MOBILE_JWT_SIGNING_KEY = Buffer.alloc(32, 2).toString('base64')
    await expect(verifyAccessToken(jwt)).rejects.toThrow()
    process.env.MOBILE_JWT_SIGNING_KEY = original
  })

  it('rejects an expired token', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./mobile-jwt')
    const jwt = await signAccessToken({ userId: 'u', sessionId: 's', expiresInSeconds: -1 })
    await expect(verifyAccessToken(jwt)).rejects.toThrow()
  })
})
