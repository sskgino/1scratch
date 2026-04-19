// OpenRouter OAuth (PKCE). Unusual shape: the "token exchange" mints a
// long-lived OpenRouter API key rather than an OAuth access/refresh pair,
// so we store the resulting key in the same envelope-encrypted field as
// a BYOK key — the only practical difference is `kind='oauth'` in the row.
//
// Flow:
//   start(userId, callbackUrl, verifier) → authorize URL
//   exchange(code, verifier) → { key }
//
// Docs: https://openrouter.ai/docs/use-cases/oauth-pkce

const AUTH_URL = 'https://openrouter.ai/auth'
const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys'

export function buildAuthorizeUrl(args: {
  callbackUrl: string
  codeChallenge: string
}): string {
  const u = new URL(AUTH_URL)
  u.searchParams.set('callback_url', args.callbackUrl)
  u.searchParams.set('code_challenge', args.codeChallenge)
  u.searchParams.set('code_challenge_method', 'S256')
  return u.toString()
}

export async function exchangeCode(args: {
  code: string
  codeVerifier: string
}): Promise<{ key: string }> {
  const res = await fetch(EXCHANGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: args.code,
      code_verifier: args.codeVerifier,
      code_challenge_method: 'S256',
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`openrouter_exchange_${res.status}: ${body.slice(0, 200)}`)
  }
  const json = (await res.json()) as { key?: string }
  if (!json.key) throw new Error('openrouter_exchange_no_key')
  return { key: json.key }
}
