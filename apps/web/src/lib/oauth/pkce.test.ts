import { describe, it, expect } from 'vitest'
import { codeChallengeS256, generateCodeVerifier } from './pkce'

describe('pkce', () => {
  // RFC 7636 Appendix B test vector.
  it('S256 challenge matches RFC 7636 vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(codeChallengeS256(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('generateCodeVerifier yields 43+ chars of base64url', () => {
    const v = generateCodeVerifier()
    expect(v.length).toBeGreaterThanOrEqual(43)
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/)
  })

  it('generates distinct verifiers across calls', () => {
    const a = generateCodeVerifier()
    const b = generateCodeVerifier()
    expect(a).not.toBe(b)
  })
})
