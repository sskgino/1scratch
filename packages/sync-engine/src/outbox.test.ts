import { describe, it, expect } from 'vitest'
import { Outbox } from './outbox'
import { FakeStore } from './fake-store'

describe('Outbox', () => {
  it('peeks + removes in FIFO order', async () => {
    const store = new FakeStore()
    const box = new Outbox(store)
    await store.enqueue({ id: 'a', entityType: 'card', entityId: 'x', op: 'upsert', patch: {}, clientVersion: '1' })
    await store.enqueue({ id: 'b', entityType: 'card', entityId: 'y', op: 'upsert', patch: {}, clientVersion: '2' })

    const peeked = await box.peek(10)
    expect(peeked.map((m) => m.id)).toEqual(['a', 'b'])

    await box.confirm(['a'])
    const after = await box.peek(10)
    expect(after.map((m) => m.id)).toEqual(['b'])
  })

  it('records retry count per id in memory', async () => {
    const store = new FakeStore()
    const box = new Outbox(store)
    box.recordFailure('a')
    box.recordFailure('a')
    expect(box.retryCount('a')).toBe(2)
  })
})
