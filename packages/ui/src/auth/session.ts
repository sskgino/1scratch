import { secureStore } from '../secure-store'
import { listenForAuthCallback, getColdStartUrl } from './deep-link'

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

export async function signIn(opts: {
  apiBase: string
  webBase: string
  returnUrl: string
  shellOpen: (url: string) => Promise<void>
  deviceLabel?: string
}): Promise<Session> {
  const deviceId = await ensureDeviceId()
  const params = new URLSearchParams({
    return: opts.returnUrl,
    device_id: deviceId,
    device_label: opts.deviceLabel ?? 'Tauri client',
  })
  const url = `${opts.apiBase}/api/mobile/init?${params.toString()}`

  const cold = await getColdStartUrl()
  let resolved: URL | null = cold
  if (!resolved) {
    resolved = await new Promise<URL>((resolve, reject) => {
      const stop = listenForAuthCallback((u) => { stop(); resolve(u) })
      opts.shellOpen(url).catch((e) => { stop(); reject(new Error(`shellOpen failed: ${String((e as Error)?.message ?? e)}`)) })
    })
  }
  const refresh = resolved.searchParams.get('refresh')
  const access = resolved.searchParams.get('access')
  if (!refresh || !access) throw new Error('deep-link missing refresh/access params')
  await secureStore.set('refresh', refresh)
  const sub = JSON.parse(atob(access.split('.')[1] ?? '{}')).sub as string
  return { access, userId: sub }
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
