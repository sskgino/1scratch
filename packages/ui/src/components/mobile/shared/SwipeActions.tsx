import { useRef, useState, type ReactNode } from 'react'
import { useSettingsStore } from '../../../store/settings'

interface ActionDescriptor {
  label: string
  color: string
  onTrigger: () => void
}

export interface SwipeActionsProps {
  children: ReactNode
  leftAction?: ActionDescriptor
  rightAction?: ActionDescriptor
  threshold?: number
}

export function SwipeActions({ children, leftAction, rightAction, threshold = 64 }: SwipeActionsProps) {
  const [dx, setDx] = useState(0)
  const drag = useRef<{ id: number; startX: number } | null>(null)
  const reduceMotion = useSettingsStore((s) => s.reduceMotion)

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { id: e.pointerId, startX: e.clientX }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return
    setDx(e.clientX - drag.current.startX)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return
    const finalDx = e.clientX - drag.current.startX
    drag.current = null
    if      (finalDx >=  threshold && leftAction)  leftAction.onTrigger()
    else if (finalDx <= -threshold && rightAction) rightAction.onTrigger()
    setDx(0)
  }

  return (
    <div
      style={{ position: 'relative', overflow: 'hidden', touchAction: 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {leftAction && dx > 0 && (
        <div style={{ position: 'absolute', inset: 0, background: leftAction.color, display: 'flex', alignItems: 'center', paddingLeft: 16 }}>
          <span style={{ color: '#fff', fontWeight: 600 }}>{leftAction.label}</span>
        </div>
      )}
      {rightAction && dx < 0 && (
        <div style={{ position: 'absolute', inset: 0, background: rightAction.color, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 16 }}>
          <span style={{ color: '#fff', fontWeight: 600 }}>{rightAction.label}</span>
        </div>
      )}
      <div style={{ transform: `translateX(${dx}px)`, transition: drag.current || reduceMotion ? 'none' : 'transform 200ms' }}>
        {children}
      </div>
    </div>
  )
}
