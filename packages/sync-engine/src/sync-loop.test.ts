import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SyncLoop } from './sync-loop'
import { FakeStore } from './fake-store'
import type { PushRequest, PullResponse, PushResponse } from '@1scratch/sync-proto'

interface FakeHttp {
  push: (body: PushRequest) => Promise<PushResponse>
  pull: (since: string, limit: number) => Promise<PullResponse>
}

function makeHttp(overrides: Partial<FakeHttp> = {}): FakeHttp {
  return {
    push: overrides.push ?? (async () => ({ accepted: [], rejected: [], serverVersion: '0', additional: [] })),
    pull: overrides.pull ?? (async () => ({ mutations: [], serverVersion: '0', more: false })),
  }
}

describe('SyncLoop', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('pushes queued mutations on triggerNow', async () => {
    const store = new FakeStore()
    await store.enqueue({ id: 'a', entityType: 'card', entityId: 'x', op: 'upsert', patch: {}, clientVersion: '1' })
    const pushSpy = vi.fn(async () => ({ accepted: ['a'], rejected: [], serverVersion: '10', additional: [] }))
    const loop = new SyncLoop({
      store,
      http: makeHttp({ push: pushSpy }),
      deviceId: 'd',
      ownDeviceWorkspaceId: () => 'w',
      pollIntervalMs: 30_000,
    })
    loop.start()
    await loop.triggerNow()
    expect(pushSpy).toHaveBeenCalledOnce()
    expect(store.outbox).toHaveLength(0)
  })

  it('only one push in-flight at a time (concurrency guard)', async () => {
    const store = new FakeStore()
    await store.enqueue({ id: 'a', entityType: 'card', entityId: 'x', op: 'upsert', patch: {}, clientVersion: '1' })
    let resolveFirst!: (v: PushResponse) => void
    const pushSpy = vi.fn(() => new Promise<PushResponse>((r) => { resolveFirst = r }))
    const loop = new SyncLoop({
      store, http: makeHttp({ push: pushSpy }), deviceId: 'd',
      ownDeviceWorkspaceId: () => 'w', pollIntervalMs: 30_000,
    })
    loop.start()
    const p1 = loop.triggerNow()
    const p2 = loop.triggerNow()
    await vi.waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(1))
    resolveFirst({ accepted: ['a'], rejected: [], serverVersion: '1', additional: [] })
    await Promise.all([p1, p2])
  })

  it('exponential backoff on server_error', async () => {
    const store = new FakeStore()
    await store.enqueue({ id: 'a', entityType: 'card', entityId: 'x', op: 'upsert', patch: {}, clientVersion: '1' })
    const pushSpy = vi.fn(() => Promise.reject(Object.assign(new Error(), { kind: 'server_error', status: 500, body: '' })))
    const loop = new SyncLoop({
      store, http: makeHttp({ push: pushSpy }), deviceId: 'd',
      ownDeviceWorkspaceId: () => 'w', pollIntervalMs: 60_000,
    })
    loop.start()
    await loop.triggerNow().catch(() => {})
    expect(loop.backoffMs).toBe(1000)
    await loop.triggerNow().catch(() => {})
    expect(loop.backoffMs).toBe(2000)
  })

  it('persists retry_count on transport failure', async () => {
    const store = new FakeStore()
    await store.enqueue({ id: 'a', entityType: 'card', entityId: 'x', op: 'upsert', patch: {}, clientVersion: '1' })
    await store.enqueue({ id: 'b', entityType: 'card', entityId: 'y', op: 'upsert', patch: {}, clientVersion: '2' })
    const pushSpy = vi.fn(() => Promise.reject(new Error('boom')))
    const loop = new SyncLoop({
      store, http: makeHttp({ push: pushSpy }), deviceId: 'd',
      ownDeviceWorkspaceId: () => 'w', pollIntervalMs: 60_000,
    })
    await loop.triggerNow().catch(() => {})
    expect(store.outboxFailures.get('a')).toEqual({ count: 1, lastError: 'boom' })
    expect(store.outboxFailures.get('b')).toEqual({ count: 1, lastError: 'boom' })
    await loop.triggerNow().catch(() => {})
    expect(store.outboxFailures.get('a')?.count).toBe(2)
  })

  it('emits onConflicts for stale rejections + persists per-id failure', async () => {
    const store = new FakeStore()
    await store.enqueue({ id: 'a', entityType: 'card', entityId: 'card-1', op: 'upsert', patch: {}, clientVersion: '1' })
    await store.enqueue({ id: 'b', entityType: 'card', entityId: 'card-2', op: 'upsert', patch: {}, clientVersion: '2' })
    const pushSpy = vi.fn(async () => ({
      accepted: ['b'],
      rejected: [{ id: 'a', reason: 'stale' as const }],
      serverVersion: '5', additional: [],
    }))
    const conflictsSpy = vi.fn()
    const loop = new SyncLoop({
      store, http: makeHttp({ push: pushSpy }), deviceId: 'd',
      ownDeviceWorkspaceId: () => 'w', pollIntervalMs: 60_000,
      onConflicts: conflictsSpy,
    })
    await loop.triggerNow()
    expect(conflictsSpy).toHaveBeenCalledWith('card', ['card-1'])
    expect(store.outboxFailures.get('a')).toEqual({ count: 1, lastError: 'stale' })
    expect(store.outbox.map((m) => m.id)).toEqual(['a'])
  })
})
