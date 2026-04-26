import { CanvasHeader } from './CanvasHeader'
import { StackView } from './StackView'
import { SpatialView } from './SpatialView'
import { useWorkspaceStore } from '../../../store/workspace'
import { useEffectiveViewMode } from '../../../store/canvas'

export interface MobileCanvasProps {
  onRefresh?: () => void | Promise<void>
}

export function MobileCanvas({ onRefresh }: MobileCanvasProps = {}) {
  const sections = useWorkspaceStore((s) => s.sections)
  const activeSection = sections.find((s) => s.tabs.some((t) => t.id === s.activeTabId))
  const canvasId = activeSection?.activeTabId ?? ''
  const mode = useEffectiveViewMode(canvasId)

  const refresh = async () => { await onRefresh?.() }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <CanvasHeader />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {mode === 'stack' ? <StackView canvasId={canvasId} onRefresh={refresh} /> : <SpatialView />}
      </div>
    </div>
  )
}
