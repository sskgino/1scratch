import { Rnd } from 'react-rnd'
import { useCardsStore } from '../../store/cards'
import type { Card } from '../../store/cards'

interface Props {
  card: Card
  children: React.ReactNode
}

export default function CardShell({ card, children }: Props) {
  const { updateCard, bringToFront } = useCardsStore()

  return (
    <Rnd
      position={{ x: card.x, y: card.y }}
      size={{ width: card.width, height: card.height }}
      minWidth={80}
      minHeight={36}
      dragHandleClassName="drag-tab"
      cancel="textarea, input, button, select, .no-drag"
      style={{ zIndex: card.zIndex, position: 'absolute' }}
      onDragStart={() => bringToFront(card.id)}
      onDragStop={(_e, d) => updateCard(card.id, { x: d.x, y: d.y })}
      onResizeStart={() => bringToFront(card.id)}
      onResizeStop={(_e, _dir, ref, _delta, pos) => {
        updateCard(card.id, {
          width: ref.offsetWidth,
          height: ref.offsetHeight,
          x: pos.x,
          y: pos.y,
        })
      }}
      onMouseDown={() => bringToFront(card.id)}
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
        {/* Drag tab — centered at top, sticks up above the card */}
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
          <span style={{
            fontSize: 8,
            color: 'rgba(0,0,0,0.35)',
            letterSpacing: '1px',
            lineHeight: 1,
            pointerEvents: 'none',
          }}>
            ⠿
          </span>
        </div>

        {children}
      </div>
    </Rnd>
  )
}
