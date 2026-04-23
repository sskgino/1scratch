import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PASTEL_PALETTE, NEUTRAL_SWATCH, type PastelSwatch } from '../../lib/colors'

export interface ContextMenuItem {
  id: string
  label: string
  onSelect: () => void
  destructive?: boolean
}

interface Props {
  x: number
  y: number
  items: ContextMenuItem[]
  // When provided, shows the inline color picker submenu (right of the parent).
  colorPicker?: {
    currentColor: string | null | undefined
    onPick: (id: string | null) => void
    surface: 'light' | 'dark'
  }
  onClose: () => void
}

export default function ContextMenu({ x, y, items, colorPicker, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [colorOpen, setColorOpen] = useState(false)

  // Clamp menu position inside the viewport after it mounts and we know its size.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 6
    const nx = Math.min(x, window.innerWidth - r.width - margin)
    const ny = Math.min(y, window.innerHeight - r.height - margin)
    setPos({ x: Math.max(margin, nx), y: Math.max(margin, ny) })
  }, [x, y])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    // mousedown on capture so we beat any click handlers
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const allItems: ContextMenuItem[] = colorPicker
    ? [
        {
          id: '__color__',
          label: 'Change color',
          onSelect: () => setColorOpen((v) => !v),
        },
        ...items,
      ]
    : items

  return createPortal(
    <div
      ref={rootRef}
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        zIndex: 10000,
        background: '#fdfdfd',
        border: '1px solid rgba(0,0,0,0.08)',
        borderRadius: 10,
        boxShadow: '0 10px 32px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.06)',
        padding: 4,
        minWidth: 168,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        color: '#1a1a1a',
        animation: 'ctx-menu-in 0.14s cubic-bezier(0.32, 0.72, 0, 1) both',
        userSelect: 'none',
      }}
    >
      {allItems.map((item) => {
        const isColor = item.id === '__color__'
        return (
          <div key={item.id} style={{ position: 'relative' }}>
            <button
              onClick={() => {
                item.onSelect()
                if (!isColor) onClose()
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: item.destructive ? '#b03a3a' : '#1a1a1a',
                padding: '7px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 13,
                textAlign: 'left',
                fontFamily: 'system-ui, sans-serif',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'rgba(0,0,0,0.05)'
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
              }}
            >
              <span>{item.label}</span>
              {isColor && (
                <span style={{ color: '#999', fontSize: 11, marginLeft: 12 }}>
                  {colorOpen ? '\u25BE' : '\u25B8'}
                </span>
              )}
            </button>

            {isColor && colorOpen && colorPicker && (
              <ColorSwatchGrid
                current={colorPicker.currentColor ?? null}
                surface={colorPicker.surface}
                onPick={(id) => {
                  colorPicker.onPick(id)
                  onClose()
                }}
              />
            )}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}

function ColorSwatchGrid({
  current,
  surface,
  onPick,
}: {
  current: string | null
  surface: 'light' | 'dark'
  onPick: (id: string | null) => void
}) {
  const swatches: PastelSwatch[] = PASTEL_PALETTE
  return (
    <div
      style={{
        padding: '6px 8px 8px',
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 6,
      }}
    >
      {swatches.map((sw) => {
        const isActive = current === sw.id
        const fill = surface === 'dark' ? sw.baseDark : sw.base
        return (
          <button
            key={sw.id}
            title={sw.label}
            onClick={() => onPick(sw.id)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 999,
              background: fill,
              border: isActive ? '2px solid #1a1a1a' : `1px solid ${sw.edge}`,
              cursor: 'pointer',
              padding: 0,
              transition: 'transform 0.12s cubic-bezier(0.32, 0.72, 0, 1)',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1.12)'
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.transform = 'scale(1)'
            }}
          />
        )
      })}
      <button
        title={NEUTRAL_SWATCH.label}
        onClick={() => onPick(null)}
        style={{
          width: 24,
          height: 24,
          borderRadius: 999,
          background: 'transparent',
          border: current === null ? '2px dashed #1a1a1a' : '1px dashed #bbb',
          cursor: 'pointer',
          padding: 0,
          color: '#999',
          fontSize: 11,
        }}
      >
        {'\u2298'}
      </button>
    </div>
  )
}
