import type { HLC, Mutation, EntityType } from '@1scratch/sync-proto'
import type { Store } from './store'

type EntityReader = (
  entityType: EntityType,
  entityId: string,
) => Promise<Record<string, unknown> | null>

export interface DirtyTrackerOptions {
  store: Store
  hlc: HLC
  readEntity: EntityReader
  debounceMs?: number
  onError?: (e: Error) => void
}

interface DirtyKey {
  entityType: EntityType
  entityId: string
  op: 'upsert' | 'delete'
}

export class DirtyTracker {
  private dirty = new Map<string, DirtyKey>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false

  constructor(private readonly opts: DirtyTrackerOptions) {}

  start(): void { this.running = true }
  stop(): void {
    this.running = false
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  }

  markDirty(entityType: EntityType, entityId: string): void {
    if (!this.running) return
    this.dirty.set(key(entityType, entityId), { entityType, entityId, op: 'upsert' })
    this.schedule()
  }

  markDeleted(entityType: EntityType, entityId: string): void {
    if (!this.running) return
    this.dirty.set(key(entityType, entityId), { entityType, entityId, op: 'delete' })
    this.schedule()
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.opts.debounceMs ?? 500)
  }

  private async flush(): Promise<void> {
    const batch = [...this.dirty.values()]
    this.dirty.clear()
    for (const key of batch) {
      try {
        const mutation = await this.buildMutation(key)
        if (mutation) await this.opts.store.enqueue(mutation)
      } catch (e) {
        this.opts.onError?.(e instanceof Error ? e : new Error(String(e)))
      }
    }
  }

  private async buildMutation(k: DirtyKey): Promise<Mutation | null> {
    const clientVersion = this.opts.hlc.now().toString()
    if (k.op === 'delete') {
      return {
        id: nanoid(),
        entityType: k.entityType,
        entityId: k.entityId,
        op: 'delete',
        patch: {},
        clientVersion,
      }
    }
    const current = await this.opts.readEntity(k.entityType, k.entityId)
    if (!current) return null
    const prev = await this.opts.store.getFlushSnapshot(k.entityType, k.entityId)
    const patch = diffPatch(prev, current, k.entityType)
    if (Object.keys(patch).length === 0) return null
    await this.opts.store.setFlushSnapshot(k.entityType, k.entityId, current)
    return {
      id: nanoid(),
      entityType: k.entityType,
      entityId: k.entityId,
      op: 'upsert',
      patch,
      clientVersion,
    }
  }
}

function key(et: EntityType, id: string): string { return `${et}:${id}` }

function diffPatch(
  prev: Record<string, unknown> | null,
  next: Record<string, unknown>,
  entityType: EntityType,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (prev === null) {
    for (const [k, v] of Object.entries(next)) {
      if (k === 'id') continue
      out[k] = v
    }
    if (entityType === 'card') scrubStreamingResponse(out)
    return out
  }
  for (const [k, v] of Object.entries(next)) {
    if (k === 'id') continue
    if (!deepEqual(prev[k], v)) out[k] = v
  }
  if (entityType === 'card') scrubStreamingResponse(out)
  return out
}

function scrubStreamingResponse(patch: Record<string, unknown>): void {
  const payload = patch.payload as Record<string, unknown> | undefined
  if (payload && payload.status === 'streaming' && 'response' in payload) {
    const { response: _drop, ...rest } = payload
    patch.payload = rest
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  return JSON.stringify(a) === JSON.stringify(b)
}

// Minimal nanoid — engine should not depend on nanoid pkg; this is fine for v1.
function nanoid(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
