import { useCardsStore } from '../../store/cards'
import type { Card } from '../../store/cards'
import { PointerDraggable } from '../mobile/shared/PointerDraggable'
import { PointerResizable } from '../mobile/shared/PointerResizable'

interface Props {
  card: Card
  children: React.ReactNode
}

export default function CardShell({ card, children }: Props) {
  const updateCard = useCardsStore((s) => s.updateCard)
  const bringToFront = useCardsStore((s) => s.bringToFront)
  const setSelectedCard = useCardsStore((s) => s.setSelectedCard)
  const isSelected = useCardsStore((s) => s.selectedCardId === card.id)
  const sync = useCardsStore((s) => s.syncState(card.id))

  return (
    <div
      style={{ position: 'absolute', left: card.x, top: card.y, zIndex: card.zIndex }}
      onPointerDownCapture={() => {
        bringToFront(card.id)
        setSelectedCard(card.id)
      }}
    >
      <PointerDraggable
        position={{ x: card.x, y: card.y }}
        onPositionChange={(p) => updateCard(card.id, { x: p.x, y: p.y })}
        handle=".drag-tab"
      >
        <PointerResizable
          size={{ width: card.width, height: card.height }}
          onSizeChange={(s) => updateCard(card.id, { width: s.width, height: s.height })}
          minWidth={80}
          minHeight={36}
          selected={isSelected}
        >
          <div
            className="scratch-card"
            style={{
              width: '100%',
              height: '100%',
              position: 'relative',
              background: 'transparent',
              borderRadius: 3,
            }}
          >
            <div
              className="drag-tab card-controls"
              title="Drag to move"
              style={{
                position: 'absolute',
                top: -14,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 36,
                height: 14,
                background: 'rgba(0,0,0,0.09)',
                border: '1px solid rgba(0,0,0,0.13)',
                borderBottom: 'none',
                borderRadius: '4px 4px 0 0',
                cursor: 'grab',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                userSelect: 'none',
              }}
            >
              <span
                style={{
                  fontSize: 8,
                  color: 'rgba(0,0,0,0.35)',
                  letterSpacing: '1px',
                  lineHeight: 1,
                  pointerEvents: 'none',
                }}
              >
                ⠿
              </span>
            </div>
            {sync !== 'synced' && (
              <span
                role="status"
                aria-label={sync === 'conflict' ? 'Sync conflict' : 'Pending sync'}
                onClick={(e) => {
                  if (sync !== 'conflict') return
                  e.stopPropagation()
                  alert('This card was updated on another device — your changes were not applied. Reach out to support if data looks wrong.')
                }}
                style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, background: sync === 'conflict' ? '#a33' : '#dba03c', zIndex: 2 }}
              />
            )}
            {children}
          </div>
        </PointerResizable>
      </PointerDraggable>
    </div>
  )
}
