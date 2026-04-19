import { useSync } from '../sync/sync-provider'

export function SyncDiagnostics() {
  const { outboxDepth, lastError, triggerNow } = useSync()
  return (
    <section style={{ padding: 12 }}>
      <h3>Sync</h3>
      <div>Outbox depth: {outboxDepth}</div>
      <div>Last error: {lastError ?? '—'}</div>
      <button onClick={() => void triggerNow()}>Sync now</button>
    </section>
  )
}
