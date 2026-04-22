import type { ScoredItem } from './types'

const K = 60

export function reciprocalRankFusion(
  lists: ScoredItem[][],
  weights: Record<string, number>,
): ScoredItem[] {
  if (lists.length === 0) return []
  const acc = new Map<string, { item: ScoredItem['item']; strategies: string[]; score: number }>()

  for (let listIndex = 0; listIndex < lists.length; listIndex++) {
    const list = lists[listIndex]!
    const listWeight = listIndex + 1
    list.forEach((scored, rank) => {
      const w = weights[scored.strategy] ?? 1
      const contribution = (w * listWeight) / (K + rank)
      const prev = acc.get(scored.item.id)
      if (prev) {
        prev.score += contribution
        if (!prev.strategies.includes(scored.strategy)) prev.strategies.push(scored.strategy)
      } else {
        acc.set(scored.item.id, {
          item: scored.item,
          strategies: [scored.strategy],
          score: contribution,
        })
      }
    })
  }

  return [...acc.values()]
    .sort((a, b) => b.score - a.score)
    .map(e => ({
      item: e.item,
      score: e.score,
      strategy: e.strategies.join('+'),
    }))
}
