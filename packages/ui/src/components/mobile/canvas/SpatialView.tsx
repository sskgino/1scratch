import Canvas from '../../Canvas/Canvas'

export function SpatialView() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', touchAction: 'none' }}>
      <Canvas />
    </div>
  )
}
