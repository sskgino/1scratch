import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link'

// Desktop uses a custom scheme; mobile uses Android App Links / iOS Universal
// Links under the canonical HTTPS host. Both are accepted — session.signIn
// picks the appropriate return URL per platform.
const DESKTOP_PREFIX = '1scratch://auth/done'
const MOBILE_PREFIX = 'https://app.1scratch.ai/m/auth/done'

function hasPrefix(raw: string, prefix: string): boolean {
  return raw === prefix || raw.startsWith(prefix + '?') || raw.startsWith(prefix + '#')
}

function matches(raw: string): URL | null {
  if (hasPrefix(raw, MOBILE_PREFIX)) {
    try { return new URL(raw) } catch { return null }
  }
  if (hasPrefix(raw, DESKTOP_PREFIX)) {
    try {
      const u = new URL(raw.replace(/^1scratch:\/\//, 'https://'))
      Object.defineProperty(u, 'toString', { value: () => raw })
      return u
    } catch { return null }
  }
  return null
}

export async function getColdStartUrl(): Promise<URL | null> {
  const urls = (await getCurrent()) ?? []
  for (const raw of urls) {
    const m = matches(raw)
    if (m) return m
  }
  return null
}

export function listenForAuthCallback(handler: (url: URL) => void): () => void {
  let stop: (() => void) | null = null
  let cancelled = false
  const ready = onOpenUrl((urls) => {
    for (const raw of urls) {
      const m = matches(raw)
      if (m) handler(m)
    }
  })
  void Promise.resolve(ready).then((fn) => {
    stop = fn ?? null
    if (cancelled) {
      stop?.()
      stop = null
    }
  })
  return () => {
    cancelled = true
    stop?.()
    stop = null
  }
}
