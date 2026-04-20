import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { loadSession, signIn, type Session } from '@1scratch/ui/auth/session'

let cached: Session | null = null

export function apiBaseUrl(): string {
  const url = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE_URL
  return url ?? 'https://app.1scratch.ai'
}

export function webBaseUrl(): string {
  const url = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_WEB_BASE_URL
  return url ?? 'https://app.1scratch.ai'
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
    shellOpen: (u) => shellOpen(u),
  })
  cached = sess
  return sess
}

export function clearAuthCache(): void { cached = null }
