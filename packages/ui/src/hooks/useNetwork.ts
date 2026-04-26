import { useEffect, useState } from 'react'

export interface NetworkState {
  online: boolean
  type: 'wifi' | 'cellular' | 'unknown' | 'offline'
}

export function useNetwork(): NetworkState {
  const [state, setState] = useState<NetworkState>(() => ({
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    type:   typeof navigator === 'undefined' || navigator.onLine ? 'unknown' : 'offline',
  }))

  useEffect(() => {
    const onLine  = () => setState({ online: true,  type: 'unknown' })
    const offLine = () => setState({ online: false, type: 'offline' })
    window.addEventListener('online',  onLine)
    window.addEventListener('offline', offLine)

    let mounted = true
    let unlisten: undefined | (() => void)
    if (typeof window !== 'undefined' && (window as any).__TAURI_INTERNALS__) {
      import('@tauri-apps/api/event').then(({ listen }) =>
        listen<NetworkState>('network-change', (e) => {
          if (mounted) setState(e.payload)
        }).then((fn) => {
          if (mounted) unlisten = fn
          else fn()
        })
      )
    }
    return () => {
      mounted = false
      window.removeEventListener('online',  onLine)
      window.removeEventListener('offline', offLine)
      unlisten?.()
    }
  }, [])

  return state
}
