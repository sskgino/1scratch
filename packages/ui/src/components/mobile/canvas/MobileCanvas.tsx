import { CanvasHeader } from './CanvasHeader'
import { StackView } from './StackView'
import { SpatialView } from './SpatialView'
import { useWorkspaceStore } from '../../../store/workspace'
import { useEffectiveViewMode } from '../../../store/canvas'

export function MobileCanvas() {
  const sections = useWorkspaceStore((s) => s.sections)
  const activeSection = sections.find((s) => s.tabs.some((t) => t.id === s.activeTabId))
  const canvasId = activeSection?.activeTabId ?? ''
  const mode = useEffectiveViewMode(canvasId)

  const onRefresh = async () => {
    // PR 6 wires the real sync kick; for now, no-op delay so PullToRefresh resolves
    await new Promise((r) => setTimeout(r, 250))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <CanvasHeader />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {mode === 'stack' ? <StackView canvasId={canvasId} onRefresh={onRefresh} /> : <SpatialView />}
      </div>
    </div>
  )
}
