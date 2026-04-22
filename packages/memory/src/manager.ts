import { list } from './registry'
import { enforceQuota, type QuotaSnapshot } from './quota'
import type {
  IngestEvent, MemoryItem, MemoryItemDraft, RetrievalContext, ScoredItem,
  StrategyCtx, InjectedMemory, InjectionPolicy, ScopeRef,
} from './types'
import { reciprocalRankFusion } from './rrf'
import { formatInjection, trimToTokenBudget } from './injection'

export interface UserConfigView {
  enabledFor: (strategyId: string, scope: ScopeRef) => boolean
  weightsFor: (scope: ScopeRef) => Record<string, number>
  injectionPolicy: InjectionPolicy
}

export interface ManagerAdapters {
  loadUserConfig: (db: StrategyCtx['db'], userId: string) => Promise<UserConfigView>
  loadQuotaSnapshot: (db: StrategyCtx['db'], userId: string) => Promise<QuotaSnapshot>
  insertItem: (ctx: StrategyCtx, draft: MemoryItemDraft) => Promise<MemoryItem>
  embedAndStore: (ctx: StrategyCtx, item: MemoryItem) => Promise<void>
  incrementCounters: (db: StrategyCtx['db'], userId: string, deltaItems: number, deltaBytes: number) => Promise<void>
}

export class MemoryManager {
  constructor(private readonly deps: StrategyCtx, private readonly adapters: ManagerAdapters) {}

  async ingest(event: IngestEvent): Promise<MemoryItem[]> {
    const config = await this.adapters.loadUserConfig(this.deps.db, event.userId)
    const created: MemoryItem[] = []
    for (const strat of list()) {
      if (!config.enabledFor(strat.id, event.scope)) continue
      for (const ing of strat.ingestors) {
        if (!ing.triggers.includes(event.trigger)) continue
        const drafts = await ing.produce(event, this.deps)
        for (const draft of drafts) {
          const snapshot = await this.adapters.loadQuotaSnapshot(this.deps.db, event.userId)
          enforceQuota(snapshot, draft.text.length)
          const saved = await this.adapters.insertItem(this.deps, draft)
          await this.adapters.embedAndStore(this.deps, saved)
          await this.adapters.incrementCounters(this.deps.db, event.userId, 1, draft.text.length)
          created.push(saved)
        }
      }
    }
    return created
  }

  async retrieve(ctx: RetrievalContext): Promise<{ items: ScoredItem[]; injected: InjectedMemory }> {
    const config = await this.adapters.loadUserConfig(this.deps.db, ctx.userId)
    const active = list()
      .filter(s => (ctx.filter.strategies ?? null) === null || ctx.filter.strategies!.includes(s.id))
      .filter(s => config.enabledFor(s.id, ctx.currentScope))

    const perStrategy: ScoredItem[][] = []
    for (const s of active) {
      for (const r of s.retrievers) {
        try {
          perStrategy.push(await r.retrieve(ctx, this.deps))
        } catch (e) {
          this.deps.logger.warn('memory.retriever.failed', { strategy: s.id, error: String(e) })
        }
      }
    }

    const fused = reciprocalRankFusion(perStrategy, config.weightsFor(ctx.currentScope))
    const filtered = applyPostFilters(fused, ctx.filter)
    const trimmed = trimToTokenBudget(filtered, ctx.budget)
    const injected = formatInjection(trimmed, config.injectionPolicy)
    return { items: trimmed, injected }
  }
}

function applyPostFilters(items: ScoredItem[], filter: RetrievalContext['filter']): ScoredItem[] {
  return items.filter((s) => {
    if (filter.excludeItemIds?.includes(s.item.id)) return false
    if (filter.tags && !filter.tags.every(t => s.item.tags.includes(t))) return false
    if (filter.sourceKinds && !filter.sourceKinds.includes(s.item.sourceKind as string)) return false
    return true
  })
}
