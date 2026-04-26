import { useRef, useState, type ReactNode } from 'react'

export interface PullToRefreshProps {
  children: ReactNode
  onRefresh: () => Promise<void>
  threshold?: number
}

export function PullToRefresh({ children, onRefresh, threshold = 60 }: PullToRefreshProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: number; startY: number } | null>(null)
  const [dy, setDy] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [pill, setPill] = useState<string | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if ((wrapRef.current?.scrollTop ?? 0) > 0) return
    drag.current = { id: e.pointerId, startY: e.clientY }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return
    const v = e.clientY - drag.current.startY
    if (v < 0) return
    setDy(v)
  }
  const onPointerUp = async (e: React.PointerEvent) => {
    if (!drag.current) return
    const finalDy = e.clientY - drag.current.startY
    drag.current = null
    if (finalDy >= threshold && !refreshing) {
      setRefreshing(true)
      try {
        await onRefresh()
        setPill(`Synced just now`)
        setTimeout(() => setPill(null), 1500)
      } finally {
        setRefreshing(false)
        setDy(0)
      }
    } else {
      setDy(0)
    }
  }

  return (
    <div
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ position: 'relative', overflowY: 'auto', height: '100%' }}
    >
      <div style={{ height: dy, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
        {refreshing ? '⟳ Syncing…' : dy >= threshold ? 'Release to sync' : dy > 0 ? 'Pull to sync' : ''}
      </div>
      {pill && (
        <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', background: '#222', color: '#fff', borderRadius: 12, padding: '4px 12px', fontSize: 13 }}>
          {pill}
        </div>
      )}
      <div>
        {children}
      </div>
    </div>
  )
}
