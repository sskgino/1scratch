import { useState } from 'react'
import { BottomSheet } from './BottomSheet'
import { useWorkspaceStore } from '../../../store/workspace'

export interface TabSwitcherSheetProps {
  open: boolean
  onDismiss: () => void
}

export function TabSwitcherSheet({ open, onDismiss }: TabSwitcherSheetProps) {
  const sections = useWorkspaceStore((s) => s.sections)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const [q, setQ] = useState('')

  const matches = (s: string) => s.toLowerCase().includes(q.toLowerCase())

  return (
    <BottomSheet open={open} onDismiss={onDismiss} snap={1}>
      <div style={{ padding: 16 }}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search canvases…"
          style={{ width: '100%', padding: 12, fontSize: 16, border: '1px solid #ddd', borderRadius: 8 }}
        />
        <div style={{ marginTop: 16 }}>
          {sections.map((sec) => (
            <div key={sec.id}>
              <div style={{ fontSize: 12, color: '#888', textTransform: 'uppercase', margin: '8px 0' }}>{sec.name}</div>
              {sec.tabs.filter((t) => !q || matches(t.name) || matches(sec.name)).map((t) => (
                <button key={t.id}
                  onClick={() => { setActiveTab(sec.id, t.id); onDismiss() }}
                  style={{ display: 'block', width: '100%', padding: 12, textAlign: 'left', background: 'transparent', border: 0, fontSize: 15 }}>
                  {t.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </BottomSheet>
  )
}
