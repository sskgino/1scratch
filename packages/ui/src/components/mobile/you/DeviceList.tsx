import { useEffect, useState } from 'react'

interface DeviceSession {
  id: string
  device_label: string | null
  last_used_at: string
  current: boolean
}

async function fetchSessions(): Promise<DeviceSession[]> {
  const apiBase = (globalThis as unknown as { API_BASE_URL?: string }).API_BASE_URL ?? ''
  const res = await fetch(`${apiBase}/api/mobile/sessions`)
  if (!res.ok) return []
  return await res.json()
}

async function revoke(id: string): Promise<void> {
  const apiBase = (globalThis as unknown as { API_BASE_URL?: string }).API_BASE_URL ?? ''
  await fetch(`${apiBase}/api/mobile/revoke`, { method: 'POST', body: JSON.stringify({ id }) })
}

export function DeviceList() {
  const [list, setList] = useState<DeviceSession[]>([])
  useEffect(() => { fetchSessions().then(setList) }, [])
  return (
    <div>
      {list.map((s) => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15 }}>{s.device_label ?? 'Unknown device'}{s.current ? ' (this device)' : ''}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{new Date(s.last_used_at).toLocaleString()}</div>
          </div>
          {!s.current && (
            <button onClick={async () => { await revoke(s.id); setList((l) => l.filter((x) => x.id !== s.id)) }}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, background: '#fff' }}>
              Sign out
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
