'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

function buildDesktopReturnUrl(query: string): string {
  const target = new URL('1scratch://auth/done')
  const params = new URLSearchParams(query)
  for (const [key, value] of params) target.searchParams.set(key, value)
  return target.toString()
}

export default function AuthDoneBridgeClient() {
  const searchParams = useSearchParams()
  const query = searchParams.toString()
  const desktopUrl = useMemo(() => buildDesktopReturnUrl(query), [query])
  const [showFallback, setShowFallback] = useState(false)

  useEffect(() => {
    if (!searchParams.get('access') || !searchParams.get('refresh')) {
      setShowFallback(true)
      return
    }

    const iframe = document.createElement('iframe')
    iframe.style.display = 'none'
    iframe.src = desktopUrl
    document.body.appendChild(iframe)

    const timer = window.setTimeout(() => {
      setShowFallback(true)
    }, 1200)

    return () => {
      window.clearTimeout(timer)
      iframe.remove()
    }
  }, [desktopUrl, searchParams])

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        background: '#f6f7fb',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#ffffff',
          border: '1px solid #d9deea',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 20px 60px rgba(15, 23, 42, 0.08)',
        }}
      >
        <h1 style={{ margin: 0, fontSize: 24, lineHeight: 1.2 }}>Returning to the app…</h1>
        <p style={{ margin: '12px 0 0', color: '#475569', lineHeight: 1.6 }}>
          Your sign-in completed. If Scratch does not reopen automatically, use the fallback below.
        </p>
        {showFallback ? (
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 20 }}>
            <a
              href={desktopUrl}
              style={{
                background: '#0f172a',
                color: '#fff',
                padding: '10px 14px',
                borderRadius: 10,
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Open Scratch
            </a>
            <Link
              href="/app"
              style={{
                color: '#0f172a',
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid #cbd5e1',
                textDecoration: 'none',
                fontWeight: 600,
              }}
            >
              Open Web App
            </Link>
          </div>
        ) : null}
      </div>
    </main>
  )
}
