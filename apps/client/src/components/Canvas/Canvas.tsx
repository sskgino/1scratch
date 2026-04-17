import { useRef, useCallback, useEffect } from 'react'
import CanvasGrid from './CanvasGrid'
import CardLayer from './CardLayer'
import { useCanvasStore } from '../../store/canvas'
import { useCardsStore } from '../../store/cards'
import { makeCard } from '../../lib/cardFactory'

export default function Canvas() {
  const { panX, panY, zoom, setPan, setZoom } = useCanvasStore()
  const { addCard } = useCardsStore()

  const isPanning = useRef(false)
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const isSpaceDown = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

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
        addCard(makeCard(pos.x - TEXTAREA_PAD, pos.y - TEXTAREA_PAD))
      }
    },
    [panX, panY, screenToCanvas, addCard],
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
