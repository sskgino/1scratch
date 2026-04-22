import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IngestEvent, MemoryItem, MemoryStrategy, Ingestor, StrategyCtx } from './types'
import { MemoryManager } from './manager'
import * as registry from './registry'
import { z } from 'zod'
import { makeFakeEmbedClient } from './embed'

function fakeDb(): StrategyCtx['db'] {
  return {
    async query() { return [] as any },
    async withTx<T>(fn: (tx: any) => Promise<T>): Promise<T> { return fn(this) },
  }
}

function makeStrategy(id: string, ingestors: Ingestor[]): MemoryStrategy {
  return { id, version: '1.0.0', ingestors, retrievers: [], configSchema: z.object({}), defaults: { enabled: true, weight: 1, params: {} } }
}

describe('MemoryManager.ingest', () => {
  beforeEach(() => registry.clear())

  it('fans out event only to ingestors whose triggers match', async () => {
    const cardPair = vi.fn(async () => [{ userId: 'u', scope: { kind: 'user' as const, refId: null }, sourceKind: 'card_pair', sourceRefId: 'c1', text: 'hi', tags: [], metadata: {}, tier: 'long' as const, expiresAt: null }])
    const note = vi.fn(async () => [])
    registry.register(makeStrategy('s', [
      { triggers: ['card_completed'], produce: cardPair },
      { triggers: ['note_added'], produce: note },
    ]))

    const deps: StrategyCtx = {
      db: fakeDb(),
      embed: makeFakeEmbedClient(),
      logger: { info() {}, warn() {}, error() {} },
    }
    const mgr = new MemoryManager(deps, {
      loadUserConfig: async () => ({ enabledFor: () => true, weightsFor: () => ({}), injectionPolicy: { format: 'system-message', topK: 8, tokenBudget: 2000 } }),
      loadQuotaSnapshot: async () => ({ tier: 'pro', itemCount: 0, bytesCount: 0 }),
      insertItem: async (_ctx, draft) => ({ ...draft, id: 'i1', createdAt: new Date(), updatedAt: new Date() }) as MemoryItem,
      embedAndStore: async () => {},
      incrementCounters: async () => {},
    })

    const event: IngestEvent = { userId: 'u', scope: { kind: 'user', refId: null }, trigger: 'card_completed', payload: {} }
    const created = await mgr.ingest(event)

    expect(cardPair).toHaveBeenCalledOnce()
    expect(note).not.toHaveBeenCalled()
    expect(created).toHaveLength(1)
  })

  it('skips strategy entirely when config.enabledFor returns false', async () => {
    const produce = vi.fn(async () => [])
    registry.register(makeStrategy('s', [{ triggers: ['card_completed'], produce }]))

    const mgr = new MemoryManager({
      db: fakeDb(), embed: makeFakeEmbedClient(), logger: { info() {}, warn() {}, error() {} },
    }, {
      loadUserConfig: async () => ({ enabledFor: () => false, weightsFor: () => ({}), injectionPolicy: { format: 'system-message', topK: 8, tokenBudget: 2000 } }),
      loadQuotaSnapshot: async () => ({ tier: 'pro', itemCount: 0, bytesCount: 0 }),
      insertItem: async () => ({ id: 'x' } as any),
      embedAndStore: async () => {},
      incrementCounters: async () => {},
    })

    await mgr.ingest({ userId: 'u', scope: { kind: 'user', refId: null }, trigger: 'card_completed', payload: {} })
    expect(produce).not.toHaveBeenCalled()
  })
})
