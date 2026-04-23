import { useCardsStore } from '../../store/cards'
import { useCanvasStore } from '../../store/canvas'
import { serializeCanvas, deserializeCanvas } from '../../lib/persistence'
import { nanoid } from 'nanoid'

const canvasId = nanoid()

export default function Toolbar() {
  const handleSave = () => {
    const { cards } = useCardsStore.getState()
    const { panX, panY, zoom } = useCanvasStore.getState()
    const state = serializeCanvas(cards, { panX, panY, zoom }, 'canvas', canvasId)
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'canvas.scratch'
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleLoad = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.scratch,.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const state = deserializeCanvas(ev.target?.result as string)
          useCardsStore.getState().loadCards(state.cards)
          useCanvasStore.getState().loadViewport(state.viewport)
        } catch {
          alert('Could not load file.')
        }
      }
      reader.readAsText(file)
    }
    input.click()
  }

  const handleNew = () => {
    if (Object.keys(useCardsStore.getState().cards).length > 0) {
      if (!confirm('Clear canvas?')) return
    }
    useCardsStore.getState().clearAll()
    useCanvasStore.getState().resetViewport()
  }

  return (
    <div style={{
      position: 'absolute',
      top: 12,
      right: 14,
      display: 'flex',
      gap: 6,
      zIndex: 1000,
    }}>
      <Btn onClick={handleNew} title="New canvas">New</Btn>
      <Btn onClick={handleSave} title="Save">Save</Btn>
      <Btn onClick={handleLoad} title="Load">Load</Btn>
    </div>
  )
}

function Btn({ onClick, title, children }: {
  onClick: () => void; title?: string; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        background: 'rgba(255,255,255,0.85)',
        border: '1px solid rgba(0,0,0,0.12)',
        borderRadius: 6,
        color: '#333',
        fontSize: 12,
        padding: '4px 10px',
        cursor: 'pointer',
        fontFamily: 'system-ui',
        backdropFilter: 'blur(4px)',
      }}
    >
      {children}
    </button>
  )
}
