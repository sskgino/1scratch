import { useState } from 'react'
import { useWorkspaceStore } from '../../../store/workspace'
import { useMobileNav } from '../../../store/mobileNav'

export function SectionTree() {
  const sections = useWorkspaceStore((s) => s.sections)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const setMobileTab = useMobileNav((s) => s.setTab)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }))

  return (
    <div>
      {sections.map((sec) => (
        <div key={sec.id}>
          <button
            onClick={() => toggle(sec.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '12px 16px', background: 'transparent', border: 0, textAlign: 'left', fontSize: 13, color: '#666', textTransform: 'uppercase' }}
          >
            <span>{expanded[sec.id] === false ? '▸' : '▾'}</span>
            <span>{sec.name}</span>
          </button>
          {expanded[sec.id] !== false && sec.tabs.map((t) => (
            <button key={t.id}
              onClick={() => { setActiveTab(sec.id, t.id); setMobileTab('canvas') }}
              style={{ display: 'block', width: '100%', padding: '10px 32px', textAlign: 'left', background: 'transparent', border: 0, fontSize: 15 }}>
              {t.name}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
