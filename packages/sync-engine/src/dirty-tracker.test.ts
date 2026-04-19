import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { DirtyTracker } from './dirty-tracker'
import { FakeStore } from './fake-store'
import { HLC } from '@1scratch/sync-proto'

describe('DirtyTracker', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('produces an upsert mutation on flush after marking a card dirty', async () => {
    const store = new FakeStore()
    const hlc = new HLC()
    const tracker = new DirtyTracker({
      store,
      hlc,
      readEntity: async (et, id) => {
        if (et === 'card' && id === 'c1') return { id: 'c1', x: 10, y: 20, payload: { status: 'idle' } }
        return null
      },
      debounceMs: 500,
    })
    tracker.start()
    tracker.markDirty('card', 'c1')
    expect(store.outbox).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(store.outbox).toHaveLength(1)
    expect(store.outbox[0]!.entityType).toBe('card')
    expect(store.outbox[0]!.op).toBe('upsert')
    expect(store.outbox[0]!.patch).toMatchObject({ x: 10, y: 20 })
  })

  it('coalesces rapid successive marks into a single mutation', async () => {
    const store = new FakeStore()
    const tracker = new DirtyTracker({
      store, hlc: new HLC(),
      readEntity: async () => ({ id: 'c1', x: 1 }),
      debounceMs: 500,
    })
    tracker.start()
    tracker.markDirty('card', 'c1')
    await vi.advanceTimersByTimeAsync(100)
    tracker.markDirty('card', 'c1')
    await vi.advanceTimersByTimeAsync(100)
    tracker.markDirty('card', 'c1')
    await vi.advanceTimersByTimeAsync(500)
    expect(store.outbox).toHaveLength(1)
  })

  it('suppresses payload.response while status === streaming', async () => {
    const store = new FakeStore()
    const tracker = new DirtyTracker({
      store, hlc: new HLC(),
      readEntity: async () => ({ id: 'c1', payload: { status: 'streaming', response: 'partial' } }),
      debounceMs: 500,
    })
    tracker.start()
    tracker.markDirty('card', 'c1')
    await vi.advanceTimersByTimeAsync(500)
    // First flush sets snapshot; no response leakage
    const patch = store.outbox[0]!.patch as { payload?: Record<string, unknown> }
    expect(patch.payload?.response).toBeUndefined()
  })

  it('emits a delete mutation via markDeleted', async () => {
    const store = new FakeStore()
    const tracker = new DirtyTracker({
      store, hlc: new HLC(),
      readEntity: async () => null,
      debounceMs: 500,
    })
    tracker.start()
    tracker.markDeleted('card', 'c1')
    await vi.advanceTimersByTimeAsync(500)
    expect(store.outbox[0]!.op).toBe('delete')
  })
})
