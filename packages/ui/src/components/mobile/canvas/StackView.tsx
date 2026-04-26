import { useMemo } from 'react'
import { useCardsStore } from '../../../store/cards'
import { CardBubble } from './CardBubble'
import { SwipeActions } from '../shared/SwipeActions'
import { PullToRefresh } from '../shared/PullToRefresh'

export interface StackViewProps {
  canvasId: string
  onRefresh: () => Promise<void>
}

export function StackView({ canvasId, onRefresh }: StackViewProps) {
  const cards = useCardsStore((s) => s.cards)
  const removeCard = useCardsStore((s) => s.removeCard)
  const setSelected = useCardsStore((s) => s.setSelectedCard)

  const list = useMemo(
    () => Object.values(cards)
      .filter((c) => c.canvasId === canvasId)
      .sort((a, b) => b.zIndex - a.zIndex),
    [cards, canvasId],
  )

  return (
    <PullToRefresh onRefresh={onRefresh}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
        {list.map((c) => (
          <SwipeActions key={c.id}
            leftAction={{ label: 'Delete', color: '#a33', onTrigger: () => removeCard(c.id) }}
            rightAction={{ label: 'Archive', color: '#888', onTrigger: () => removeCard(c.id) }}
          >
            <CardBubble card={c} onTap={() => setSelected(c.id)} />
          </SwipeActions>
        ))}
      </div>
    </PullToRefresh>
  )
}
