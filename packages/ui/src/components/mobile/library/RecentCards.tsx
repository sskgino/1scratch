import { useMemo, useState } from 'react'
import { useCardsStore } from '../../../store/cards'
import { useWorkspaceStore } from '../../../store/workspace'
import { useMobileNav } from '../../../store/mobileNav'

const PAGE = 30

export function RecentCards() {
  const cards = useCardsStore((s) => s.cards)
  const setSelected = useCardsStore((s) => s.setSelectedCard)
  const sections = useWorkspaceStore((s) => s.sections)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const setMobileTab = useMobileNav((s) => s.setTab)
  const [count, setCount] = useState(PAGE)

  const sorted = useMemo(
    () => Object.values(cards).sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)),
    [cards],
  )
  const slice = sorted.slice(0, count)

  const breadcrumbFor = (canvasId: string) => {
    for (const sec of sections) for (const t of sec.tabs) if (t.id === canvasId) return `${sec.name} · ${t.name}`
    return ''
  }

  const sectionForCanvas = (canvasId: string) => {
    for (const sec of sections) for (const t of sec.tabs) if (t.id === canvasId) return sec.id
    return ''
  }

  return (
    <div>
      {slice.map((c) => (
        <button key={c.id}
          onClick={() => {
            const canvasId = c.canvasId ?? ''
            setSelected(c.id)
            setActiveTab(sectionForCanvas(canvasId), canvasId)
            setMobileTab('canvas')
          }}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', borderBottom: '1px solid #f0f0f0', background: 'transparent', border: 0 }}
        >
          <div style={{ fontSize: 11, color: '#888' }}>{breadcrumbFor(c.canvasId)}</div>
          <p style={{ margin: '4px 0 0', fontSize: 14 }}>
            {c.kind === 'prompt' ? c.prompt.slice(0, 80) : '🖼 Image'}
          </p>
        </button>
      ))}
      {count < sorted.length && (
        <button onClick={() => setCount((n) => n + PAGE)} style={{ width: '100%', padding: 16, color: '#246', background: 'transparent', border: 0 }}>
          Load more
        </button>
      )}
    </div>
  )
}
