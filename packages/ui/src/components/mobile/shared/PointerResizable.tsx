import { useRef, type ReactNode } from 'react'

export interface PointerResizableProps {
  size: { width: number; height: number }
  onSizeChange: (s: { width: number; height: number }) => void
  onResizeStart?: () => void
  onResizeEnd?: () => void
  minWidth?: number
  minHeight?: number
  selected: boolean
  children: ReactNode
}

interface ResizeState {
  pointerId: number
  startX: number; startY: number
  origW: number;  origH: number
}

export function PointerResizable(props: PointerResizableProps) {
  const { size, onSizeChange, onResizeStart, onResizeEnd, minWidth = 80, minHeight = 60, selected, children } = props
  const stateRef = useRef<ResizeState | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    stateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      origW: size.width, origH: size.height,
    }
    onResizeStart?.()
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const s = stateRef.current
    if (!s || s.pointerId !== e.pointerId) return
    const w = Math.max(minWidth,  s.origW + (e.clientX - s.startX))
    const h = Math.max(minHeight, s.origH + (e.clientY - s.startY))
    onSizeChange({ width: w, height: h })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!stateRef.current || stateRef.current.pointerId !== e.pointerId) return
    stateRef.current = null
    onResizeEnd?.()
  }

  return (
    <div style={{ position: 'relative', width: size.width, height: size.height }}>
      {children}
      {selected && (
        <div
          data-testid="resize-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            position: 'absolute', right: -4, bottom: -4, width: 24, height: 24,
            cursor: 'nwse-resize', touchAction: 'none',
            background: 'transparent',
          }}
        >
          <div style={{ position: 'absolute', right: 4, bottom: 4, width: 12, height: 12, borderRight: '2px solid #888', borderBottom: '2px solid #888' }} />
        </div>
      )}
    </div>
  )
}
