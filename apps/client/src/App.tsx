import Sidebar from '@1scratch/ui/components/layout/Sidebar'
import TabBar from '@1scratch/ui/components/layout/TabBar'
import Canvas from '@1scratch/ui/components/Canvas/Canvas'
import Toolbar from '@1scratch/ui/components/ui/Toolbar'
import { SyncProvider } from './sync/sync-provider'

// Workspace id is stable per install; server creates one-workspace-per-user lazily.
// For v1 the client uses a fixed placeholder until Clerk session wires the real id.
const PLACEHOLDER_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000'

export default function App() {
  return (
    <SyncProvider workspaceId={PLACEHOLDER_WORKSPACE_ID}>
      <div style={{ display: 'flex', width: '100%', height: '100%' }}>
        <Sidebar />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <TabBar />
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            <Canvas />
            <Toolbar />
          </div>
        </div>
      </div>
    </SyncProvider>
  )
}
