import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link'

const PREFIX = '1scratch://auth/done'

function matches(raw: string): URL | null {
  if (raw !== PREFIX && !raw.startsWith(PREFIX + '?') && !raw.startsWith(PREFIX + '#')) return null
  try {
    const u = new URL(raw.replace(/^1scratch:\/\//, 'https://'))
    Object.defineProperty(u, 'toString', { value: () => raw })
    return u
  } catch {
    return null
  }
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
  const stop = onOpenUrl((urls) => {
    for (const raw of urls) {
      const m = matches(raw)
      if (m) handler(m)
    }
  })
  let cancelled = false
  void stop.then?.((fn) => { if (cancelled) fn?.() })
  return () => { cancelled = true }
}
