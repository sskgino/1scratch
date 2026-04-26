import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface BottomSheetProps {
  open: boolean
  onDismiss: () => void
  children: ReactNode
  snap?: 0.5 | 1
}

export function BottomSheet({ open, onDismiss, children, snap = 0.5 }: BottomSheetProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: number; startY: number; sheetH: number } | null>(null)
  const [translateY, setTranslateY] = useState(0)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onDismiss])

  useEffect(() => {
    if (!open) return
    const node = ref.current
    if (!node) return
    const focusable = node.querySelector<HTMLElement>(
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
    )
    focusable?.focus()
  }, [open])

  if (!open) return null

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { id: e.pointerId, startY: e.clientY, sheetH: ref.current?.clientHeight ?? 1 }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return
    const dy = Math.max(0, e.clientY - drag.current.startY)
    setTranslateY(dy)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return
    const dy = e.clientY - drag.current.startY
    const threshold = drag.current.sheetH * 0.3
    drag.current = null
    setTranslateY(0)
    if (dy >= threshold) onDismiss()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }} role="dialog" aria-modal="true">
      <div
        data-testid="bottom-sheet-backdrop"
        onClick={onDismiss}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }}
      />
      <div
        ref={ref}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: snap === 1 ? '100%' : '50%',
          background: 'var(--surface, #fff)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          boxShadow: '0 -8px 32px rgba(0,0,0,0.16)',
          overflowY: 'auto',
          transform: `translateY(${translateY}px)`,
        }}
      >
        <div
          data-testid="bottom-sheet-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          style={{ height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}
        >
          <div style={{ height: 4, width: 36, background: '#ccc', borderRadius: 2 }} />
        </div>
        {children}
      </div>
    </div>
  )
}
