import type { ScoredItem, InjectionPolicy, InjectedMemory } from './types'

const CHARS_PER_TOKEN_ESTIMATE = 4

export function trimToTokenBudget(
  items: ScoredItem[],
  budget: { topK: number; tokenBudget: number },
): ScoredItem[] {
  const byScore = [...items].sort((a, b) => b.score - a.score).slice(0, budget.topK)
  const out: ScoredItem[] = []
  let used = 0
  for (const it of byScore) {
    const est = Math.ceil(it.item.text.length / CHARS_PER_TOKEN_ESTIMATE)
    if (used + est > budget.tokenBudget) continue
    out.push(it)
    used += est
  }
  return out
}

function render(items: ScoredItem[]): string {
  return items
    .map((s, i) => {
      const scope = s.item.scope.kind
      const tags = s.item.tags.join(',')
      return `[${i + 1}] (${s.strategy}, ${scope}, ${tags}) ${s.item.text}`
    })
    .join('\n')
}

export function formatInjection(
  items: ScoredItem[],
  policy: InjectionPolicy,
): InjectedMemory {
  if (items.length === 0) return { format: policy.format, content: '', itemIds: [] }
  const body = render(items)
  if (policy.format === 'system-message') {
    return {
      format: 'system-message',
      content: `Relevant memory items (do not restate unless asked):\n${body}`,
      itemIds: items.map(s => s.item.id),
    }
  }
  return {
    format: 'user-xml-block',
    content: `<memory>\n${body}\n</memory>`,
    itemIds: items.map(s => s.item.id),
  }
}
