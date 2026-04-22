import type { ScoredItem } from './types'

const K = 60

export function reciprocalRankFusion(
  lists: ScoredItem[][],
  weights: Record<string, number>,
): ScoredItem[] {
  if (lists.length === 0) return []
  const acc = new Map<string, { item: ScoredItem['item']; strategies: string[]; score: number; minRank: number; lastListIndex: number }>()

  for (let listIndex = 0; listIndex < lists.length; listIndex++) {
    const list = lists[listIndex]!
    const listWeight = listIndex + 1
    list.forEach((scored, rank) => {
      const w = weights[scored.strategy] ?? 1
      const contribution = (w * listWeight) / (K + rank)
      const prev = acc.get(scored.item.id)
      if (prev) {
        prev.score += contribution
        prev.minRank = Math.min(prev.minRank, rank)
        prev.lastListIndex = listIndex
        if (!prev.strategies.includes(scored.strategy)) prev.strategies.push(scored.strategy)
      } else {
        acc.set(scored.item.id, {
          item: scored.item,
          strategies: [scored.strategy],
          score: contribution,
          minRank: rank,
          lastListIndex: listIndex,
        })
      }
    })
  }

  return [...acc.values()]
    .sort((a, b) => {
      const scoreDiff = b.score - a.score
      if (Math.abs(scoreDiff) > 1e-10) return scoreDiff
      // Tiebreaker: items appearing in more lists rank higher
      const strategyDiff = b.strategies.length - a.strategies.length
      if (strategyDiff !== 0) return strategyDiff
      // Secondary tiebreaker: appeared in later list
      return b.lastListIndex - a.lastListIndex
    })
    .map(e => ({
      item: e.item,
      score: e.score,
      strategy: e.strategies.join('+'),
    }))
}
