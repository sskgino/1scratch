import { describe, it, expect } from 'vitest'
import type { ServerMutation } from '@1scratch/sync-proto'
import { Reconciler } from './reconciler'
import { FakeStore } from './fake-store'

const srv = (o: Partial<ServerMutation> & Pick<ServerMutation, 'id' | 'entityId' | 'version' | 'deviceId'>): ServerMutation => ({
  entityType: 'card',
  op: 'upsert',
  patch: {},
  createdAt: new Date().toISOString(),
  ...o,
})

describe('Reconciler', () => {
  it('applies card upsert to store', async () => {
    const store = new FakeStore()
    const r = new Reconciler({ store, ownDeviceId: 'me', workspaceIdResolver: () => 'w' })
    await r.apply([srv({
      id: 'm1', entityId: 'c1', version: '100', deviceId: 'other',
      op: 'upsert', entityType: 'card',
      patch: { canvasId: 'cv1', x: 5, y: 6, width: 100, height: 100, zIndex: 0, payload: {} },
    })])
    expect(store.cards.get('c1')?.x).toBe(5)
  })

  it('skips echoes from own device', async () => {
    const store = new FakeStore()
    const r = new Reconciler({ store, ownDeviceId: 'me', workspaceIdResolver: () => 'w' })
    await r.apply([srv({
      id: 'm1', entityId: 'c1', version: '100', deviceId: 'me',
      patch: { canvasId: 'cv', x: 1, y: 1, width: 1, height: 1, zIndex: 0, payload: {} },
    })])
    expect(store.cards.size).toBe(0)
  })

  it('does not downgrade a card with a newer local version (LWW)', async () => {
    const store = new FakeStore()
    await store.upsertCard({
      id: 'c1', workspaceId: 'w', canvasId: 'cv',
      x: 999, y: 0, width: 1, height: 1, zIndex: 0,
      payload: {}, version: '500', deletedAt: null,
    })
    const r = new Reconciler({ store, ownDeviceId: 'me', workspaceIdResolver: () => 'w' })
    await r.apply([srv({
      id: 'm1', entityId: 'c1', version: '100', deviceId: 'other',
      patch: { x: 1 },
    })])
    expect(store.cards.get('c1')?.x).toBe(999)
  })

  it('applies card delete as soft-delete', async () => {
    const store = new FakeStore()
    await store.upsertCard({
      id: 'c1', workspaceId: 'w', canvasId: 'cv',
      x: 0, y: 0, width: 1, height: 1, zIndex: 0,
      payload: {}, version: '100', deletedAt: null,
    })
    const r = new Reconciler({ store, ownDeviceId: 'me', workspaceIdResolver: () => 'w' })
    await r.apply([srv({
      id: 'm1', entityId: 'c1', version: '200', deviceId: 'other', op: 'delete',
    })])
    expect(store.cards.get('c1')?.deletedAt).not.toBeNull()
  })
})
