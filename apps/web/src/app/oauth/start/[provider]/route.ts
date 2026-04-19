// GET /oauth/start/:provider — begin PKCE OAuth flow for a provider that
// supports it. Generates a fresh verifier, stores it in a short-lived
// HttpOnly cookie, and redirects to the provider's authorize URL with the
// S256 challenge + our callback URL baked in.
//
// Supported providers: openrouter (others added as they ship OAuth).

import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { generateCodeVerifier, codeChallengeS256 } from '@/lib/oauth/pkce'
import { buildAuthorizeUrl } from '@/lib/oauth/openrouter'

export const runtime = 'nodejs'

const ProviderSchema = z.enum(['openrouter'])
const COOKIE_MAX_AGE = 10 * 60 // 10 minutes
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
    return NextResponse.json({ error: 'unsupported_provider' }, { status: 400 })
  }
  const provider = parsed.data

  const url = new URL(req.url)
  const label = url.searchParams.get('label')?.slice(0, 60) ?? null

  const verifier = generateCodeVerifier()
  const challenge = codeChallengeS256(verifier)
  const callbackUrl = new URL(`/oauth/callback/${provider}`, url.origin).toString()
  const authorizeUrl =
    provider === 'openrouter'
      ? buildAuthorizeUrl({ callbackUrl, codeChallenge: challenge })
      : ''

  const jar = await cookies()
  jar.set(`${COOKIE_PREFIX}${provider}`, JSON.stringify({ verifier, userId, label }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/oauth',
    maxAge: COOKIE_MAX_AGE,
  })

  return NextResponse.redirect(authorizeUrl)
}
