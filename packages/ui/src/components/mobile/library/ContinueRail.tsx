import { useMemo } from 'react'
import { useWorkspaceStore } from '../../../store/workspace'
import { useMobileNav } from '../../../store/mobileNav'

export function ContinueRail() {
  const sections = useWorkspaceStore((s) => s.sections)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const setMobileTab = useMobileNav((s) => s.setTab)

  const top = useMemo(() => {
    return sections
      .flatMap((sec) => sec.tabs.map((t) => ({ sec, tab: t, ts: t.lastTouchedAt ?? 0 })))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 3)
  }, [sections])

  if (top.length === 0) return <p style={{ padding: 16, color: '#888' }}>No recent canvases yet.</p>

  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: 16 }}>
      {top.map(({ sec, tab, ts }) => (
        <button key={tab.id}
          onClick={() => { setActiveTab(sec.id, tab.id); setMobileTab('canvas') }}
          style={{ minWidth: 200, height: 88, padding: 12, borderRadius: 12, background: tab.color ?? '#f6f6f6', border: 0, textAlign: 'left' }}
        >
          <div style={{ fontSize: 11, color: '#666' }}>{sec.name}</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{tab.name}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>{ts ? `${Math.round((Date.now() - ts) / 60000)}m ago` : 'never'}</div>
        </button>
      ))}
    </div>
  )
}
