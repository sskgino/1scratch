export interface SyncDiagnosticsProps {
  outboxDepth: number
  lastError: string | null
  triggerNow: () => void | Promise<void>
}

export function SyncDiagnostics({ outboxDepth, lastError, triggerNow }: SyncDiagnosticsProps) {
  return (
    <section style={{ padding: 12 }}>
      <h3>Sync</h3>
      <div>Outbox depth: {outboxDepth}</div>
      <div>Last error: {lastError ?? '—'}</div>
      <button onClick={() => void triggerNow()}>Sync now</button>
    </section>
  )
}
