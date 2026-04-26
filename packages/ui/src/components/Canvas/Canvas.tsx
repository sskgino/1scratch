import { useRef, useCallback, useEffect } from 'react'
import CanvasGrid from './CanvasGrid'
import CardLayer from './CardLayer'
import { useCanvasStore } from '../../store/canvas'
import { useCardsStore } from '../../store/cards'
import { useWorkspaceStore } from '../../store/workspace'
import { makeCard } from '../../lib/cardFactory'

export default function Canvas() {
  const { panX, panY, zoom, setPan, setZoom } = useCanvasStore()
  const { addCard } = useCardsStore()
  const activeCanvasId = useWorkspaceStore((s) => {
    const sec = s.sections.find((x) => x.id === s.activeSectionId)
    return sec?.activeTabId ?? ''
  })

  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const isSpaceDown = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Touch pinch-zoom + two-finger pan (mobile)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const lastPinch = useRef<{ d: number; cx: number; cy: number } | null>(null)
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.hypot(a.x - b.x, a.y - b.y)

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      lastPinch.current = { d: dist(a!, b!), cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2 }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2 && lastPinch.current) {
      const [a, b] = [...pointers.current.values()]
      const d = dist(a!, b!)
      const cx = (a!.x + b!.x) / 2, cy = (a!.y + b!.y) / 2
      const zoomDelta = d / lastPinch.current.d
      const cur = useCanvasStore.getState()
      const newZoom = Math.max(0.5, Math.min(2.5, cur.zoom * zoomDelta))
      useCanvasStore.setState({
        zoom: newZoom,
        panX: cur.panX + (cx - lastPinch.current.cx),
        panY: cur.panY + (cy - lastPinch.current.cy),
      })
      lastPinch.current = { d, cx, cy }
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) lastPinch.current = null
  }

  // Convert screen coords to canvas coords
  const screenToCanvas = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - panX) / zoom,
      y: (sy - panY) / zoom,
    }),
    [panX, panY, zoom],
  )

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Middle mouse or space+left = pan
      if (e.button === 1 || (e.button === 0 && isSpaceDown.current)) {
        e.preventDefault()
        isPanning.current = true
        panStart.current = { x: e.clientX, y: e.clientY, panX, panY }
        return
      }

      // Left click on canvas background = create prompt card.
      // Offset by the textarea's inner padding so the text caret lands
      // exactly under the click point.
      if (e.button === 0 && e.target === containerRef.current) {
        const pos = screenToCanvas(e.clientX, e.clientY)
        const TEXTAREA_PAD = 5
        addCard(makeCard(activeCanvasId, pos.x - TEXTAREA_PAD, pos.y - TEXTAREA_PAD))
      }
    },
    [panX, panY, screenToCanvas, addCard, activeCanvasId],
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isPanning.current) return
      const dx = e.clientX - panStart.current.x
      const dy = e.clientY - panStart.current.y
      setPan(panStart.current.panX + dx, panStart.current.panY + dy)
    },
    [setPan],
  )

  const handleMouseUp = useCallback(() => {
    isPanning.current = false
  }, [])

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey || e.metaKey) {
        const delta = -e.deltaY * 0.001
        setZoom(zoom * (1 + delta), e.clientX, e.clientY)
      } else {
        setPan(panX - e.deltaX, panY - e.deltaY)
      }
    },
    [zoom, panX, panY, setZoom, setPan],
  )

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.code === 'Space' && !(e.target instanceof HTMLTextAreaElement) && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault()
      isSpaceDown.current = true
    }
  }, [])

  const handleKeyUp = useCallback((e: KeyboardEvent) => {
    if (e.code === 'Space') {
      isSpaceDown.current = false
    }
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    el.addEventListener('wheel', handleWheel, { passive: false })

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      el.removeEventListener('wheel', handleWheel)
    }
  }, [handleMouseMove, handleMouseUp, handleKeyDown, handleKeyUp, handleWheel])

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        cursor: isPanning.current ? 'grabbing' : isSpaceDown.current ? 'grab' : 'crosshair',
        background: '#fafafa',
      }}
    >
      <CanvasGrid />

      {/* Transform layer */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
      >
        <CardLayer />
      </div>

      {/* Hint */}
      <div style={{
        position: 'absolute',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: 11,
        color: 'rgba(0,0,0,0.2)',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        fontFamily: 'system-ui',
      }}>
        Click to write · Enter to send · Shift+Enter for newline · Ctrl+scroll to zoom
      </div>
    </div>
  )
}
