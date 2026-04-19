// PKCE helpers — generate a cryptographically-random verifier + its
// S256-hashed challenge in base64url form. Per RFC 7636, verifier must be
// 43–128 chars from the unreserved set.

import { createHash, randomBytes } from 'node:crypto'

export function generateCodeVerifier(): string {
  // 32 bytes → 43-char base64url (no padding).
  return base64url(randomBytes(32))
}

export function codeChallengeS256(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
