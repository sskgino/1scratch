import { useState } from 'react'
import { DeviceList } from './DeviceList'
import { SettingsRow } from './SettingsRow'
import { BottomSheet } from '../shared/BottomSheet'
import { SyncDiagnostics } from '../../SyncDiagnostics'
import { useSettingsStore } from '../../../store/settings'

export interface YouSurfaceProps {
  signOut: () => Promise<void>
}

export function YouSurface({ signOut }: YouSurfaceProps) {
  const s = useSettingsStore()
  const [diagOpen, setDiagOpen] = useState(false)

  const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <button onClick={() => onChange(!value)} aria-pressed={value}
      style={{ width: 44, height: 26, borderRadius: 13, background: value ? '#246' : '#ccc', border: 0, position: 'relative' }}>
      <span style={{ position: 'absolute', top: 3, left: value ? 22 : 3, width: 20, height: 20, borderRadius: 10, background: '#fff' }} />
    </button>
  )

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, padding: '12px 16px', borderBottom: '1px solid #eee' }}>You</h1>

      <div style={{ fontSize: 13, color: '#888', textTransform: 'uppercase', padding: '12px 16px 0' }}>Devices</div>
      <DeviceList />

      <div style={{ fontSize: 13, color: '#888', textTransform: 'uppercase', padding: '12px 16px 0' }}>Sync</div>
      <SettingsRow label="Diagnostics" control={<button onClick={() => setDiagOpen(true)} style={{ background: 'transparent', border: 0, color: '#246' }}>›</button>} />

      <div style={{ fontSize: 13, color: '#888', textTransform: 'uppercase', padding: '12px 16px 0' }}>Settings</div>
      <SettingsRow label="Spatial canvas default" control={<Toggle value={s.spatialOnMobile} onChange={s.setSpatialOnMobile} />} />
      <SettingsRow label="Reduce motion"          control={<Toggle value={s.reduceMotion}     onChange={s.setReduceMotion} />} />
      <SettingsRow label="Smart paste"            control={<Toggle value={s.clipboardSuggestEnabled} onChange={s.setClipboardSuggestEnabled} />} />
      <SettingsRow label="Haptics"                control={<Toggle value={s.hapticsEnabled}    onChange={s.setHapticsEnabled} />} />

      <div style={{ padding: 16 }}>
        <button onClick={() => signOut()} style={{ padding: '12px 20px', border: '1px solid #ddd', borderRadius: 8, background: '#fff' }}>Sign out</button>
      </div>

      <BottomSheet open={diagOpen} onDismiss={() => setDiagOpen(false)} snap={1}>
        <div style={{ padding: 16 }}>
          <SyncDiagnostics outboxDepth={0} lastError={null} triggerNow={() => {}} />
        </div>
      </BottomSheet>
    </div>
  )
}
