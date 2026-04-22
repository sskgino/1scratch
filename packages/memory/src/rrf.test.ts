import { describe, it, expect } from 'vitest'
import type { ScoredItem, MemoryItem } from './types'
import { reciprocalRankFusion } from './rrf'

function item(id: string): MemoryItem {
  return {
    id,
    userId: 'u1',
    scope: { kind: 'user', refId: null },
    sourceKind: 'card_pair',
    sourceRefId: null,
    text: id,
    tags: [],
    metadata: {},
    tier: 'long',
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function scored(id: string, strategy: string): ScoredItem {
  return { item: item(id), strategy, score: 0 }
}

describe('reciprocalRankFusion', () => {
  it('fuses two ranked lists into one, boosting items that appear in both', () => {
    const listA = [scored('x', 'rag'), scored('y', 'rag'), scored('z', 'rag')]
    const listB = [scored('y', 'bm25'), scored('x', 'bm25')]
    const fused = reciprocalRankFusion([listA, listB], { rag: 1, bm25: 1 })
    expect(fused.map(s => s.item.id)).toEqual(['y', 'x', 'z']) // y in both top-2
  })

  it('honors strategy weights', () => {
    const listA = [scored('x', 'rag'), scored('y', 'rag')]
    const listB = [scored('y', 'bm25'), scored('x', 'bm25')]
    const fused = reciprocalRankFusion([listA, listB], { rag: 10, bm25: 1 })
    expect(fused[0]!.item.id).toEqual('x') // rag rank-1 dominates
  })

  it('dedups by memory_item_id, keeping the highest fused score strategy label', () => {
    const listA = [scored('x', 'rag')]
    const listB = [scored('x', 'bm25')]
    const fused = reciprocalRankFusion([listA, listB], { rag: 1, bm25: 1 })
    expect(fused).toHaveLength(1)
    expect(fused[0]!.item.id).toBe('x')
  })

  it('returns empty when input is empty', () => {
    expect(reciprocalRankFusion([], {})).toEqual([])
  })
})
