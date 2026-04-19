// GET /oauth/callback/:provider — provider redirects here with ?code=...
// We read the PKCE verifier from the cookie set by /oauth/start, exchange
// the code, seal the resulting secret, insert a provider_connections row
// (kind='oauth'), clear the cookie, and bounce to /app/models.

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { exchangeCode } from '@/lib/oauth/openrouter'
import { saveOauthConnection } from '@/lib/providers'
import { record } from '@/lib/audit-events'

export const runtime = 'nodejs'
export const maxDuration = 15

const ProviderSchema = z.enum(['openrouter'])
const COOKIE_PREFIX = 'oauth_pkce_'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { userId } = await auth()
  if (!userId) return NextResponse.redirect(new URL('/sign-in', req.url))

  const { provider: raw } = await params
  const parsed = ProviderSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.redirect(new URL('/app/models?oauth=unsupported', req.url))
  }
  const provider = parsed.data

  const url = new URL(req.url)
  const code = url.searchParams.get('code')
  if (!code) {
    return NextResponse.redirect(new URL('/app/models?oauth=missing_code', req.url))
  }

  const jar = await cookies()
  const cookieName = `${COOKIE_PREFIX}${provider}`
  const raw_ = jar.get(cookieName)?.value
  if (!raw_) {
    return NextResponse.redirect(new URL('/app/models?oauth=missing_verifier', req.url))
  }

  let stored: { verifier: string; userId: string; label: string | null }
  try {
    stored = JSON.parse(raw_)
  } catch {
    return NextResponse.redirect(new URL('/app/models?oauth=bad_cookie', req.url))
  }
  if (stored.userId !== userId) {
    return NextResponse.redirect(new URL('/app/models?oauth=user_mismatch', req.url))
  }

  let secret: string
  try {
    const { key } = await exchangeCode({ code, codeVerifier: stored.verifier })
    secret = key
  } catch {
    return NextResponse.redirect(new URL('/app/models?oauth=exchange_failed', req.url))
  }

  const saved = await saveOauthConnection({
    userId,
    provider,
    label: stored.label,
    plaintext: secret,
  })
  await record(userId, 'oauth_connected', {
    ip: req.headers.get('x-forwarded-for'),
    ua: req.headers.get('user-agent'),
    meta: { connectionId: saved.id, provider },
  })

  jar.delete(cookieName)
  return NextResponse.redirect(new URL('/app/models?oauth=connected', req.url))
}
