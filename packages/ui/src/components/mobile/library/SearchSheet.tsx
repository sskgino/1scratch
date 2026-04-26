import { useEffect, useState } from 'react'
import Database from '@tauri-apps/plugin-sql'
import { BottomSheet } from '../shared/BottomSheet'
import { searchCards, snippetSegments, type CardHit } from '../../../lib/fts'
import { useCardsStore } from '../../../store/cards'
import { useWorkspaceStore } from '../../../store/workspace'
import { useMobileNav } from '../../../store/mobileNav'

let dbPromise: Promise<Database> | null = null
function db(): Promise<Database> {
  if (!dbPromise) dbPromise = Database.load('sqlite:sync.db')
  return dbPromise
}

export interface SearchSheetProps {
  open: boolean
  onDismiss: () => void
}

export function SearchSheet({ open, onDismiss }: SearchSheetProps) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<CardHit[]>([])
  const setSelected = useCardsStore((s) => s.setSelectedCard)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const sections = useWorkspaceStore((s) => s.sections)
  const setMobileTab = useMobileNav((s) => s.setTab)

  useEffect(() => {
    if (!q.trim()) { setHits([]); return }
    const t = setTimeout(async () => {
      const d = await db()
      const r = await searchCards(d, q)
      setHits(r)
    }, 150)
    return () => clearTimeout(t)
  }, [q])

  const sectionForCanvas = (canvasId: string) => {
    for (const sec of sections) for (const t of sec.tabs) if (t.id === canvasId) return sec.id
    return ''
  }

  const grouped = hits.reduce((acc, h) => {
    const key = h.sectionName ?? '—'
    ;(acc[key] ??= []).push(h)
    return acc
  }, {} as Record<string, CardHit[]>)

  return (
    <BottomSheet open={open} onDismiss={onDismiss} snap={1}>
      <div style={{ padding: 16 }}>
        <input
          autoFocus
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search across canvases"
          style={{ width: '100%', padding: 12, fontSize: 16, border: '1px solid #ddd', borderRadius: 8 }}
        />
        <div style={{ marginTop: 12 }}>
          {Object.entries(grouped).map(([sn, list]) => (
            <div key={sn}>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', margin: '8px 0' }}>{sn}</div>
              {list.map((h) => (
                <button key={h.cardId}
                  onClick={() => {
                    setSelected(h.cardId)
                    setActiveTab(sectionForCanvas(h.canvasId), h.canvasId)
                    setMobileTab('canvas')
                    onDismiss()
                  }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 0', background: 'transparent', border: 0, fontSize: 14 }}
                >
                  {snippetSegments(h.snippet).map((seg, i) =>
                    seg.hit
                      ? <mark key={i} style={{ background: '#fef08a', color: 'inherit' }}>{seg.text}</mark>
                      : <span key={i}>{seg.text}</span>,
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </BottomSheet>
  )
}
