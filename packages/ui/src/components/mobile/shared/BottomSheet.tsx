import { useEffect, useRef, type ReactNode } from 'react'

export interface BottomSheetProps {
  open: boolean
  onDismiss: () => void
  children: ReactNode
  snap?: 0.5 | 1
}

export function BottomSheet({ open, onDismiss, children, snap = 0.5 }: BottomSheetProps) {
  const ref = useRef<HTMLDivElement | null>(null)

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

  if (!open) return null

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
        }}
      >
        <div style={{ height: 4, width: 36, background: '#ccc', borderRadius: 2, margin: '8px auto' }} />
        {children}
      </div>
    </div>
  )
}
