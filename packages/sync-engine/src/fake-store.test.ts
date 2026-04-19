import { describe, it, expect } from 'vitest'
import { FakeStore } from './fake-store'

describe('FakeStore', () => {
  it('upserts + lists cards scoped by workspace', async () => {
    const s = new FakeStore()
    await s.upsertCard({
      id: 'c1', workspaceId: 'w', canvasId: 'cv',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1,
      payload: {}, version: '1', deletedAt: null,
    })
    await s.upsertCard({
      id: 'c2', workspaceId: 'other', canvasId: 'cv',
      x: 0, y: 0, width: 100, height: 100, zIndex: 1,
      payload: {}, version: '1', deletedAt: null,
    })
    expect(await s.listCards('w')).toHaveLength(1)
  })

  it('soft-deleted cards excluded from list', async () => {
    const s = new FakeStore()
    await s.upsertCard({
      id: 'c', workspaceId: 'w', canvasId: 'cv',
      x: 0, y: 0, width: 1, height: 1, zIndex: 0,
      payload: {}, version: '1', deletedAt: null,
    })
    await s.softDeleteCard('c', '2')
    expect(await s.listCards('w')).toHaveLength(0)
  })
})
