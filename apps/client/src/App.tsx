import { useEffect, useState } from 'react'
import Sidebar from '@1scratch/ui/components/layout/Sidebar'
import TabBar from '@1scratch/ui/components/layout/TabBar'
import Canvas from '@1scratch/ui/components/Canvas/Canvas'
import Toolbar from '@1scratch/ui/components/ui/Toolbar'
import { SyncProvider } from './sync/sync-provider'
import { signOut } from '@1scratch/ui/auth/session'
import { apiBaseUrl, clearAuthCache, getAuthToken, signInInteractive } from './sync/auth-token'

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
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    getAuthToken()
      .then(() => { setSignedIn(true); setBusy(false) })
      .catch(() => setBusy(false))
  }, [])
  if (busy) return <p style={{ padding: 24 }}>Loading…</p>
  if (!signedIn) {
    return (
      <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
          <button
            style={{
              padding: '14px 28px',
              fontSize: 18,
              fontWeight: 600,
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              minWidth: 200,
            }}
            onClick={async () => {
              setErr(null)
              try {
                await signInInteractive()
                setSignedIn(true)
              } catch (e) {
                setErr(String((e as Error)?.message ?? e))
              }
            }}
          >
            Sign in
          </button>
          {err ? <pre style={{ color: '#b91c1c', whiteSpace: 'pre-wrap', maxWidth: 360 }}>{err}</pre> : null}
        </div>
      </main>
    )
  }
  return (
    <>
      <button
        style={{
          position: 'fixed',
          top: 8,
          right: 8,
          zIndex: 9999,
          padding: '6px 10px',
          fontSize: 12,
        }}
        onClick={async () => {
          try {
            await signOut({ apiBase: apiBaseUrl() })
          } finally {
            clearAuthCache()
            setSignedIn(false)
          }
        }}
      >
        Sign out
      </button>
      <Shell />
    </>
  )
}
