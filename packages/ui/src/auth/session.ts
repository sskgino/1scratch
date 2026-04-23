import { secureStore } from '../secure-store'

export interface Session { access: string; userId: string }

interface ExchangeResponse {
  access_jwt: string
  refresh_token: string
  user: { id: string }
}

export async function ensureDeviceId(): Promise<string> {
  const existing = await secureStore.get('device_id')
  if (existing) return existing
  const id = crypto.randomUUID()
  await secureStore.set('device_id', id)
  return id
}

export async function loadSession(opts: { apiBase: string }): Promise<Session | null> {
  const refresh = await secureStore.get('refresh')
  if (!refresh) return null
  const res = await fetch(`${opts.apiBase}/api/mobile/refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${refresh}` },
  })
  if (res.status === 401) {
    await secureStore.delete('refresh')
    return null
  }
  if (!res.ok) throw new Error(`refresh failed (${res.status})`)
  const body = (await res.json()) as ExchangeResponse
  await secureStore.set('refresh', body.refresh_token)
  return { access: body.access_jwt, userId: body.user.id }
}

// Opens the system browser for the Clerk sign-in flow. Does NOT wait for the
// deep-link return — the caller (App boot) registers a single listener that
// consumes the callback URL and persists the refresh token. Two writers were
// racing: this function and the App listener both saved the URL's refresh,
// but App's loadSession() rotated it server-side first, so signIn's later
// write clobbered the freshly-rotated token with the now-revoked one.
export async function signIn(opts: {
  webBase: string
  returnUrl: string
  shellOpen: (url: string) => Promise<void>
  deviceLabel?: string
}): Promise<void> {
  const deviceId = await ensureDeviceId()
  const params = new URLSearchParams({
    return: opts.returnUrl,
    device_id: deviceId,
    device_label: opts.deviceLabel ?? 'Tauri client',
  })
  const url = new URL('/api/mobile/init', opts.webBase)
  url.search = params.toString()
  await opts.shellOpen(url.toString())
}

export async function signOut(opts: { apiBase: string }): Promise<void> {
  const refresh = await secureStore.get('refresh')
  if (refresh) {
    await fetch(`${opts.apiBase}/api/mobile/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${refresh}` },
    }).catch(() => {})
  }
  await secureStore.delete('refresh')
}
