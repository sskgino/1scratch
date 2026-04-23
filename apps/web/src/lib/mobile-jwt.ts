import { createHmac } from 'node:crypto'
import { KMSClient, GenerateMacCommand, VerifyMacCommand } from '@aws-sdk/client-kms'

const ALG = 'HS256'
const DEFAULT_TTL_SECONDS = 15 * 60
const MAC_ALGORITHM = 'HMAC_SHA_256'
const LOCAL_KID = 'local-dev'

function kmsKeyId(): string | null {
  return process.env.MOBILE_JWT_KMS_KEY_ID ?? null
}

function allowedKids(): Set<string> {
  const primary = kmsKeyId()
  const extra = (process.env.MOBILE_JWT_KMS_KEY_IDS ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  return new Set(primary ? [primary, ...extra] : [LOCAL_KID])
}

function issuer(): string {
  const iss = process.env.MOBILE_JWT_ISS
  if (!iss) throw new Error('MOBILE_JWT_ISS is not set')
  return iss
}

let kmsClient: KMSClient | null = null
function kms(): KMSClient {
  if (!kmsClient) {
    kmsClient = new KMSClient({ region: process.env.AWS_REGION ?? 'us-east-1' })
  }
  return kmsClient
}

function localKey(): Buffer {
  const b64 = process.env.MOBILE_JWT_SIGNING_KEY
  if (!b64) throw new Error('MOBILE_JWT_SIGNING_KEY not set (required when MOBILE_JWT_KMS_KEY_ID is unset)')
  return Buffer.from(b64, 'base64')
}

function b64url(input: string | Uint8Array): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : Buffer.from(input)
  return buf.toString('base64url')
}

function b64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url')
}

async function sign(signingInput: string, kid: string): Promise<string> {
  if (kid === LOCAL_KID) {
    const mac = createHmac('sha256', localKey()).update(signingInput).digest()
    return b64url(mac)
  }
  const res = await kms().send(new GenerateMacCommand({
    KeyId: kid,
    MacAlgorithm: MAC_ALGORITHM,
    Message: Buffer.from(signingInput, 'utf-8'),
  }))
  if (!res.Mac) throw new Error('KMS GenerateMac returned empty Mac')
  return b64url(res.Mac)
}

async function verify(signingInput: string, kid: string, signature: string): Promise<boolean> {
  if (kid === LOCAL_KID) {
    const expected = createHmac('sha256', localKey()).update(signingInput).digest()
    const actual = b64urlDecode(signature)
    if (expected.length !== actual.length) return false
    let diff = 0
    for (let i = 0; i < expected.length; i++) diff |= expected[i]! ^ actual[i]!
    return diff === 0
  }
  const res = await kms().send(new VerifyMacCommand({
    KeyId: kid,
    MacAlgorithm: MAC_ALGORITHM,
    Message: Buffer.from(signingInput, 'utf-8'),
    Mac: b64urlDecode(signature),
  }))
  return res.MacValid === true
}

export interface AccessTokenClaims {
  sub: string
  sid: string
  iss: string
  iat: number
  exp: number
}

export async function signAccessToken(opts: {
  userId: string
  sessionId: string
  expiresInSeconds?: number
}): Promise<string> {
  const ttl = opts.expiresInSeconds ?? DEFAULT_TTL_SECONDS
  const now = Math.floor(Date.now() / 1000)
  const kid = kmsKeyId() ?? LOCAL_KID
  const header = { alg: ALG, typ: 'JWT', kid }
  const payload: AccessTokenClaims = {
    sub: opts.userId,
    sid: opts.sessionId,
    iss: issuer(),
    iat: now,
    exp: now + ttl,
  }
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`
  const sig = await sign(signingInput, kid)
  return `${signingInput}.${sig}`
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const parts = token.split('.')
  if (parts.length !== 3) throw new Error('malformed token')
  const [h, p, s] = parts as [string, string, string]
  const header = JSON.parse(b64urlDecode(h).toString('utf-8')) as { alg?: string; kid?: string }
  if (header.alg !== ALG) throw new Error('unexpected alg')
  if (!header.kid) throw new Error('missing kid')
  if (!allowedKids().has(header.kid)) throw new Error('kid not allowed')
  const signingInput = `${h}.${p}`
  const ok = await verify(signingInput, header.kid, s)
  if (!ok) throw new Error('bad signature')
  const payload = JSON.parse(b64urlDecode(p).toString('utf-8')) as AccessTokenClaims
  const now = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('expired')
  if (payload.iss !== issuer()) throw new Error('bad issuer')
  if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
    throw new Error('missing sub/sid')
  }
  return payload
}
