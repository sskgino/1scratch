import { useMemo } from 'react'
import { useCardsStore } from '../../../store/cards'
import { useMobileNav } from '../../../store/mobileNav'
import { SwipeActions } from '../shared/SwipeActions'

export function RecentStack() {
  const cards = useCardsStore((s) => s.cards)
  const removeCard = useCardsStore((s) => s.removeCard)
  const setSelected = useCardsStore((s) => s.setSelectedCard)
  const setTab = useMobileNav((s) => s.setTab)

  const sorted = useMemo(
    () => Object.values(cards).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
    [cards],
  )

  return (
    <div style={{
      display: 'flex', flexDirection: 'column-reverse', gap: 8,
      padding: 8, overflowY: 'auto', flex: 1,
    }}>
      {sorted.map((c) => (
        <SwipeActions
          key={c.id}
          leftAction={{ label: 'Delete', color: '#a33', onTrigger: () => removeCard(c.id) }}
        >
          <button
            onClick={() => { setSelected(c.id); setTab('canvas') }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: 12, background: '#fff', border: '1px solid #eee', borderRadius: 12,
            }}
          >
            <span style={{ fontSize: 11, color: '#888' }}>
              {new Date(c.createdAt).toLocaleTimeString()}
            </span>
            <p style={{
              margin: '4px 0 0', fontSize: 14,
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {c.kind === 'prompt' ? c.prompt : '🖼 Image'}
            </p>
          </button>
        </SwipeActions>
      ))}
    </div>
  )
}
