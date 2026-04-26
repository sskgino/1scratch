import { useEffect, useState } from 'react'
import { getColdStartShareUrl, listenForShareIntent } from '../lib/share-intent-link'

export type SharePayload =
  | { kind: 'capture' }
  | { kind: 'share'; raw: string }

export interface ShareIntent {
  pendingPayload: SharePayload | null
  consume: () => void
}

function parse(url: URL): SharePayload | null {
  const path = (url.pathname.replace(/^\/+/, '') || url.host).toLowerCase()
  if (path === 'capture') return { kind: 'capture' }
  if (path === 'share') return { kind: 'share', raw: url.toString() }
  return null
}

export function useShareIntent(): ShareIntent {
  const [pending, setPending] = useState<SharePayload | null>(null)

  useEffect(() => {
    let cancelled = false
    void getColdStartShareUrl().then((u) => {
      if (cancelled || !u) return
      const p = parse(u)
      if (p) setPending(p)
    })
    const unlisten = listenForShareIntent((u) => {
      if (cancelled) return
      const p = parse(u)
      if (p) setPending(p)
    })
    return () => { cancelled = true; unlisten() }
  }, [])

  return { pendingPayload: pending, consume: () => setPending(null) }
}
