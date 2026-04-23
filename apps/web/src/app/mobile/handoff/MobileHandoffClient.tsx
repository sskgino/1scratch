'use client'

import { useEffect, useState } from 'react'

interface Props {
  returnUrl: string
  deviceId: string | null
  deviceLabel: string | null
}

export default function MobileHandoffClient({ returnUrl, deviceId, deviceLabel }: Props) {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const effectiveDeviceId =
      deviceId ??
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `web-${Date.now()}`)
    const effectiveDeviceLabel = deviceLabel ?? navigator.userAgent.slice(0, 120)
    void (async () => {
      const res = await fetch('/api/mobile/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_id: effectiveDeviceId, device_label: effectiveDeviceLabel }),
      })
      if (!res.ok) {
        setError(`Exchange failed (${res.status})`)
        return
      }
      const body = (await res.json()) as {
        access_jwt: string
        refresh_token: string
        access_exp: number
      }
      const target = new URL(returnUrl)
      target.searchParams.set('access', body.access_jwt)
      target.searchParams.set('refresh', body.refresh_token)
      target.searchParams.set('exp', String(body.access_exp))
      window.location.replace(target.toString())
    })()
  }, [returnUrl, deviceId, deviceLabel])
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
      {error ? <p style={{ color: '#b00' }}>{error}</p> : <p>Returning to the app…</p>}
    </main>
  )
}
