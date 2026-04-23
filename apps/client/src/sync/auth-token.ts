import { openUrl } from '@tauri-apps/plugin-opener'
import { loadSession, signIn, type Session } from '@1scratch/ui/auth/session'

const DEFAULT_APP_BASE = 'https://app.1scratch.ai'

function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1'
}

function isVercelPreview(hostname: string): boolean {
  return hostname.endsWith('.vercel.app')
}

function normalizeBaseUrl(raw: string | undefined, allowedHosts: readonly string[]): string {
  if (!raw) return DEFAULT_APP_BASE
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && !isLoopback(url.hostname)) return DEFAULT_APP_BASE
    const hostOk =
      allowedHosts.includes(url.hostname) || isLoopback(url.hostname) || isVercelPreview(url.hostname)
    if (!hostOk) return DEFAULT_APP_BASE
    url.pathname = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return DEFAULT_APP_BASE
  }
}

function authReturnUrl(): string {
  return new URL('/m/auth/done', webBaseUrl()).toString()
}

let cached: Session | null = null

export function apiBaseUrl(): string {
  const url = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE_URL
  return normalizeBaseUrl(url, ['app.1scratch.ai', 'api.1scratch.ai'])
}

export function webBaseUrl(): string {
  const url = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_WEB_BASE_URL
  return normalizeBaseUrl(url, ['app.1scratch.ai'])
}

export async function getAuthToken(): Promise<string> {
  if (cached) return cached.access
  const sess = await loadSession({ apiBase: apiBaseUrl() })
  if (sess) {
    cached = sess
    return sess.access
  }
  throw new Error('not_signed_in')
}

export async function signInInteractive(): Promise<Session> {
  const sess = await signIn({
    apiBase: apiBaseUrl(),
    webBase: webBaseUrl(),
    returnUrl: authReturnUrl(),
    shellOpen: (u) => openUrl(u),
  })
  cached = sess
  return sess
}

export function clearAuthCache(): void { cached = null }
