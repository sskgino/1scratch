import { describe, it, expect } from 'vitest'
import type { ScoredItem, MemoryItem, InjectionPolicy } from './types'
import { formatInjection, trimToTokenBudget } from './injection'

function item(id: string, text: string): MemoryItem {
  return {
    id,
    userId: 'u1',
    scope: { kind: 'user', refId: null },
    sourceKind: 'note',
    sourceRefId: null,
    text,
    tags: ['t'],
    metadata: {},
    tier: 'long',
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}
function s(id: string, text: string): ScoredItem { return { item: item(id, text), strategy: 'rag', score: 1 } }

describe('formatInjection', () => {
  const policy: InjectionPolicy = { format: 'system-message', topK: 8, tokenBudget: 2000 }

  it('formats as system-message', () => {
    const r = formatInjection([s('a', 'alpha')], policy)
    expect(r.format).toBe('system-message')
    expect(r.content).toMatch(/Relevant memory items/)
    expect(r.content).toMatch(/alpha/)
    expect(r.itemIds).toEqual(['a'])
  })

  it('formats as user-xml-block', () => {
    const r = formatInjection([s('a', 'alpha')], { ...policy, format: 'user-xml-block' })
    expect(r.format).toBe('user-xml-block')
    expect(r.content).toMatch(/<memory>/)
    expect(r.content).toMatch(/<\/memory>/)
  })

  it('produces empty content on empty items', () => {
    const r = formatInjection([], policy)
    expect(r.content).toBe('')
    expect(r.itemIds).toEqual([])
  })
})

describe('trimToTokenBudget', () => {
  it('drops lowest-score items when over budget (rough char/4 ≈ tokens)', () => {
    const big = 'x'.repeat(4000) // ≈ 1000 tokens
    const items: ScoredItem[] = [
      s('a', big),
      s('b', big),
      s('c', big),
    ]
    // rewrite scores: a=3, b=2, c=1 (descending on input order)
    items[0]!.score = 3; items[1]!.score = 2; items[2]!.score = 1
    const trimmed = trimToTokenBudget(items, { topK: 8, tokenBudget: 1500 })
    expect(trimmed.map(s => s.item.id)).toEqual(['a'])
  })

  it('honors topK even when tokens allow more', () => {
    const small = 'x'.repeat(40)
    const items = Array.from({ length: 10 }, (_, i) => s(`i${i}`, small))
    items.forEach((it, i) => { it.score = 10 - i })
    const trimmed = trimToTokenBudget(items, { topK: 3, tokenBudget: 10_000 })
    expect(trimmed).toHaveLength(3)
  })
})
