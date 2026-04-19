// Public landing for the email-delivered confirm link.
// Runs client-side so the token never hits server logs as part of a GET.

'use client'

import { useEffect, useState } from 'react'

export default function DeleteConfirmPage() {
  const [status, setStatus] = useState<'idle' | 'confirming' | 'ok' | 'error'>('idle')
  const [executesAfter, setExecutesAfter] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setToken(params.get('token'))
  }, [])

  async function confirm() {
    if (!token) return
    setStatus('confirming')
    const res = await fetch('/api/account/delete-confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const j = (await res.json().catch(() => ({}))) as {
      error?: string
      executesAfter?: string
    }
    if (!res.ok) {
      setErrorCode(j.error ?? 'unknown')
      setStatus('error')
      return
    }
    setExecutesAfter(j.executesAfter ?? null)
    setStatus('ok')
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <section className="max-w-md w-full">
        <h1 className="text-2xl mb-4" style={{ fontFamily: 'var(--font-fraunces)' }}>
          Confirm account deletion
        </h1>
        {!token && <p>Missing token. Request a new link from Settings.</p>}
        {token && status === 'idle' && (
          <>
            <p className="mb-4 text-sm opacity-80">
              Clicking confirm starts a <strong>24-hour</strong> cool-off. You can cancel any time
              during that window from Settings. After the window closes, your account and all data
              are permanently deleted.
            </p>
            <button
              type="button"
              onClick={confirm}
              className="px-6 py-3 text-xs uppercase tracking-[0.06em]"
              style={{ background: 'var(--ink)', color: 'var(--paper)' }}
            >
              Confirm deletion
            </button>
          </>
        )}
        {status === 'confirming' && <p>Confirming…</p>}
        {status === 'ok' && (
          <div>
            <p className="mb-2">Confirmed. Cool-off ends:</p>
            <p className="font-mono text-sm">{executesAfter}</p>
            <p className="mt-4 text-sm opacity-80">
              Cancel from <a className="underline" href="/app/settings">Settings</a> any time before
              then.
            </p>
          </div>
        )}
        {status === 'error' && (
          <div>
            <p>Could not confirm ({errorCode}). The token may be expired, already used, or
              cancelled.</p>
          </div>
        )}
      </section>
    </main>
  )
}
