import { useEffect, useState } from 'react'
import Sidebar from '@1scratch/ui/components/layout/Sidebar'
import TabBar from '@1scratch/ui/components/layout/TabBar'
import Canvas from '@1scratch/ui/components/Canvas/Canvas'
import Toolbar from '@1scratch/ui/components/ui/Toolbar'
import { SyncProvider } from './sync/sync-provider'
import { MobileShell, useViewport } from '@1scratch/ui'
import { signOut } from '@1scratch/ui/auth/session'
import { getColdStartUrl, listenForAuthCallback } from '@1scratch/ui/auth/deep-link'
import { secureStore } from '@1scratch/ui/secure-store'
import { apiBaseUrl, clearAuthCache, getAuthToken, signInInteractive } from './sync/auth-token'

const PLACEHOLDER_WORKSPACE_ID = '00000000-0000-0000-0000-000000000000'

// Module-level lock so React strict mode / Vite HMR remounts can't replay
// the cold-start URL — it's the same URL each time, but its refresh token
// has been rotated server-side after the first consume, and a re-save would
// overwrite the rotated token with the now-revoked original.
let coldStartConsumed = false
const consumedDeepLinks = new Set<string>()

function Shell() {
  return (
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
  )
}

function ResponsiveShell() {
  const { isMobile } = useViewport()
  return (
    <>
      <div hidden={isMobile} style={{ height: '100%' }}><Shell /></div>
      <div hidden={!isMobile} style={{ height: '100%' }}><MobileShell /></div>
    </>
  )
}

export default function App() {
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  useEffect(() => {
    let active = true
    const consume = async (u: URL) => {
      const key = u.toString()
      if (consumedDeepLinks.has(key)) return
      consumedDeepLinks.add(key)
      const r = u.searchParams.get('refresh')
      if (r) await secureStore.set('refresh', r)
      clearAuthCache()
      try {
        await getAuthToken()
        if (active) setSignedIn(true)
      } catch {
        // fall through
      }
    }
    const stop = listenForAuthCallback((u) => { void consume(u).then(() => { if (active) setPending(false) }) })
    void (async () => {
      if (!coldStartConsumed) {
        coldStartConsumed = true
        const cold = await getColdStartUrl()
        if (cold) await consume(cold)
      }
      try {
        await getAuthToken()
        if (active) setSignedIn(true)
      } catch {
        // not signed in
      }
      if (active) setBusy(false)
    })()
    return () => { active = false; stop() }
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
              setPending(true)
              try {
                await signInInteractive()
                // signedIn flips when the deep-link listener consumes the
                // callback URL. Don't set it here — that would create a
                // second writer racing the listener.
              } catch (e) {
                setErr(String((e as Error)?.message ?? e))
                setPending(false)
              }
            }}
          >
            {pending ? 'Signing in…' : 'Sign in'}
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
          top: 'max(env(safe-area-inset-top, 0px), 64px)',
          right: 12,
          zIndex: 9999,
          padding: '10px 16px',
          fontSize: 14,
          background: '#dc2626',
          color: '#fff',
          border: 'none',
          borderRadius: 8,
          fontWeight: 600,
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
      <SyncProvider workspaceId={PLACEHOLDER_WORKSPACE_ID}>
        <ResponsiveShell />
      </SyncProvider>
    </>
  )
}
