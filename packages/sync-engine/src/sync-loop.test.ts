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
})
