import { useEffect, useState } from 'react'
import Sidebar from '@1scratch/ui/components/layout/Sidebar'
import TabBar from '@1scratch/ui/components/layout/TabBar'
import Canvas from '@1scratch/ui/components/Canvas/Canvas'
import Toolbar from '@1scratch/ui/components/ui/Toolbar'
import { SyncProvider } from './sync/sync-provider'
import { getAuthToken, signInInteractive } from './sync/auth-token'

const PLACEHOLDER_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000'

function Shell() {
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

export default function App() {
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(true)
  useEffect(() => {
    getAuthToken()
      .then(() => { setSignedIn(true); setBusy(false) })
      .catch(() => setBusy(false))
  }, [])
  if (busy) return <p style={{ padding: 24 }}>Loading…</p>
  if (!signedIn) {
    return (
      <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <button onClick={async () => { await signInInteractive(); setSignedIn(true) }}>
          Sign in
        </button>
      </main>
    )
  }
  return <Shell />
}
