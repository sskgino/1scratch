import { useCanvasStore } from '../../store/canvas'

export default function CanvasGrid() {
  const { panX, panY, zoom } = useCanvasStore()

  const dotSize = 1.5
  const spacing = 28 * zoom
  // offset the grid so dots feel anchored to canvas space
  const offsetX = ((panX % spacing) + spacing) % spacing
  const offsetY = ((panY % spacing) + spacing) % spacing

  return (
    <svg
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
    >
      <defs>
        <pattern
          id="dot-grid"
          x={offsetX}
          y={offsetY}
          width={spacing}
          height={spacing}
          patternUnits="userSpaceOnUse"
        >
          <circle cx={dotSize} cy={dotSize} r={dotSize / 2} fill="#d0d0d0" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#dot-grid)" />
    </svg>
  )
}
