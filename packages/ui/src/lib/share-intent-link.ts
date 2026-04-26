import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link'

export type ShareIntentUrl = URL & { __brand: 'shareIntent' }

function isShareIntent(raw: string): URL | null {
  let u: URL
  try {
    const normalized = raw.replace(/^1scratch:/, 'onescratch:')
    u = new URL(normalized)
    Object.defineProperty(u, 'toString', { value: () => raw })
  } catch { return null }
  if (u.protocol !== 'onescratch:') return null
  const path = (u.pathname.replace(/^\/+/, '') || u.host).toLowerCase()
  if (path !== 'capture' && path !== 'share') return null
  return u
}

export async function getColdStartShareUrl(): Promise<URL | null> {
  const urls = (await getCurrent()) ?? []
  for (const raw of urls) {
    const m = isShareIntent(raw)
    if (m) return m
  }
  return null
}

export function listenForShareIntent(handler: (url: URL) => void): () => void {
  let stop: (() => void) | null = null
  let cancelled = false
  const ready = onOpenUrl((urls) => {
    for (const raw of urls) {
      const m = isShareIntent(raw)
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
