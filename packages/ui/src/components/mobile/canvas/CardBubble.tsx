import type { Card } from '../../../store/cards'
import { ImageCard } from './ImageCard'

export interface CardBubbleProps {
  card: Card
  onTap: () => void
}

export function CardBubble({ card, onTap }: CardBubbleProps) {
  return (
    <button onClick={onTap}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: 12, background: '#fff', border: '1px solid #eee', borderRadius: 12 }}>
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
