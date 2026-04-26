import type { Card } from '../../../store/cards'
import { useCardsStore } from '../../../store/cards'
import { ImageCard } from './ImageCard'

export interface CardBubbleProps {
  card: Card
  onTap: () => void
}

export function CardBubble({ card, onTap }: CardBubbleProps) {
  const sync = useCardsStore((s) => s.syncState(card.id))
  const onPipClick = (e: React.MouseEvent) => {
    if (sync !== 'conflict') return
    e.stopPropagation()
    alert('This card was updated on another device — your changes were not applied. Reach out to support if data looks wrong.')
  }
  return (
    <button onClick={onTap}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: 12, background: '#fff', border: '1px solid #eee', borderRadius: 12, position: 'relative' }}>
      {sync !== 'synced' && (
        <span
          role="status"
          aria-label={sync === 'conflict' ? 'Sync conflict' : 'Pending sync'}
          onClick={onPipClick}
          style={{ position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, background: sync === 'conflict' ? '#a33' : '#dba03c' }}
        />
      )}
      {card.kind === 'image'
        ? <ImageCard card={card} />
        : (
          <>
            <div style={{ fontSize: 13, color: '#888' }}>{new Date(card.createdAt).toLocaleString()}</div>
            <p style={{ margin: '6px 0 0', fontSize: 14, whiteSpace: 'pre-wrap' }}>{card.prompt}</p>
            {card.response && <p style={{ margin: '6px 0 0', fontSize: 13, color: '#444' }}>{card.response}</p>}
          </>
        )
      }
    </button>
  )
}
