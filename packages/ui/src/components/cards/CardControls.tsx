import { useState, useRef, useEffect } from 'react'
import { useSettingsStore, FONTS } from '../../store/settings'
import { useCardsStore } from '../../store/cards'
import type { Card } from '../../store/cards'

interface Props {
  card: Card
}

export default function CardControls({ card }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { modelSlots, fontFamily, setFontFamily } = useSettingsStore()
  const { updateCard, removeCard } = useCardsStore()

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const cycleSlot = () => {
    const slots = ['0','1','2','3','4','5','6','7','8','9']
    const idx = slots.indexOf(card.modelSlot)
    updateCard(card.id, { modelSlot: slots[(idx + 1) % 10] })
  }

  return (
    <div
      ref={ref}
      className="no-drag card-controls"
      style={{
        position: 'absolute',
        top: 4,
        right: 4,
        display: 'flex',
        alignItems: 'center',
        gap: 3,
        zIndex: 10,
      }}
    >
      {/* Model slot badge */}
      <button
        onClick={cycleSlot}
        title={`Slot ${card.modelSlot}: ${modelSlots[card.modelSlot] || '(empty)'} — click to cycle`}
        style={badgeStyle}
      >
        {card.modelSlot}
      </button>

      {/* Gear */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Card settings"
        style={badgeStyle}
      >
        ⚙
      </button>

      {/* Popover */}
      {open && (
        <div style={{
          position: 'absolute',
          top: 24,
          right: 0,
          background: '#fff',
          border: '1px solid rgba(0,0,0,0.12)',
          borderRadius: 8,
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          padding: 12,
          minWidth: 220,
          zIndex: 9999,
        }}>
          {/* Model slots */}
          <div style={{ marginBottom: 10 }}>
            <div style={sectionLabel}>Model Slots</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
              {['0','1','2','3','4','5','6','7','8','9'].map((slot) => (
                <button
                  key={slot}
                  onClick={() => updateCard(card.id, { modelSlot: slot })}
                  title={modelSlots[slot] || '(empty)'}
                  style={{
                    background: card.modelSlot === slot ? '#1a1a1a' : 'rgba(0,0,0,0.05)',
                    border: '1px solid rgba(0,0,0,0.1)',
                    borderRadius: 4,
                    fontSize: 12,
                    fontWeight: 700,
                    padding: '4px 0',
                    cursor: 'pointer',
                    color: card.modelSlot === slot ? '#fff' : '#333',
                    fontFamily: 'system-ui',
                    opacity: modelSlots[slot] ? 1 : 0.35,
                  }}
                >
                  {slot}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: '#aaa', marginTop: 4, fontFamily: 'system-ui' }}>
              {modelSlots[card.modelSlot]
                ? modelSlots[card.modelSlot]!.replace('claude-', '').replace('-20251001', '')
                : '(empty — configure in Settings)'}
            </div>
          </div>

          {/* Font */}
          <div style={{ marginBottom: 10 }}>
            <div style={sectionLabel}>Font</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {FONTS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFontFamily(f.id)}
                  style={{
                    background: fontFamily === f.id ? '#1a1a1a' : 'transparent',
                    border: 'none',
                    borderRadius: 4,
                    fontSize: 14,
                    padding: '3px 8px',
                    cursor: 'pointer',
                    color: fontFamily === f.id ? '#fff' : '#333',
                    textAlign: 'left',
                    fontFamily: f.css,
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ borderTop: '1px solid rgba(0,0,0,0.08)', paddingTop: 8 }}>
            <button
              onClick={() => { removeCard(card.id); setOpen(false) }}
              style={{
                background: 'none', border: 'none', fontSize: 12,
                color: '#e53e3e', cursor: 'pointer', padding: '2px 0',
                fontFamily: 'system-ui', width: '100%', textAlign: 'left',
              }}
            >
              Delete card
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const badgeStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.06)',
  border: '1px solid rgba(0,0,0,0.1)',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 700,
  width: 20,
  height: 20,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#666',
  fontFamily: 'system-ui',
}

const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: '#888',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: 6,
  fontFamily: 'system-ui',
}
