import { useState } from 'react'
import { useCanvasStore, useEffectiveViewMode } from '../../../store/canvas'
import { useWorkspaceStore } from '../../../store/workspace'
import { useMobileNav } from '../../../store/mobileNav'
import { TabSwitcherSheet } from '../shared/TabSwitcherSheet'

export function CanvasHeader() {
  const setMobileTab = useMobileNav((s) => s.setTab)
  const setViewMode = useCanvasStore((s) => s.setViewMode)
  const sections = useWorkspaceStore((s) => s.sections)

  const activeSection = sections.find((s) => s.tabs.some((t) => t.id === s.activeTabId))
  const activeTab = activeSection?.tabs.find((t) => t.id === activeSection.activeTabId)
  const canvasId = activeTab?.id ?? ''
  const mode = useEffectiveViewMode(canvasId)

  const [switcherOpen, setSwitcherOpen] = useState(false)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #eee', background: '#fff' }}>
      <button aria-label="Back" onClick={() => setMobileTab('capture')} style={{ width: 44, height: 44, fontSize: 20, border: 0, background: 'transparent' }}>‹</button>
      <button onClick={() => setSwitcherOpen(true)} style={{ flex: 1, padding: 8, fontSize: 16, fontWeight: 600, border: 0, background: 'transparent', textAlign: 'left' }}>
        {activeTab?.name ?? 'Canvas'}
      </button>
      <div role="tablist" style={{ display: 'flex', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
        <button role="tab" aria-selected={mode === 'stack'}
          onClick={() => setViewMode(canvasId, 'stack')}
          style={{ padding: '6px 10px', border: 0, background: mode === 'stack' ? '#222' : 'transparent', color: mode === 'stack' ? '#fff' : '#222' }}>⊞</button>
        <button role="tab" aria-selected={mode === 'spatial'}
          onClick={() => setViewMode(canvasId, 'spatial')}
          style={{ padding: '6px 10px', border: 0, background: mode === 'spatial' ? '#222' : 'transparent', color: mode === 'spatial' ? '#fff' : '#222' }}>⊡</button>
      </div>
      <TabSwitcherSheet open={switcherOpen} onDismiss={() => setSwitcherOpen(false)} />
    </div>
  )
}
