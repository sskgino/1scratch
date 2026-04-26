import { useEffect, useRef, useState } from 'react'
import { useMobileNav } from '../../store/mobileNav'
import { useCardsStore } from '../../store/cards'
import { useNetwork } from '../../hooks/useNetwork'
import { useSettingsStore } from '../../store/settings'
import { BottomTabBar } from './BottomTabBar'
import { SafeArea } from './shared/SafeArea'
import { SyncBanner, type SyncBannerState } from './shared/SyncBanner'
import { QuickCapture } from './capture/QuickCapture'
import { Library } from './library/Library'
import { YouSurface } from './you/YouSurface'
import { MobileCanvas } from './canvas/MobileCanvas'

export interface MobileShellProps {
  signOut: () => Promise<void>
  lastError?: string | null
  triggerNow?: () => void | Promise<void>
}

function useSyncBannerState(lastError: string | null, outboxCount: number): SyncBannerState {
  const { online } = useNetwork()
  const [state, setState] = useState<SyncBannerState>(online ? 'hidden' : 'offline-saved')
  const wasOffline = useRef(!online)

  useEffect(() => {
    if (!online) { setState('offline-saved'); wasOffline.current = true; return }
    if (wasOffline.current) {
      setState('reconnecting')
      const t = setTimeout(() => {
        wasOffline.current = false
        setState(lastError && outboxCount > 0 ? 'sync-failed' : 'hidden')
      }, 2000)
      return () => clearTimeout(t)
    }
    setState(lastError && outboxCount > 0 ? 'sync-failed' : 'hidden')
  }, [online, outboxCount, lastError])

  return state
}

export function MobileShell({ signOut, lastError = null, triggerNow }: MobileShellProps) {
  const tab = useMobileNav((s) => s.tab)
  const setTab = useMobileNav((s) => s.setTab)
  const outboxCount = useCardsStore((s) => s.outboxCount)
  const theme = useSettingsStore((s) => s.theme)
  const banner = useSyncBannerState(lastError, outboxCount)

  useEffect(() => {
    const w = window as unknown as { __TAURI_INTERNALS__?: unknown }
    if (!w.__TAURI_INTERNALS__) return
    let cancelled = false
    void (async () => {
      const { invoke } = await import('@tauri-apps/api/core')
      if (cancelled) return
      try { await invoke('mobile_status_bar', { theme }) } catch { /* desktop / unsupported */ }
    })()
    return () => { cancelled = true }
  }, [theme])

  return (
    <div data-mobile-shell style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <SafeArea edges={['top']}>
        <header style={{ padding: '8px 16px', fontSize: 14, color: '#666' }}>1Scratch</header>
      </SafeArea>
      <SyncBanner state={banner} onTap={banner === 'sync-failed' ? () => setTab('you') : undefined} />
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'capture' && <QuickCapture />}
        {tab === 'canvas'  && <MobileCanvas onRefresh={triggerNow} />}
        {tab === 'library' && <Library />}
        {tab === 'you'     && <YouSurface signOut={signOut} lastError={lastError} triggerNow={triggerNow} />}
      </main>
      <BottomTabBar />
    </div>
  )
}
