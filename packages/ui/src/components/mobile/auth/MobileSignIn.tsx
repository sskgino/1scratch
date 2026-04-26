import { useState } from 'react'
import { SafeArea } from '../shared/SafeArea'

export interface MobileSignInProps {
  onSignedIn: () => void
  signIn: () => Promise<void>
}

export function MobileSignIn({ onSignedIn, signIn }: MobileSignInProps) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const go = async () => {
    setBusy(true); setErr(null)
    try {
      await signIn()
      onSignedIn()
    } catch {
      setErr('Sign-in interrupted, try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SafeArea
      edges={['top', 'bottom']}
      style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: 24,
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>1Scratch</h1>
      <p style={{ color: '#666', marginTop: 8, textAlign: 'center' }}>
        Capture, think, build — across every device.
      </p>
      <button
        onClick={go}
        disabled={busy}
        style={{
          marginTop: 32, padding: '14px 24px', fontSize: 16, borderRadius: 12,
          background: '#222', color: '#fff', border: 0,
        }}
      >
        {busy ? 'Opening browser…' : 'Continue with browser'}
      </button>
      {err && <p style={{ color: '#a33', marginTop: 12 }}>{err}</p>}
    </SafeArea>
  )
}
