import { useRef, type ReactNode } from 'react'

export interface PointerDraggableProps {
  position: { x: number; y: number }
  onPositionChange: (p: { x: number; y: number }) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  disabled?: boolean
  handle?: string
  longPressMs?: number
  children: ReactNode
}

interface DragState {
  pointerId: number
  startX: number; startY: number
  origX: number;  origY: number
  active: boolean
  longPressTimer: number | null
}

const MOVE_CANCEL_THRESHOLD = 8

export function PointerDraggable(props: PointerDraggableProps) {
  const { position, onPositionChange, onDragStart, onDragEnd, disabled, handle, longPressMs = 0, children } = props
  const stateRef = useRef<DragState | null>(null)

  const matchesHandle = (target: EventTarget | null): boolean => {
    if (!handle) return true
    if (!(target instanceof Element)) return false
    return !!target.closest(handle)
  }

  const cancel = () => {
    const s = stateRef.current
    if (!s) return
    if (s.longPressTimer != null) clearTimeout(s.longPressTimer)
    stateRef.current = null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    if (!matchesHandle(e.target)) return
    if (stateRef.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const s: DragState = {
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      origX: position.x,  origY: position.y,
      active: longPressMs === 0,
      longPressTimer: null,
    }
    if (longPressMs > 0) {
      s.longPressTimer = window.setTimeout(() => {
        s.active = true
        onDragStart?.()
      }, longPressMs)
    } else {
      onDragStart?.()
    }
    stateRef.current = s
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const s = stateRef.current
    if (!s || s.pointerId !== e.pointerId) return
    const dx = e.clientX - s.startX
    const dy = e.clientY - s.startY
    if (!s.active) {
      if (Math.abs(dx) > MOVE_CANCEL_THRESHOLD || Math.abs(dy) > MOVE_CANCEL_THRESHOLD) cancel()
      return
    }
    onPositionChange({ x: s.origX + dx, y: s.origY + dy })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const s = stateRef.current
    if (!s || s.pointerId !== e.pointerId) return
    const wasActive = s.active
    cancel()
    if (wasActive) onDragEnd?.()
  }

  return (
    <div
      style={{ touchAction: handle ? 'auto' : 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {children}
    </div>
  )
}
