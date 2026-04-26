export type SyncBannerState = 'hidden' | 'offline-saved' | 'reconnecting' | 'sync-failed'

export interface SyncBannerProps {
  state: SyncBannerState
  onTap?: () => void
}

const COPY: Record<Exclude<SyncBannerState, 'hidden'>, { text: string; bg: string }> = {
  'offline-saved': { text: 'Offline — your changes are saved locally', bg: '#444' },
  'reconnecting':  { text: 'Reconnecting…',                            bg: '#246' },
  'sync-failed':   { text: 'Sync paused — will retry. Tap for details.', bg: '#a33' },
}

export function SyncBanner({ state, onTap }: SyncBannerProps) {
  if (state === 'hidden') return null
  const { text, bg } = COPY[state]
  return (
    <div role="status" onClick={onTap} style={{
      background: bg, color: '#fff', padding: '8px 12px',
      fontSize: 13, textAlign: 'center', cursor: onTap ? 'pointer' : 'default',
    }}>
      {text}
    </div>
  )
}
