import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

const ALG = 'HS256'
const DEFAULT_TTL_SECONDS = 15 * 60

function signingKey(): Uint8Array {
  const b64 = process.env.MOBILE_JWT_SIGNING_KEY
  if (!b64) throw new Error('MOBILE_JWT_SIGNING_KEY is not set')
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}

function issuer(): string {
  const iss = process.env.MOBILE_JWT_ISS
  if (!iss) throw new Error('MOBILE_JWT_ISS is not set')
  return iss
}

export interface AccessTokenClaims extends JWTPayload {
  sub: string
  sid: string
  iss: string
}

export async function signAccessToken(opts: {
  userId: string
  sessionId: string
  expiresInSeconds?: number
}): Promise<string> {
  const ttl = opts.expiresInSeconds ?? DEFAULT_TTL_SECONDS
  const now = Math.floor(Date.now() / 1000)
  return await new SignJWT({ sid: opts.sessionId })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(issuer())
    .setSubject(opts.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(signingKey())
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, signingKey(), {
    issuer: issuer(),
    algorithms: [ALG],
  })
  if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
    throw new Error('access token missing sub/sid')
  }
  return payload as AccessTokenClaims
}
