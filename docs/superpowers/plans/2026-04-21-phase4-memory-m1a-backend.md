# Phase 4 Memory M1a — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the server-side half of the memory ecosystem M1: a new `packages/memory` framework (strategy registry + Memory Manager + RRF fusion + injection formatter + quota), a `rag` default strategy (card_pair, note, canvas_snapshot, section_snapshot ingestors + vector retriever), eight `/api/memory/*` routes, `aiStreamWorkflow` integration, and a unified `ai_usage.kind` cap accounting. End-state is a curl-testable Pro-gated backend that auto-ingests card completions and retrieves via HNSW ANN on pgvector. The client UX half ships in plan M1b.

**Architecture:** Backend-only slice. New workspace package `packages/memory` holds framework + `rag` strategy (pure TS, unit-tested without DB). `apps/web` adds one migration, one helper module (`src/lib/memory/*`), eight route handlers, and two new steps in `aiStreamWorkflow`. All writes go through existing `withRls(userId, [...])` + `sqlUser()` patterns. Embedding providers resolve per-user: `gateway` uses AI SDK + `@ai-sdk/gateway`, `byok` reuses the existing `loadDecryptedKey` crypto path, `local` throws `LocalEmbedRequired` so callers route to the client-embed endpoint.

**Tech Stack:** TypeScript (strict), Vitest, Next.js 16 App Router, Drizzle + raw `sqlUser()` SQL, postgres-js, pgvector ≥ 0.7 on Neon (HNSW + dim-agnostic `vector`), AI SDK v6 (`ai`, `@ai-sdk/openai`, `@ai-sdk/google`), new `@ai-sdk/gateway`, Workflow DevKit (`workflow`, `workflow/api`), Zod, `jose` (existing), `js-sha256` for idempotency hashing.

**Spec:** `docs/superpowers/specs/2026-04-21-phase4-memory-m1a-substrate-design.md` (filename matches `2026-04-21-phase4-memory-m1-substrate-design.md`; M1b spec inherits the same design doc).

---

## Pre-flight: working directory + branches

Run in a dedicated worktree so work stays isolated from main and from the concurrent Phase 3a worktree.

```bash
cd /home/gino/programming/dev/scratch
git fetch origin
git worktree add .worktrees/phase4-memory-m1a-backend -b phase4-memory-m1a-backend main
cd .worktrees/phase4-memory-m1a-backend
pnpm install
pnpm -w tsc -b          # baseline must be green before starting
pnpm -w test run        # baseline test suite must be green
```

**If Phase 3a (`0003_device_sessions.sql`) has merged to `main` before this plan starts, the migration number below stays `0004`.** If Phase 3a has NOT merged yet, keep `0004` and plan to rebase + rename to the next-available number after both PRs align. The implementation plan prefers `0004` and flags renumber as a rebase task (Task 35).

---

## File Structure

**Created:**
- `packages/memory/package.json`
- `packages/memory/tsconfig.json`
- `packages/memory/vitest.config.ts`
- `packages/memory/src/types.ts`
- `packages/memory/src/registry.ts` + `registry.test.ts`
- `packages/memory/src/rrf.ts` + `rrf.test.ts`
- `packages/memory/src/injection.ts` + `injection.test.ts`
- `packages/memory/src/quota.ts` + `quota.test.ts`
- `packages/memory/src/embed.ts`
- `packages/memory/src/manager.ts` + `manager.test.ts`
- `packages/memory/src/strategies/rag/ingestors.ts` + `ingestors.test.ts`
- `packages/memory/src/strategies/rag/retriever.ts` + `retriever.test.ts`
- `packages/memory/src/strategies/rag/index.ts`
- `packages/memory/src/index.ts` (barrel)
- `apps/web/src/db/migrations/0004_memory_substrate.sql`
- `apps/web/src/db/schema.ts` (add 4 tables + users columns — SEE Task 5)
- `apps/web/src/lib/memory/context.ts`
- `apps/web/src/lib/memory/embed-resolver.ts`
- `apps/web/src/lib/memory/scope.ts`
- `apps/web/src/lib/memory/ingest-helpers.ts`
- `apps/web/src/lib/memory/strategy-loader.ts`
- `apps/web/src/lib/memory/config-loader.ts`
- `apps/web/src/lib/memory/llm-client.ts`
- `apps/web/src/app/api/memory/ingest/route.ts`
- `apps/web/src/app/api/memory/ingest/client-embed/route.ts`
- `apps/web/src/app/api/memory/search/route.ts`
- `apps/web/src/app/api/memory/items/route.ts`
- `apps/web/src/app/api/memory/items/[id]/route.ts`
- `apps/web/src/app/api/memory/config/route.ts`
- `apps/web/src/app/api/memory/usage/route.ts`
- `apps/web/tests/integration/memory-rls.test.ts`
- `apps/web/tests/integration/memory-ingest.test.ts`
- `apps/web/tests/integration/memory-search.test.ts`
- `apps/web/tests/integration/memory-quota.test.ts`
- `apps/web/tests/integration/memory-client-embed.test.ts`
- `apps/web/tests/integration/memory-snapshot.test.ts`
- `apps/web/tests/integration/memory-auto-ingest.test.ts`
- `apps/web/tests/integration/memory-tier.test.ts`

**Modified:**
- `pnpm-workspace.yaml` — no edit (glob `packages/*` already covers new package)
- `apps/web/package.json` — add `@1scratch/memory: workspace:*`, `@ai-sdk/gateway`
- `apps/web/src/workflows/ai-stream.ts` — two new steps + input-shape extension
- `apps/web/src/lib/spend-cap.ts` — widen `recordUsage` to accept `kind` param, default `'completion'`
- `apps/web/src/db/rls.ts` — no edit (existing `withRls` + `sqlUser` re-used)

**Deferred to M1b plan:**
- Settings → Memory UI (`packages/ui/src/settings/memory/*`)
- Slash-command `/remember`
- Context menu actions
- Response footer indicator
- Tauri local-embed bridge

---

## Task 1: Create new workspace package `packages/memory`

**Files:**
- Create: `packages/memory/package.json`
- Create: `packages/memory/tsconfig.json`
- Create: `packages/memory/vitest.config.ts`
- Create: `packages/memory/src/index.ts`

- [ ] **Step 1: Write `packages/memory/package.json`**

```json
{
  "name": "@1scratch/memory",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./strategies/rag": "./src/strategies/rag/index.ts"
  },
  "scripts": {
    "typecheck": "tsc -b",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Write `packages/memory/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "noEmit": false
  },
  "include": ["src/**/*"],
  "exclude": ["**/*.test.ts"]
}
```

If `../../tsconfig.base.json` does not exist, copy settings from `packages/sync-engine/tsconfig.json` verbatim and adjust paths.

- [ ] **Step 3: Write `packages/memory/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globals: false,
  },
})
```

- [ ] **Step 4: Write empty barrel `packages/memory/src/index.ts`**

```ts
// Barrel filled by later tasks. Keeping the file present so tsc -b can walk the graph.
export {}
```

- [ ] **Step 5: Install workspace dep in web app**

```bash
cd apps/web
pnpm add @1scratch/memory@workspace:*
```

- [ ] **Step 6: Verify workspace resolves**

Run: `pnpm -w tsc -b`
Expected: PASS (new package builds, empty barrel, no errors).

- [ ] **Step 7: Commit**

```bash
git add packages/memory apps/web/package.json pnpm-lock.yaml
git commit -m "feat(memory): scaffold packages/memory workspace"
```

---

## Task 2: Core types

**Files:**
- Create: `packages/memory/src/types.ts`

- [ ] **Step 1: Write `types.ts`**

```ts
import type { z } from 'zod'

export type ScopeKind = 'user' | 'workspace' | 'section' | 'canvas'
export type SourceKind =
  | 'card_pair'
  | 'note'
  | 'canvas_snapshot'
  | 'section_snapshot'
  | (string & {})
export type Tier = 'short' | 'long'

export interface ScopeRef {
  kind: ScopeKind
  refId: string | null
}

export interface MemoryItem {
  id: string
  userId: string
  scope: ScopeRef
  sourceKind: SourceKind
  sourceRefId: string | null
  text: string
  tags: string[]
  metadata: Record<string, unknown>
  tier: Tier
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type MemoryItemDraft = Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'>

export interface IngestEvent {
  userId: string
  scope: ScopeRef
  trigger:
    | 'card_completed'
    | 'card_saved'
    | 'canvas_saved'
    | 'section_saved'
    | 'note_added'
    | (string & {})
  payload: unknown
}

export interface RetrievalContext {
  userId: string
  currentScope: ScopeRef
  queryText: string
  queryEmbedding?: Float32Array
  filter: {
    tags?: string[]
    sourceKinds?: SourceKind[]
    strategies?: string[]
    excludeItemIds?: string[]
  }
  budget: { topK: number; tokenBudget: number }
}

export interface ScoredItem {
  item: MemoryItem
  score: number
  strategy: string
  rationale?: string
}

export type InjectFormat = 'system-message' | 'user-xml-block'

export interface InjectionPolicy {
  format: InjectFormat
  topK: number
  tokenBudget: number
}

export interface InjectedMemory {
  format: InjectFormat
  content: string
  itemIds: string[]
}

export interface DbClient {
  query: <T>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>
  withTx: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>
}

export interface EmbedClient {
  readonly providerId: 'gateway' | 'byok' | 'local'
  readonly modelId: string
  readonly dim: number
  embed(text: string[]): Promise<Float32Array[]>
}

export interface LlmClient {
  summarize(texts: string[], opts?: { maxTokens?: number }): Promise<string>
}

export interface Logger {
  info: (event: string, data?: Record<string, unknown>) => void
  warn: (event: string, data?: Record<string, unknown>) => void
  error: (event: string, data?: Record<string, unknown>) => void
}

export interface StrategyCtx {
  db: DbClient
  embed: EmbedClient
  llm?: LlmClient
  logger: Logger
}

export interface Ingestor {
  triggers: readonly string[]
  produce(event: IngestEvent, ctx: StrategyCtx): Promise<MemoryItemDraft[]>
}

export interface Retriever {
  retrieve(ctx: RetrievalContext, strategyCtx: StrategyCtx): Promise<ScoredItem[]>
}

export interface MemoryStrategy {
  id: string
  version: string
  ingestors: Ingestor[]
  retrievers: Retriever[]
  configSchema: z.ZodType
  defaults: { enabled: boolean; weight: number; params: Record<string, unknown> }
}

export class QuotaError extends Error {
  constructor(public readonly which: 'not_pro' | 'item_cap' | 'byte_cap') {
    super(`memory_quota_exceeded:${which}`)
  }
}

export class LocalEmbedRequired extends Error {
  constructor() {
    super('local_embed_required')
  }
}
```

- [ ] **Step 2: Re-export from barrel**

Edit `packages/memory/src/index.ts`:

```ts
export * from './types'
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm -w tsc -b`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/memory/src/types.ts packages/memory/src/index.ts
git commit -m "feat(memory): core types"
```

---

## Task 3: Strategy registry

**Files:**
- Create: `packages/memory/src/registry.ts`
- Create: `packages/memory/src/registry.test.ts`

- [ ] **Step 1: Write failing test `registry.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import type { MemoryStrategy } from './types'
import { register, get, list, clear } from './registry'

function makeStrategy(id: string): MemoryStrategy {
  return {
    id,
    version: '1.0.0',
    ingestors: [],
    retrievers: [],
    configSchema: z.object({}),
    defaults: { enabled: true, weight: 1, params: {} },
  }
}

describe('registry', () => {
  beforeEach(() => clear())

  it('registers and retrieves strategies by id', () => {
    const a = makeStrategy('a')
    register(a)
    expect(get('a')).toBe(a)
    expect(list()).toEqual([a])
  })

  it('is idempotent on repeat register (same id overwrites)', () => {
    register(makeStrategy('x'))
    const x2 = makeStrategy('x')
    register(x2)
    expect(get('x')).toBe(x2)
    expect(list()).toHaveLength(1)
  })

  it('returns undefined for unknown id', () => {
    expect(get('nope')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @1scratch/memory test`
Expected: FAIL — `register` not defined.

- [ ] **Step 3: Implement `registry.ts`**

```ts
import type { MemoryStrategy } from './types'

const strategies = new Map<string, MemoryStrategy>()

export function register(s: MemoryStrategy): void {
  strategies.set(s.id, s)
}

export function get(id: string): MemoryStrategy | undefined {
  return strategies.get(id)
}

export function list(): MemoryStrategy[] {
  return [...strategies.values()]
}

/** Test-only. Clears the registry between tests. */
export function clear(): void {
  strategies.clear()
}
```

- [ ] **Step 4: Re-run test**

Run: `pnpm --filter @1scratch/memory test`
Expected: PASS.

- [ ] **Step 5: Export from barrel**

Edit `packages/memory/src/index.ts`:

```ts
export * from './types'
export * as registry from './registry'
```

- [ ] **Step 6: Commit**

```bash
git add packages/memory/src/registry.ts packages/memory/src/registry.test.ts packages/memory/src/index.ts
git commit -m "feat(memory): strategy registry"
```

---

## Task 4: Reciprocal Rank Fusion

**Files:**
- Create: `packages/memory/src/rrf.ts`
- Create: `packages/memory/src/rrf.test.ts`

- [ ] **Step 1: Write failing test**

```ts
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
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @1scratch/memory test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { ScoredItem } from './types'

const K = 60

export function reciprocalRankFusion(
  lists: ScoredItem[][],
  weights: Record<string, number>,
): ScoredItem[] {
  if (lists.length === 0) return []
  const acc = new Map<string, { item: ScoredItem['item']; strategies: string[]; score: number }>()

  for (const list of lists) {
    list.forEach((scored, rank) => {
      const w = weights[scored.strategy] ?? 1
      const contribution = w / (K + rank)
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
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @1scratch/memory test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/rrf.ts packages/memory/src/rrf.test.ts
git commit -m "feat(memory): RRF fusion"
```

---

## Task 5: Injection formatter

**Files:**
- Create: `packages/memory/src/injection.ts`
- Create: `packages/memory/src/injection.test.ts`

- [ ] **Step 1: Write failing test**

```ts
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
```

- [ ] **Step 2: Run test, verify failure**

Run: `pnpm --filter @1scratch/memory test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter @1scratch/memory test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/injection.ts packages/memory/src/injection.test.ts
git commit -m "feat(memory): injection formatter + token budget trim"
```

---

## Task 6: Quota helpers

**Files:**
- Create: `packages/memory/src/quota.ts`
- Create: `packages/memory/src/quota.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { QuotaError } from './types'
import { enforceQuota, QuotaSnapshot } from './quota'

function snapshot(tier: 'free' | 'pro', items: number, bytes: number): QuotaSnapshot {
  return { tier, itemCount: items, bytesCount: bytes }
}

describe('enforceQuota', () => {
  it('rejects non-pro users', () => {
    expect(() => enforceQuota(snapshot('free', 0, 0), 100)).toThrow(QuotaError)
    try { enforceQuota(snapshot('free', 0, 0), 100) } catch (e) {
      expect((e as QuotaError).which).toBe('not_pro')
    }
  })

  it('rejects at item cap (50k)', () => {
    expect(() => enforceQuota(snapshot('pro', 50_000, 0), 100)).toThrow(QuotaError)
    try { enforceQuota(snapshot('pro', 50_000, 0), 100) } catch (e) {
      expect((e as QuotaError).which).toBe('item_cap')
    }
  })

  it('rejects at byte cap (200MB)', () => {
    expect(() => enforceQuota(snapshot('pro', 0, 200_000_000), 1)).toThrow(QuotaError)
  })

  it('allows under caps', () => {
    expect(() => enforceQuota(snapshot('pro', 49_999, 199_999_000), 100)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @1scratch/memory test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { QuotaError } from './types'

export interface QuotaSnapshot {
  tier: 'free' | 'pro'
  itemCount: number
  bytesCount: number
}

export const PRO_ITEM_CAP = 50_000
export const PRO_BYTE_CAP = 200_000_000

export function enforceQuota(snapshot: QuotaSnapshot, incomingTextLen: number): void {
  if (snapshot.tier !== 'pro') throw new QuotaError('not_pro')
  if (snapshot.itemCount >= PRO_ITEM_CAP) throw new QuotaError('item_cap')
  if (snapshot.bytesCount + incomingTextLen >= PRO_BYTE_CAP) throw new QuotaError('byte_cap')
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @1scratch/memory test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/quota.ts packages/memory/src/quota.test.ts
git commit -m "feat(memory): quota enforcement helpers"
```

---

## Task 7: Embed client interface

**Files:**
- Create: `packages/memory/src/embed.ts`

This task only defines the interface surface consumed by the Memory Manager. Concrete resolvers (Gateway, BYOK, Local stub) live in `apps/web/src/lib/memory/embed-resolver.ts` and get plugged in via `StrategyCtx.embed`. The package stays DB- and provider-agnostic.

- [ ] **Step 1: Write `embed.ts`**

```ts
import type { EmbedClient, DbClient } from './types'
import { LocalEmbedRequired } from './types'

/** In-memory fake for unit tests. Deterministic vectors = sum of char codes per token-ish bucket. */
export function makeFakeEmbedClient(dim = 8, modelId = 'test/fake-model'): EmbedClient {
  return {
    providerId: 'gateway',
    modelId,
    dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      return texts.map(t => {
        const arr = new Float32Array(dim)
        for (let i = 0; i < t.length; i++) {
          arr[i % dim] = (arr[i % dim] ?? 0) + t.charCodeAt(i) / 1000
        }
        return arr
      })
    },
  }
}

export { LocalEmbedRequired }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -w tsc -b`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/memory/src/embed.ts
git commit -m "feat(memory): embed client interface + fake for tests"
```

---

## Task 8: Migration `0004_memory_substrate.sql`

**Files:**
- Create: `apps/web/src/db/migrations/0004_memory_substrate.sql`

- [ ] **Step 1: Write migration**

```sql
-- Phase 4 Memory M1a — substrate + pluggable strategies + per-user vectors.
-- Replaces PLAN §3 placeholder memory_chunks stub.

CREATE EXTENSION IF NOT EXISTS vector;

-- Drop the old placeholder stub (pre-M1 had zero rows).
DROP TABLE IF EXISTS memory_chunks;

-- ─── memory_items — canonical, strategy-agnostic store ─────────────────────
CREATE TABLE memory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('user','workspace','section','canvas')),
  scope_ref_id uuid,
  CHECK ((scope_kind = 'user') = (scope_ref_id IS NULL)),
  source_kind text NOT NULL,
  source_ref_id uuid,
  text text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  tier text NOT NULL DEFAULT 'long' CHECK (tier IN ('short','long')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memory_items_user_scope_idx
  ON memory_items (user_id, scope_kind, scope_ref_id)
  WHERE expires_at IS NULL OR expires_at > now();
CREATE INDEX memory_items_tags_gin_idx ON memory_items USING gin (tags);
CREATE INDEX memory_items_source_idx ON memory_items (user_id, source_kind, source_ref_id);
-- Idempotency for card_pair ingestor: dedupe on (user, card, response_sha256 metadata key).
CREATE UNIQUE INDEX memory_items_card_pair_idem_idx
  ON memory_items (user_id, source_kind, source_ref_id, (metadata->>'response_sha256'))
  WHERE source_kind = 'card_pair' AND metadata ? 'response_sha256';

ALTER TABLE memory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_items FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_items_owner ON memory_items
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- ─── memory_vectors — per-(item, embedding-model) cache ────────────────────
CREATE TABLE memory_vectors (
  memory_item_id uuid NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  embedding_model_id text NOT NULL,
  dim int NOT NULL,
  embedding vector,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (memory_item_id, embedding_model_id)
);
CREATE INDEX memory_vectors_ann_idx ON memory_vectors USING hnsw (embedding vector_cosine_ops);

ALTER TABLE memory_vectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_vectors FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_vectors_owner ON memory_vectors
  USING (EXISTS (SELECT 1 FROM memory_items m
                 WHERE m.id = memory_vectors.memory_item_id
                   AND m.user_id = app_current_user_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM memory_items m
                       WHERE m.id = memory_vectors.memory_item_id
                         AND m.user_id = app_current_user_id()));

-- ─── memory_edges — forward-compat for graph strategies ────────────────────
CREATE TABLE memory_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_item_id uuid NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  to_item_id uuid NOT NULL REFERENCES memory_items(id) ON DELETE CASCADE,
  rel text NOT NULL,
  weight real NOT NULL DEFAULT 1.0,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_edges_from_idx ON memory_edges (user_id, from_item_id, rel);
CREATE INDEX memory_edges_to_idx ON memory_edges (user_id, to_item_id, rel);
ALTER TABLE memory_edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_edges FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_edges_owner ON memory_edges
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- ─── memory_facts — forward-compat for semantic/triple strategies ──────────
CREATE TABLE memory_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('user','workspace','section','canvas')),
  scope_ref_id uuid,
  subject text NOT NULL,
  predicate text NOT NULL,
  object jsonb NOT NULL,
  source_item_id uuid REFERENCES memory_items(id) ON DELETE SET NULL,
  confidence real NOT NULL DEFAULT 1.0,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX memory_facts_subject_idx ON memory_facts (user_id, subject);
CREATE INDEX memory_facts_predicate_idx ON memory_facts (user_id, predicate);
ALTER TABLE memory_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_facts FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_facts_owner ON memory_facts
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- ─── memory_strategy_config — per-(user, scope, strategy) settings ─────────
CREATE TABLE memory_strategy_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope_kind text NOT NULL CHECK (scope_kind IN ('user','workspace','section','canvas','task')),
  scope_ref_id uuid,
  strategy text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  weight real NOT NULL DEFAULT 1.0,
  params jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, scope_kind, scope_ref_id, strategy)
);
ALTER TABLE memory_strategy_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_strategy_config FORCE ROW LEVEL SECURITY;
CREATE POLICY memory_strategy_config_owner ON memory_strategy_config
  USING (user_id = app_current_user_id())
  WITH CHECK (user_id = app_current_user_id());

-- ─── users — per-user memory settings + quota counters ─────────────────────
ALTER TABLE users
  ADD COLUMN memory_embedding_model_id text,
  ADD COLUMN memory_embedding_provider text
    CHECK (memory_embedding_provider IN ('gateway','byok','local')),
  ADD COLUMN memory_injection_policy jsonb NOT NULL
    DEFAULT '{"format":"system-message","token_budget":2000,"top_k":8}'::jsonb,
  ADD COLUMN memory_item_count int NOT NULL DEFAULT 0,
  ADD COLUMN memory_bytes_count bigint NOT NULL DEFAULT 0;

-- ─── ai_usage — add kind discriminator for unified cap accounting ──────────
ALTER TABLE ai_usage
  ADD COLUMN kind text NOT NULL DEFAULT 'completion'
    CHECK (kind IN ('completion','embedding'));
```

- [ ] **Step 2: Verify pgvector version supports HNSW + dim-agnostic `vector`**

Use the Neon MCP `run_sql` tool (or `psql` with admin connection) against a Preview branch:

```sql
SELECT extversion FROM pg_extension WHERE extname = 'vector';
```

Expected: `>= 0.7.0`. If lower, first upgrade via Neon support or pin `CREATE EXTENSION vector VERSION '0.7.0';` — document in the Build Log if the version differs.

- [ ] **Step 3: Apply migration to a Neon Preview branch**

Using Neon MCP `prepare_database_migration` + `run_sql_transaction`. Prepend `SET ROLE neondb_owner;` (Phase 2 step 7-9-10 lesson). Verify all five new tables exist + RLS enabled + HNSW index visible via `\d+ memory_vectors`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/db/migrations/0004_memory_substrate.sql
git commit -m "feat(db): migration 0004 memory substrate (items, vectors, edges, facts, strategy_config)"
```

---

## Task 9: Drizzle schema additions

**Files:**
- Modify: `apps/web/src/db/schema.ts`

- [ ] **Step 1: Read current schema tail**

Open `apps/web/src/db/schema.ts`. Note the ending — append below the last export.

- [ ] **Step 2: Append Drizzle definitions for new tables + users columns**

```ts
// ─── Memory M1a (Phase 4) ────────────────────────────────────────────────────

import {
  vector,    // pgvector column helper; if not exported from drizzle-orm/pg-core,
  customType // fall back to this — see comment below
} from 'drizzle-orm/pg-core' // add these to existing imports in the file

// If drizzle-orm's pgvector helper is unavailable at the project's drizzle version,
// define a minimal customType for `vector`:
//   const vectorColumn = customType<{ data: number[]; driverData: string }>({
//     dataType() { return 'vector' }
//   })
// and use `vectorColumn('embedding')` below instead of `vector('embedding',...)`.

export const memoryItems = pgTable(
  'memory_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    scopeKind: text('scope_kind').notNull(),
    scopeRefId: uuid('scope_ref_id'),
    sourceKind: text('source_kind').notNull(),
    sourceRefId: uuid('source_ref_id'),
    text: text('text').notNull(),
    tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    tier: text('tier').notNull().default('long'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('memory_items_user_scope_idx').on(t.userId, t.scopeKind, t.scopeRefId),
    index('memory_items_source_idx').on(t.userId, t.sourceKind, t.sourceRefId),
  ],
)

export const memoryVectors = pgTable('memory_vectors', {
  memoryItemId: uuid('memory_item_id').notNull().references(() => memoryItems.id, { onDelete: 'cascade' }),
  embeddingModelId: text('embedding_model_id').notNull(),
  dim: integer('dim').notNull(),
  // Drizzle pgvector helper (falls back to customType if unavailable — see above):
  // embedding: vector('embedding', { dimensions: null }),
  embedding: text('embedding'), // stored as pgvector; Drizzle sees text for cross-dim tolerance
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.memoryItemId, t.embeddingModelId] }),
])

export const memoryEdges = pgTable('memory_edges', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  fromItemId: uuid('from_item_id').notNull().references(() => memoryItems.id, { onDelete: 'cascade' }),
  toItemId: uuid('to_item_id').notNull().references(() => memoryItems.id, { onDelete: 'cascade' }),
  rel: text('rel').notNull(),
  weight: real('weight').notNull().default(1),
  metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const memoryFacts = pgTable('memory_facts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scopeKind: text('scope_kind').notNull(),
  scopeRefId: uuid('scope_ref_id'),
  subject: text('subject').notNull(),
  predicate: text('predicate').notNull(),
  object: jsonb('object').notNull(),
  sourceItemId: uuid('source_item_id').references(() => memoryItems.id, { onDelete: 'set null' }),
  confidence: real('confidence').notNull().default(1),
  tags: text('tags').array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const memoryStrategyConfig = pgTable(
  'memory_strategy_config',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    scopeKind: text('scope_kind').notNull(),
    scopeRefId: uuid('scope_ref_id'),
    strategy: text('strategy').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    weight: real('weight').notNull().default(1),
    params: jsonb('params').notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('memory_strategy_config_uniq').on(t.userId, t.scopeKind, t.scopeRefId, t.strategy),
  ],
)
```

Also extend existing `users` export:

```ts
// In the users export, add:
memoryEmbeddingModelId: text('memory_embedding_model_id'),
memoryEmbeddingProvider: text('memory_embedding_provider'),
memoryInjectionPolicy: jsonb('memory_injection_policy').notNull().default(sql`'{"format":"system-message","token_budget":2000,"top_k":8}'::jsonb`),
memoryItemCount: integer('memory_item_count').notNull().default(0),
memoryBytesCount: bigint('memory_bytes_count', { mode: 'number' }).notNull().default(0),
```

And extend `aiUsage` with:

```ts
kind: text('kind').notNull().default('completion'),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -w tsc -b`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/db/schema.ts
git commit -m "feat(db): drizzle schema for memory substrate + users columns"
```

---

## Task 10: Memory Manager — ingest

**Files:**
- Create: `packages/memory/src/manager.ts`
- Create: `packages/memory/src/manager.test.ts`

- [ ] **Step 1: Write failing test (fake DB + fake embed)**

```ts
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
    // Stub the manager's insertItem + embedAndStore to avoid DB. We'll test real paths in integration.
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
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @1scratch/memory test`
Expected: FAIL (no `MemoryManager`).

- [ ] **Step 3: Implement `manager.ts`**

```ts
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
          const saved = await this.adapters.insertItem(this.deps.db ? this.deps : this.deps, draft)
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
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @1scratch/memory test`
Expected: PASS.

- [ ] **Step 5: Export from barrel**

Edit `packages/memory/src/index.ts`:

```ts
export * from './types'
export * as registry from './registry'
export * from './manager'
export * from './injection'
export * from './rrf'
export * from './quota'
export * from './embed'
```

- [ ] **Step 6: Commit**

```bash
git add packages/memory/src/manager.ts packages/memory/src/manager.test.ts packages/memory/src/index.ts
git commit -m "feat(memory): MemoryManager with ingest + retrieve + adapter DI"
```

---

## Task 11: `rag` strategy — `cardPairIngestor`

**Files:**
- Create: `packages/memory/src/strategies/rag/ingestors.ts`
- Create: `packages/memory/src/strategies/rag/ingestors.test.ts`

- [ ] **Step 1: Write failing test for cardPair idempotency + shape**

```ts
import { describe, it, expect } from 'vitest'
import { cardPairIngestor } from './ingestors'
import type { IngestEvent, StrategyCtx } from '../../types'
import { makeFakeEmbedClient } from '../../embed'

const ctx: StrategyCtx = {
  db: { async query() { return [] as any }, async withTx<T>(fn: any) { return fn(this) } },
  embed: makeFakeEmbedClient(),
  logger: { info() {}, warn() {}, error() {} },
}

describe('cardPairIngestor', () => {
  it('produces one draft with card_pair source + response_sha256 metadata', async () => {
    const event: IngestEvent = {
      userId: 'u', scope: { kind: 'user', refId: null }, trigger: 'card_completed',
      payload: { cardId: 'abcdefab-1234-4234-8234-123456789abc', prompt: 'what is X?', response: 'X is Y.' },
    }
    const drafts = await cardPairIngestor(event, ctx)
    expect(drafts).toHaveLength(1)
    const d = drafts[0]!
    expect(d.sourceKind).toBe('card_pair')
    expect(d.sourceRefId).toBe('abcdefab-1234-4234-8234-123456789abc')
    expect(d.text).toContain('what is X?')
    expect(d.text).toContain('X is Y.')
    expect((d.metadata as any).response_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect((d.metadata as any).trigger).toBe('card_completed')
  })

  it('returns empty for payload without cardId', async () => {
    const drafts = await cardPairIngestor({ userId: 'u', scope: { kind: 'user', refId: null }, trigger: 'card_completed', payload: {} }, ctx)
    expect(drafts).toEqual([])
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @1scratch/memory test`
Expected: FAIL.

- [ ] **Step 3: Implement `ingestors.ts` — cardPair + note**

```ts
import { createHash } from 'node:crypto'
import type { Ingestor, IngestEvent, MemoryItemDraft, StrategyCtx } from '../../types'

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

interface CardPairPayload {
  cardId: string
  prompt: string
  response: string
  parentSnapshotId?: string
}

export const cardPairIngestor: Ingestor['produce'] = async (event: IngestEvent, _ctx: StrategyCtx): Promise<MemoryItemDraft[]> => {
  const p = event.payload as Partial<CardPairPayload> | undefined
  if (!p?.cardId || typeof p.prompt !== 'string' || typeof p.response !== 'string') return []
  if (p.response.length < 40 || p.prompt.length < 10) return []
  const text = `${p.prompt}\n\n${p.response}`
  return [{
    userId: event.userId,
    scope: event.scope,
    sourceKind: 'card_pair',
    sourceRefId: p.cardId,
    text,
    tags: [],
    metadata: {
      response_sha256: sha256(p.response),
      trigger: event.trigger,
      ...(p.parentSnapshotId ? { parent_snapshot_id: p.parentSnapshotId } : {}),
    },
    tier: 'long',
    expiresAt: null,
  }]
}

interface NotePayload { text: string; tags?: string[] }

export const noteIngestor: Ingestor['produce'] = async (event: IngestEvent, _ctx: StrategyCtx): Promise<MemoryItemDraft[]> => {
  const p = event.payload as Partial<NotePayload> | undefined
  if (!p?.text || typeof p.text !== 'string') return []
  return [{
    userId: event.userId,
    scope: event.scope,
    sourceKind: 'note',
    sourceRefId: null,
    text: p.text,
    tags: p.tags ?? [],
    metadata: { trigger: event.trigger },
    tier: 'long',
    expiresAt: null,
  }]
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @1scratch/memory test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/strategies/rag/ingestors.ts packages/memory/src/strategies/rag/ingestors.test.ts
git commit -m "feat(memory/rag): cardPair + note ingestors"
```

---

## Task 12: `rag` strategy — `canvasSnapshotIngestor` + `sectionSnapshotIngestor`

**Files:**
- Modify: `packages/memory/src/strategies/rag/ingestors.ts`
- Modify: `packages/memory/src/strategies/rag/ingestors.test.ts`

- [ ] **Step 1: Extend test file**

Append to `ingestors.test.ts`:

```ts
import { canvasSnapshotIngestor, sectionSnapshotIngestor } from './ingestors'

describe('canvasSnapshotIngestor', () => {
  const baseCtx = { ...ctx, llm: { summarize: async () => 'canvas summary' } }
  const cards = [
    { id: 'c1', prompt: 'q1', response: 'a1' },
    { id: 'c2', prompt: 'q2', response: 'a2' },
  ]

  it('produces parent snapshot + N children with parent_snapshot_id linkage', async () => {
    const event: IngestEvent = {
      userId: 'u', scope: { kind: 'user', refId: null }, trigger: 'canvas_saved',
      payload: { canvasId: 'deadbeef-1234-4234-8234-123456789abc', cards },
    }
    const drafts = await canvasSnapshotIngestor(event, baseCtx)
    expect(drafts).toHaveLength(3)
    const parent = drafts.find(d => d.sourceKind === 'canvas_snapshot')!
    expect(parent.sourceRefId).toBe('deadbeef-1234-4234-8234-123456789abc')
    expect(parent.text).toBe('canvas summary')
    expect((parent.metadata as any).card_ids).toEqual(['c1', 'c2'])
    const children = drafts.filter(d => d.sourceKind === 'card_pair')
    expect(children).toHaveLength(2)
    for (const c of children) {
      // parent_snapshot_id propagates but actual id is assigned at insertItem time;
      // ingestor emits a sentinel '__pending__' that the manager adapter resolves.
      expect((c.metadata as any).parent_snapshot_id).toBe('__pending__')
    }
  })

  it('rejects canvases over the 500-card ceiling with a thrown error', async () => {
    const big = Array.from({ length: 501 }, (_, i) => ({ id: `c${i}`, prompt: 'p', response: 'rrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrr' }))
    await expect(canvasSnapshotIngestor({ userId: 'u', scope: { kind: 'user', refId: null }, trigger: 'canvas_saved', payload: { canvasId: 'deadbeef-0000-4000-8000-000000000000', cards: big } }, baseCtx))
      .rejects.toThrow(/canvas_too_large/)
  })
})

describe('sectionSnapshotIngestor', () => {
  it('emits section parent + flat fan-out over all cards across canvases', async () => {
    const sectionId = 'deadbeef-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const event: IngestEvent = {
      userId: 'u', scope: { kind: 'user', refId: null }, trigger: 'section_saved',
      payload: {
        sectionId,
        canvases: [
          { id: 'cv1', cards: [{ id: 'c1', prompt: 'p1', response: 'r1' }] },
          { id: 'cv2', cards: [{ id: 'c2', prompt: 'p2', response: 'r2' }] },
        ],
      },
    }
    const baseCtx = { ...ctx, llm: { summarize: async () => 'section summary' } }
    const drafts = await sectionSnapshotIngestor(event, baseCtx)
    const parent = drafts.find(d => d.sourceKind === 'section_snapshot')!
    expect(parent.sourceRefId).toBe(sectionId)
    expect((parent.metadata as any).card_ids).toEqual(['c1', 'c2'])
    const children = drafts.filter(d => d.sourceKind === 'card_pair')
    expect(children).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @1scratch/memory test`
Expected: FAIL (new ingestors not defined).

- [ ] **Step 3: Extend `ingestors.ts`**

Append:

```ts
const CANVAS_CARD_CEILING = 500

interface SnapshotCard { id: string; prompt: string; response: string }
interface CanvasSnapshotPayload { canvasId: string; cards: SnapshotCard[] }

export class CanvasTooLargeError extends Error {
  constructor() { super('canvas_too_large') }
}

export const canvasSnapshotIngestor: Ingestor['produce'] = async (event, ctx) => {
  const p = event.payload as Partial<CanvasSnapshotPayload> | undefined
  if (!p?.canvasId || !Array.isArray(p.cards) || p.cards.length === 0) return []
  if (p.cards.length > CANVAS_CARD_CEILING) throw new CanvasTooLargeError()

  const summary = ctx.llm
    ? await ctx.llm.summarize(p.cards.map(c => `Q: ${c.prompt}\nA: ${c.response}`))
    : p.cards.map(c => c.response).join('\n').slice(0, 2000)

  const parent: MemoryItemDraft = {
    userId: event.userId,
    scope: event.scope,
    sourceKind: 'canvas_snapshot',
    sourceRefId: p.canvasId,
    text: summary,
    tags: [],
    metadata: {
      card_ids: p.cards.map(c => c.id),
      children_pending: p.cards.length,
      trigger: event.trigger,
    },
    tier: 'long',
    expiresAt: null,
  }

  const children: MemoryItemDraft[] = p.cards
    .filter(c => c.response.length >= 40 && c.prompt.length >= 10)
    .map(c => ({
      userId: event.userId,
      scope: event.scope,
      sourceKind: 'card_pair',
      sourceRefId: c.id,
      text: `${c.prompt}\n\n${c.response}`,
      tags: [],
      metadata: {
        response_sha256: sha256(c.response),
        trigger: event.trigger,
        parent_snapshot_id: '__pending__', // resolved by manager adapter after parent insert
      },
      tier: 'long' as const,
      expiresAt: null,
    }))

  return [parent, ...children]
}

interface SectionSnapshotPayload {
  sectionId: string
  canvases: Array<{ id: string; cards: SnapshotCard[] }>
}

export const sectionSnapshotIngestor: Ingestor['produce'] = async (event, ctx) => {
  const p = event.payload as Partial<SectionSnapshotPayload> | undefined
  if (!p?.sectionId || !Array.isArray(p.canvases)) return []
  const allCards = p.canvases.flatMap(cv => cv.cards)
  if (allCards.length > CANVAS_CARD_CEILING) throw new CanvasTooLargeError()

  const summary = ctx.llm
    ? await ctx.llm.summarize(allCards.map(c => `Q: ${c.prompt}\nA: ${c.response}`))
    : allCards.map(c => c.response).join('\n').slice(0, 2000)

  const parent: MemoryItemDraft = {
    userId: event.userId,
    scope: event.scope,
    sourceKind: 'section_snapshot',
    sourceRefId: p.sectionId,
    text: summary,
    tags: [],
    metadata: {
      card_ids: allCards.map(c => c.id),
      canvas_ids: p.canvases.map(cv => cv.id),
      children_pending: allCards.length,
      trigger: event.trigger,
    },
    tier: 'long',
    expiresAt: null,
  }

  const children: MemoryItemDraft[] = allCards
    .filter(c => c.response.length >= 40 && c.prompt.length >= 10)
    .map(c => ({
      userId: event.userId,
      scope: event.scope,
      sourceKind: 'card_pair',
      sourceRefId: c.id,
      text: `${c.prompt}\n\n${c.response}`,
      tags: [],
      metadata: {
        response_sha256: sha256(c.response),
        trigger: event.trigger,
        parent_snapshot_id: '__pending__',
      },
      tier: 'long' as const,
      expiresAt: null,
    }))

  return [parent, ...children]
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @1scratch/memory test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/strategies/rag/ingestors.ts packages/memory/src/strategies/rag/ingestors.test.ts
git commit -m "feat(memory/rag): canvas_snapshot + section_snapshot ingestors with fan-out"
```

---

## Task 13: `rag` strategy — `vectorRetriever`

**Files:**
- Create: `packages/memory/src/strategies/rag/retriever.ts`
- Create: `packages/memory/src/strategies/rag/retriever.test.ts`

- [ ] **Step 1: Write failing test (mocked DB returns fixtures)**

```ts
import { describe, it, expect } from 'vitest'
import { vectorRetriever } from './retriever'
import type { RetrievalContext, StrategyCtx, MemoryItem } from '../../types'
import { makeFakeEmbedClient } from '../../embed'

const sampleRow = (id: string, text: string, scopeKind: string, scopeRefId: string | null, score = 0.9) => ({
  id, user_id: 'u', scope_kind: scopeKind, scope_ref_id: scopeRefId, source_kind: 'card_pair',
  source_ref_id: null, text, tags: [], metadata: {}, tier: 'long', expires_at: null,
  created_at: new Date(), updated_at: new Date(), score,
})

function mkCtx(rows: any[]): StrategyCtx {
  return {
    db: {
      async query(_strings: TemplateStringsArray, ..._vals: unknown[]) { return rows as any },
      async withTx<T>(fn: any) { return fn(this) },
    },
    embed: makeFakeEmbedClient(8, 'test/fake-model'),
    logger: { info() {}, warn() {}, error() {} },
  }
}

describe('vectorRetriever', () => {
  it('returns rows mapped to ScoredItem with strategy="rag"', async () => {
    const ctx = mkCtx([
      sampleRow('i1', 'hello world', 'user', null, 0.95),
      sampleRow('i2', 'another item', 'canvas', 'deadbeef-1234-4234-8234-123456789abc', 0.80),
    ])
    const rctx: RetrievalContext = {
      userId: 'u', currentScope: { kind: 'canvas', refId: 'deadbeef-1234-4234-8234-123456789abc' },
      queryText: 'hello', filter: {}, budget: { topK: 8, tokenBudget: 2000 },
    }
    const result = await vectorRetriever(rctx, ctx)
    expect(result).toHaveLength(2)
    expect(result[0]!.strategy).toBe('rag')
    expect(result[0]!.score).toBe(0.95)
  })

  it('uses pre-computed queryEmbedding when provided (local path)', async () => {
    const ctx = mkCtx([])
    const rctx: RetrievalContext = {
      userId: 'u', currentScope: { kind: 'user', refId: null },
      queryText: 'hello', queryEmbedding: new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]),
      filter: {}, budget: { topK: 8, tokenBudget: 2000 },
    }
    // Spy on embed.embed — should not be called because queryEmbedding is supplied.
    let called = false
    ctx.embed = { ...ctx.embed, embed: async () => { called = true; return [] as Float32Array[] } }
    await vectorRetriever(rctx, ctx)
    expect(called).toBe(false)
  })
})
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @1scratch/memory test`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import type { Retriever, RetrievalContext, ScoredItem, StrategyCtx, MemoryItem, ScopeKind } from '../../types'

// Format Float32Array as pgvector literal: '[0.1,0.2,...]'
function vecLiteral(v: Float32Array): string {
  return `[${Array.from(v).join(',')}]`
}

function rowToItem(r: any): MemoryItem {
  return {
    id: r.id,
    userId: r.user_id,
    scope: { kind: r.scope_kind as ScopeKind, refId: r.scope_ref_id },
    sourceKind: r.source_kind,
    sourceRefId: r.source_ref_id,
    text: r.text,
    tags: r.tags ?? [],
    metadata: r.metadata ?? {},
    tier: r.tier,
    expiresAt: r.expires_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

export const vectorRetriever: Retriever['retrieve'] = async (
  ctx: RetrievalContext,
  strat: StrategyCtx,
): Promise<ScoredItem[]> => {
  // Resolve query vector: caller-provided for `local` path, else embed server-side.
  let qvec: Float32Array
  if (ctx.queryEmbedding) {
    qvec = ctx.queryEmbedding
  } else {
    const [v] = await strat.embed.embed([ctx.queryText])
    if (!v) return []
    qvec = v
  }

  const topK = ctx.budget.topK
  const scope = ctx.currentScope

  // Build scope predicate covering all scopes at-or-above the current request context.
  // SQL template tag (strat.db.query is a sql-template callable in production).
  // NOTE: implementation assumes strat.db.query is a pg tagged template; the actual
  // adapter in apps/web wraps `sqlUser()` from '@/db/rls'.
  const modelId = strat.embed.modelId
  const rows = await strat.db.query<any>`
    WITH q AS (SELECT ${vecLiteral(qvec)}::vector AS v)
    SELECT mi.id, mi.user_id, mi.scope_kind, mi.scope_ref_id, mi.source_kind,
           mi.source_ref_id, mi.text, mi.tags, mi.metadata, mi.tier, mi.expires_at,
           mi.created_at, mi.updated_at,
           1 - (mv.embedding <=> q.v) AS score
      FROM memory_items mi
      JOIN memory_vectors mv ON mv.memory_item_id = mi.id
      CROSS JOIN q
     WHERE mi.user_id = ${ctx.userId}
       AND mv.embedding_model_id = ${modelId}
       AND (
         mi.scope_kind = 'user'
         ${scope.kind === 'workspace' || scope.kind === 'section' || scope.kind === 'canvas'
           ? strat.db.query`OR (mi.scope_kind = ${scope.kind} AND mi.scope_ref_id = ${scope.refId})` : ``}
       )
       AND (mi.expires_at IS NULL OR mi.expires_at > now())
     ORDER BY mv.embedding <=> q.v
     LIMIT ${topK}
  `

  return rows.map(r => ({ item: rowToItem(r), score: Number(r.score), strategy: 'rag' }))
}
```

> **Impl note for engineer:** the scope predicate as written uses nested template conditionals which `postgres-js` may not splice correctly. In the real `apps/web` adapter (Task 15), build the scope predicate as an array of `WHERE` fragments and join them with `UNION ALL` or use `sqlUser()`'s fragment-composition helper. Keep the test's happy-path assertions intact.

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @1scratch/memory test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/memory/src/strategies/rag/retriever.ts packages/memory/src/strategies/rag/retriever.test.ts
git commit -m "feat(memory/rag): vectorRetriever with scope-hierarchy SQL"
```

---

## Task 14: Register the `rag` strategy

**Files:**
- Create: `packages/memory/src/strategies/rag/index.ts`
- Modify: `packages/memory/src/index.ts`

- [ ] **Step 1: Write `strategies/rag/index.ts`**

```ts
import { z } from 'zod'
import type { MemoryStrategy } from '../../types'
import { cardPairIngestor, noteIngestor, canvasSnapshotIngestor, sectionSnapshotIngestor } from './ingestors'
import { vectorRetriever } from './retriever'

export const ragStrategy: MemoryStrategy = {
  id: 'rag',
  version: '1.0.0',
  ingestors: [
    { triggers: ['card_completed', 'card_saved'], produce: cardPairIngestor },
    { triggers: ['note_added'], produce: noteIngestor },
    { triggers: ['canvas_saved'], produce: canvasSnapshotIngestor },
    { triggers: ['section_saved'], produce: sectionSnapshotIngestor },
  ],
  retrievers: [{ retrieve: vectorRetriever }],
  configSchema: z.object({ topK: z.number().min(1).max(50).default(8) }),
  defaults: { enabled: true, weight: 1.0, params: { topK: 8 } },
}
```

- [ ] **Step 2: Update barrel**

Edit `packages/memory/src/index.ts` — add:

```ts
export { ragStrategy } from './strategies/rag'
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -w tsc -b`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/memory/src/strategies/rag/index.ts packages/memory/src/index.ts
git commit -m "feat(memory/rag): export ragStrategy"
```

---

## Task 15: `apps/web` — Memory Manager adapter + DB bindings

**Files:**
- Create: `apps/web/src/lib/memory/context.ts`
- Create: `apps/web/src/lib/memory/config-loader.ts`
- Create: `apps/web/src/lib/memory/strategy-loader.ts`
- Create: `apps/web/src/lib/memory/ingest-helpers.ts`
- Create: `apps/web/src/lib/memory/scope.ts`

- [ ] **Step 1: Write `config-loader.ts`**

```ts
import { sqlUser, withRls } from '@/db/rls'
import type { UserConfigView } from '@1scratch/memory'
import type { DbClient, InjectionPolicy, ScopeRef } from '@1scratch/memory'

export async function loadUserConfig(_db: DbClient, userId: string): Promise<UserConfigView> {
  const sql = sqlUser()
  const [userRows, configRows] = await withRls<[
    Array<{ memory_injection_policy: InjectionPolicy }>,
    Array<{ strategy: string; scope_kind: string; scope_ref_id: string | null; enabled: boolean; weight: number }>
  ]>(userId, [
    sql`SELECT memory_injection_policy FROM users WHERE id = ${userId}`,
    sql`SELECT strategy, scope_kind, scope_ref_id, enabled, weight
        FROM memory_strategy_config WHERE user_id = ${userId}`,
  ])

  const policy = userRows[0]?.memory_injection_policy ?? { format: 'system-message', topK: 8, tokenBudget: 2000 }

  // Index by (strategy, scope_kind, scope_ref_id)
  const byStrategy = new Map<string, { enabled: boolean; weight: number; scope: ScopeRef }[]>()
  for (const r of configRows) {
    const list = byStrategy.get(r.strategy) ?? []
    list.push({ enabled: r.enabled, weight: r.weight, scope: { kind: r.scope_kind as any, refId: r.scope_ref_id } })
    byStrategy.set(r.strategy, list)
  }

  function matches(scope: ScopeRef, entry: ScopeRef): boolean {
    return entry.kind === scope.kind && (entry.refId ?? null) === (scope.refId ?? null)
  }
  function mostSpecific(strategy: string, scope: ScopeRef): { enabled: boolean; weight: number } {
    const list = byStrategy.get(strategy) ?? []
    // Scope specificity: canvas > section > workspace > user
    const order = ['canvas', 'section', 'workspace', 'user']
    for (const kind of order) {
      const candidates = list.filter(e => e.scope.kind === kind)
      const exact = candidates.find(e => matches(scope, e.scope))
      if (exact) return { enabled: exact.enabled, weight: exact.weight }
      if (kind === 'user' && candidates.length) return { enabled: candidates[0]!.enabled, weight: candidates[0]!.weight }
    }
    return { enabled: true, weight: 1 }  // unconfigured defaults to enabled
  }

  return {
    enabledFor: (strategyId, scope) => mostSpecific(strategyId, scope).enabled,
    weightsFor: (scope) => {
      const out: Record<string, number> = {}
      for (const s of byStrategy.keys()) out[s] = mostSpecific(s, scope).weight
      return out
    },
    injectionPolicy: {
      format: policy.format,
      topK: policy.topK,
      tokenBudget: policy.tokenBudget,
    },
  }
}
```

- [ ] **Step 2: Write `scope.ts`**

```ts
import { sqlUser, withRls } from '@/db/rls'
import type { ScopeRef } from '@1scratch/memory'

/** Given a cardId, compute the {canvas, section, workspace} scope chain for retrieval context. */
export async function resolveScopeFromCard(userId: string, cardId: string): Promise<{
  current: ScopeRef
  workspaceId: string
  sectionId: string
  canvasId: string
}> {
  const sql = sqlUser()
  const [rows] = await withRls<[Array<{ canvas_id: string; section_id: string; workspace_id: string }>]>(userId, [
    sql`SELECT c.canvas_id, cv.section_id, cv.workspace_id
          FROM cards c JOIN canvases cv ON cv.id = c.canvas_id
         WHERE c.id = ${cardId}`,
  ])
  const r = rows[0]
  if (!r) throw new Error('card_not_found')
  return {
    current: { kind: 'canvas', refId: r.canvas_id },
    workspaceId: r.workspace_id,
    sectionId: r.section_id,
    canvasId: r.canvas_id,
  }
}
```

- [ ] **Step 3: Write `ingest-helpers.ts`**

```ts
import { sqlUser, withRls } from '@/db/rls'
import type { MemoryItem, MemoryItemDraft, StrategyCtx } from '@1scratch/memory'
import type { QuotaSnapshot } from '@1scratch/memory'

export async function loadQuotaSnapshot(_db: any, userId: string): Promise<QuotaSnapshot> {
  const sql = sqlUser()
  const [rows] = await withRls<[Array<{ tier: 'free' | 'pro'; memory_item_count: number; memory_bytes_count: string }>]>(userId, [
    sql`SELECT tier, memory_item_count, memory_bytes_count FROM users WHERE id = ${userId}`,
  ])
  const r = rows[0]
  if (!r) return { tier: 'free', itemCount: 0, bytesCount: 0 }
  return { tier: r.tier, itemCount: r.memory_item_count, bytesCount: Number(r.memory_bytes_count) }
}

export async function insertItem(ctx: StrategyCtx, draft: MemoryItemDraft): Promise<MemoryItem> {
  const sql = sqlUser()
  const [rows] = await withRls<[Array<{
    id: string; created_at: Date; updated_at: Date
  }>]>(draft.userId, [
    sql`INSERT INTO memory_items
        (user_id, scope_kind, scope_ref_id, source_kind, source_ref_id, text, tags, metadata, tier, expires_at)
        VALUES (${draft.userId}, ${draft.scope.kind}, ${draft.scope.refId},
                ${draft.sourceKind}, ${draft.sourceRefId}, ${draft.text},
                ${draft.tags}, ${draft.metadata as any}::jsonb, ${draft.tier}, ${draft.expiresAt})
        ON CONFLICT (user_id, source_kind, source_ref_id, (metadata->>'response_sha256'))
          WHERE source_kind = 'card_pair' AND metadata ? 'response_sha256'
        DO UPDATE SET updated_at = now()
        RETURNING id, created_at, updated_at`,
  ])
  const r = rows[0]
  if (!r) throw new Error('insert_failed')
  return { ...draft, id: r.id, createdAt: r.created_at, updatedAt: r.updated_at }
}

export async function embedAndStore(ctx: StrategyCtx, item: MemoryItem): Promise<void> {
  const [vec] = await ctx.embed.embed([item.text])
  if (!vec) return
  const modelId = ctx.embed.modelId
  const dim = ctx.embed.dim
  const literal = `[${Array.from(vec).join(',')}]`
  const sql = sqlUser()
  await withRls(item.userId, [
    sql`INSERT INTO memory_vectors (memory_item_id, embedding_model_id, dim, embedding)
        VALUES (${item.id}, ${modelId}, ${dim}, ${literal}::vector)
        ON CONFLICT (memory_item_id, embedding_model_id)
        DO UPDATE SET embedding = EXCLUDED.embedding, dim = EXCLUDED.dim`,
  ])
}

export async function incrementCounters(_db: any, userId: string, deltaItems: number, deltaBytes: number): Promise<void> {
  const sql = sqlUser()
  await withRls(userId, [
    sql`UPDATE users
          SET memory_item_count = memory_item_count + ${deltaItems},
              memory_bytes_count = memory_bytes_count + ${deltaBytes},
              updated_at = now()
        WHERE id = ${userId}`,
  ])
}
```

- [ ] **Step 4: Write `context.ts`**

```ts
import type { StrategyCtx, Logger, DbClient } from '@1scratch/memory'
import { resolveEmbedClient } from './embed-resolver'
import { makeLlmClient } from './llm-client'

export async function buildStrategyCtx(userId: string): Promise<StrategyCtx> {
  const logger: Logger = {
    info: (e, d) => console.log(`[memory] ${e}`, d),
    warn: (e, d) => console.warn(`[memory] ${e}`, d),
    error: (e, d) => console.error(`[memory] ${e}`, d),
  }
  const db: DbClient = {
    query: async () => { throw new Error('use sqlUser/withRls directly in adapters') },
    withTx: async (fn) => fn(db),
  }
  return {
    db,
    embed: await resolveEmbedClient(userId),
    llm: makeLlmClient(userId),
    logger,
  }
}
```

- [ ] **Step 5: Write `strategy-loader.ts`**

```ts
import { registry, ragStrategy } from '@1scratch/memory'

let booted = false
export function ensureStrategiesRegistered(): void {
  if (booted) return
  registry.register(ragStrategy)
  console.log('memory.strategy.registered strategy=rag version=1.0.0')
  booted = true
}
```

Call `ensureStrategiesRegistered()` at the top of each `/api/memory/*` route handler.

- [ ] **Step 6: Typecheck**

Run: `pnpm -w tsc -b`
Expected: PASS (some `as any` glue is OK; real SQL wiring is in these adapters).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/memory/
git commit -m "feat(memory/web): adapters for Memory Manager (config, quota, insert, embed-store, counters, scope, strategy-loader)"
```

---

## Task 16: Embed resolver (Gateway + BYOK + Local stub)

**Files:**
- Create: `apps/web/src/lib/memory/embed-resolver.ts`
- Modify: `apps/web/package.json` (add `@ai-sdk/gateway`)

- [ ] **Step 1: Add AI SDK Gateway dep**

```bash
cd apps/web
pnpm add @ai-sdk/gateway
```

- [ ] **Step 2: Write `embed-resolver.ts`**

```ts
import { embedMany } from 'ai'
import { gateway } from '@ai-sdk/gateway'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { sqlUser, withRls } from '@/db/rls'
import { loadDecryptedKey, findConnectionByProvider } from '@/lib/providers'
import type { EmbedClient } from '@1scratch/memory'
import { LocalEmbedRequired } from '@1scratch/memory'
import { recordUsage } from '@/lib/spend-cap'

interface UserEmbedPrefs {
  provider: 'gateway' | 'byok' | 'local' | null
  modelId: string | null
}

async function loadPrefs(userId: string): Promise<UserEmbedPrefs> {
  const sql = sqlUser()
  const [rows] = await withRls<[Array<{ memory_embedding_provider: string | null; memory_embedding_model_id: string | null }>]>(userId, [
    sql`SELECT memory_embedding_provider, memory_embedding_model_id FROM users WHERE id = ${userId}`,
  ])
  const r = rows[0]
  return { provider: (r?.memory_embedding_provider as any) ?? null, modelId: r?.memory_embedding_model_id ?? null }
}

function modelDim(modelId: string): number {
  if (modelId.endsWith('text-embedding-3-small')) return 1536
  if (modelId.endsWith('text-embedding-3-large')) return 3072
  if (modelId.includes('text-embedding-004')) return 768
  if (modelId.includes('nomic-embed-text')) return 768
  if (modelId.includes('mxbai-embed-large')) return 1024
  throw new Error(`unknown_embedding_model:${modelId}`)
}

export async function resolveEmbedClient(userId: string): Promise<EmbedClient> {
  const prefs = await loadPrefs(userId)
  if (!prefs.provider || !prefs.modelId) {
    // Default for Pro users: Gateway + text-embedding-3-small.
    return makeGatewayClient(userId, 'openai/text-embedding-3-small')
  }
  if (prefs.provider === 'gateway') return makeGatewayClient(userId, prefs.modelId)
  if (prefs.provider === 'byok') return makeByokClient(userId, prefs.modelId)
  if (prefs.provider === 'local') return makeLocalStubClient(prefs.modelId)
  throw new Error(`unknown_provider:${prefs.provider}`)
}

function makeGatewayClient(userId: string, modelId: string): EmbedClient {
  const dim = modelDim(modelId)
  return {
    providerId: 'gateway',
    modelId,
    dim,
    async embed(texts: string[]) {
      const { embeddings, usage } = await embedMany({
        model: gateway.textEmbeddingModel(modelId),
        values: texts,
      })
      // Approximate cost: input tokens estimated as usage.tokens if available, else chars/4.
      const tokens = usage?.tokens ?? Math.ceil(texts.reduce((a, t) => a + t.length, 0) / 4)
      await recordUsage({
        userId, provider: 'gateway', model: modelId,
        inputTokens: tokens, outputTokens: 0,
        cardId: null, kind: 'embedding',
      })
      return embeddings.map(e => Float32Array.from(e))
    },
  }
}

async function makeByokClient(userId: string, modelId: string): Promise<EmbedClient> {
  // modelId like 'openai/text-embedding-3-small' — provider is the prefix before '/'.
  const [provider, ...rest] = modelId.split('/')
  const realModel = rest.join('/')
  const conn = await findConnectionByProvider(userId, provider as any)
  if (!conn) throw new Error(`byok_no_connection:${provider}`)
  const apiKey = await loadDecryptedKey(conn.id)
  const dim = modelDim(modelId)

  let embedFn: (texts: string[]) => Promise<number[][]>
  if (provider === 'openai') {
    const client = createOpenAI({ apiKey })
    embedFn = async (texts) => {
      const { embeddings } = await embedMany({ model: client.textEmbeddingModel(realModel), values: texts })
      return embeddings
    }
  } else if (provider === 'google') {
    const client = createGoogleGenerativeAI({ apiKey })
    embedFn = async (texts) => {
      const { embeddings } = await embedMany({ model: client.textEmbeddingModel(realModel), values: texts })
      return embeddings
    }
  } else {
    throw new Error(`byok_provider_unsupported_for_embed:${provider}`)
  }

  return {
    providerId: 'byok',
    modelId,
    dim,
    async embed(texts: string[]) {
      const out = await embedFn(texts)
      await recordUsage({
        userId, provider, model: modelId,
        inputTokens: Math.ceil(texts.reduce((a, t) => a + t.length, 0) / 4), outputTokens: 0,
        cardId: null, kind: 'embedding',
        costMicrosOverride: 0n, // BYOK — user pays upstream
      } as any)
      return out.map(e => Float32Array.from(e))
    },
  }
}

function makeLocalStubClient(modelId: string): EmbedClient {
  const dim = modelDim(modelId)
  return {
    providerId: 'local',
    modelId,
    dim,
    async embed() {
      throw new LocalEmbedRequired()
    },
  }
}
```

- [ ] **Step 3: Extend `recordUsage` signature**

Edit `apps/web/src/lib/spend-cap.ts` — extend `recordUsage` params:

```ts
// Add to params:
kind?: 'completion' | 'embedding'
costMicrosOverride?: bigint

// In body, replace cost calc:
const cost = args.costMicrosOverride ?? registryEstimate(args.model, args.inputTokens, args.outputTokens)

// In the INSERT, add `kind`:
sql`INSERT INTO ai_usage
    (user_id, usage_date, provider, model, input_tokens, output_tokens, cost_micros, card_id, kind)
    VALUES (${args.userId}, ${utcDate()}, ${args.provider}, ${args.model},
            ${args.inputTokens}, ${args.outputTokens},
            ${cost.toString()}::bigint, ${args.cardId ?? null}, ${args.kind ?? 'completion'})`,
```

- [ ] **Step 4: Typecheck**

Run: `pnpm -w tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/memory/embed-resolver.ts apps/web/src/lib/spend-cap.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(memory/web): embed resolver (gateway | byok | local stub) + ai_usage.kind"
```

---

## Task 17: LLM client for snapshot summaries

**Files:**
- Create: `apps/web/src/lib/memory/llm-client.ts`

- [ ] **Step 1: Write**

```ts
import type { LlmClient } from '@1scratch/memory'
import { resolveSlot } from '@/lib/model-slots'
import { loadDecryptedKey } from '@/lib/providers'
import { generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

export function makeLlmClient(userId: string): LlmClient {
  return {
    async summarize(texts: string[], opts?: { maxTokens?: number }): Promise<string> {
      // Use slot 0 by convention, fall back to 1 / 2 if slot 0 is empty.
      let resolved: { providerConnectionId: string; modelId: string; provider: string } | null = null
      for (const slot of [0, 1, 2]) {
        const r = await resolveSlot(userId, slot)
        if (r) { resolved = r; break }
      }
      if (!resolved) throw new Error('no_slot_for_summary')

      const apiKey = await loadDecryptedKey(resolved.providerConnectionId)
      const prompt = `Summarize the following prompt/response pairs into a single coherent paragraph (max 300 words):\n\n${texts.slice(0, 500).join('\n---\n')}`
      const model =
        resolved.provider === 'anthropic' ? createAnthropic({ apiKey })(resolved.modelId) :
        resolved.provider === 'openai'    ? createOpenAI({ apiKey })(resolved.modelId) :
        resolved.provider === 'google'    ? createGoogleGenerativeAI({ apiKey })(resolved.modelId) :
        (() => { throw new Error(`unsupported_summary_provider:${resolved.provider}`) })()

      const { text } = await generateText({ model, prompt, maxTokens: opts?.maxTokens ?? 400 })
      return text
    },
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -w tsc -b`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/memory/llm-client.ts
git commit -m "feat(memory/web): LLM client for snapshot summaries"
```

---

## Task 18: POST /api/memory/ingest

**Files:**
- Create: `apps/web/src/app/api/memory/ingest/route.ts`
- Create: `apps/web/tests/integration/memory-ingest.test.ts`

- [ ] **Step 1: Write failing integration test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { sqlAdmin } from '@/db/rls'
import { POST } from '@/app/api/memory/ingest/route'

const USER = 'user_m1a_ingest'

beforeAll(async () => {
  const admin = sqlAdmin()
  await admin`DELETE FROM memory_items WHERE user_id = ${USER}`
  await admin`INSERT INTO users (id, email, tier, memory_embedding_provider, memory_embedding_model_id)
              VALUES (${USER}, ${USER + '@test.local'}, 'pro', 'gateway', 'openai/text-embedding-3-small')
              ON CONFLICT (id) DO UPDATE SET tier = 'pro',
                memory_embedding_provider = 'gateway',
                memory_embedding_model_id = 'openai/text-embedding-3-small',
                memory_item_count = 0, memory_bytes_count = 0`
})

function req(body: unknown): Request {
  return new Request('http://localhost/api/memory/ingest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer test:${USER}` },
    body: JSON.stringify(body),
  })
}

describe('POST /api/memory/ingest', () => {
  it('creates a note memory_item, bumps counters, returns the item', async () => {
    const res = await POST(req({
      trigger: 'note_added',
      scope: { kind: 'user', refId: null },
      payload: { text: 'remember the alamo', tags: ['history'] },
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].sourceKind).toBe('note')
    expect(body.items[0].text).toBe('remember the alamo')

    // Counters bumped
    const admin = sqlAdmin()
    const [u] = await admin`SELECT memory_item_count, memory_bytes_count FROM users WHERE id = ${USER}`
    expect(u.memory_item_count).toBe(1)
    expect(Number(u.memory_bytes_count)).toBe('remember the alamo'.length)
  })
})
```

- [ ] **Step 2: Run, verify fail (route not defined)**

Run: `pnpm --filter @1scratch/web test tests/integration/memory-ingest.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write route**

```ts
// apps/web/src/app/api/memory/ingest/route.ts
import { z } from 'zod'
import { NextResponse } from 'next/server'
import { resolveAuthedUserId } from '@/lib/auth-resolver'  // extend if needed, else use auth() + test token bridge
import { MemoryManager, QuotaError } from '@1scratch/memory'
import { ensureStrategiesRegistered } from '@/lib/memory/strategy-loader'
import { buildStrategyCtx } from '@/lib/memory/context'
import { loadUserConfig } from '@/lib/memory/config-loader'
import { loadQuotaSnapshot, insertItem, embedAndStore, incrementCounters } from '@/lib/memory/ingest-helpers'

export const runtime = 'nodejs'
export const maxDuration = 300

const BodySchema = z.object({
  trigger: z.string().min(1),
  scope: z.object({
    kind: z.enum(['user', 'workspace', 'section', 'canvas']),
    refId: z.string().uuid().nullable(),
  }),
  payload: z.unknown(),
})

export async function POST(req: Request) {
  ensureStrategiesRegistered()
  const userId = await resolveAuthedUserId(req)
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })

  const ctx = await buildStrategyCtx(userId)
  const mgr = new MemoryManager(ctx, {
    loadUserConfig: (_db, u) => loadUserConfig(_db, u),
    loadQuotaSnapshot,
    insertItem,
    embedAndStore,
    incrementCounters,
  })

  try {
    const items = await mgr.ingest({
      userId,
      scope: parsed.data.scope as any,
      trigger: parsed.data.trigger,
      payload: parsed.data.payload,
    })
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof QuotaError) {
      const status = e.which === 'not_pro' ? 402 : 402
      return NextResponse.json({ error: 'memory_quota_exceeded', which: e.which }, { status })
    }
    console.error('memory.ingest.failed', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
```

> **Note:** `resolveAuthedUserId(req)` is the Phase 3a auth-resolver function. If it doesn't exist at this branch's base, add a minimal version: `async function resolveAuthedUserId(req: Request): Promise<string | null> { const { userId } = await auth(); return userId }` and a test-token shortcut for the integration harness (`Authorization: Bearer test:<userId>` → parse and return the userId string). Follow the pattern used by `apps/web/tests/integration/rls.test.ts`.

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter @1scratch/web test tests/integration/memory-ingest.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/memory/ingest/route.ts apps/web/tests/integration/memory-ingest.test.ts
git commit -m "feat(memory/api): POST /api/memory/ingest"
```

---

## Task 19: POST /api/memory/ingest/client-embed

**Files:**
- Create: `apps/web/src/app/api/memory/ingest/client-embed/route.ts`
- Create: `apps/web/tests/integration/memory-client-embed.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { sqlAdmin } from '@/db/rls'
import { POST } from '@/app/api/memory/ingest/client-embed/route'

const USER = 'user_m1a_local'

beforeAll(async () => {
  const admin = sqlAdmin()
  await admin`DELETE FROM memory_items WHERE user_id = ${USER}`
  await admin`INSERT INTO users (id, email, tier, memory_embedding_provider, memory_embedding_model_id)
              VALUES (${USER}, ${USER + '@t.local'}, 'pro', 'local', 'ollama/nomic-embed-text')
              ON CONFLICT (id) DO UPDATE SET tier = 'pro',
                memory_embedding_provider = 'local',
                memory_embedding_model_id = 'ollama/nomic-embed-text',
                memory_item_count = 0, memory_bytes_count = 0`
})

function req(body: unknown): Request {
  return new Request('http://localhost/api/memory/ingest/client-embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer test:${USER}` },
    body: JSON.stringify(body),
  })
}

describe('POST /api/memory/ingest/client-embed', () => {
  it('writes item + vector when dim matches', async () => {
    const vec = Array.from({ length: 768 }, () => 0.01)
    const res = await POST(req({
      trigger: 'note_added',
      scope: { kind: 'user', refId: null },
      payload: { text: 'offline note', tags: [] },
      vectors: [{ text: 'offline note', embedding: vec, dim: 768, embedding_model_id: 'ollama/nomic-embed-text' }],
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items).toHaveLength(1)
  })

  it('rejects mismatched dim with 400', async () => {
    const vec = Array.from({ length: 1536 }, () => 0.01)
    const res = await POST(req({
      trigger: 'note_added',
      scope: { kind: 'user', refId: null },
      payload: { text: 'mismatched', tags: [] },
      vectors: [{ text: 'mismatched', embedding: vec, dim: 1536, embedding_model_id: 'ollama/nomic-embed-text' }],
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/dim/)
  })
})
```

- [ ] **Step 2: Verify fail**

Run the specific test; FAIL.

- [ ] **Step 3: Write route**

```ts
// apps/web/src/app/api/memory/ingest/client-embed/route.ts
import { z } from 'zod'
import { NextResponse } from 'next/server'
import { resolveAuthedUserId } from '@/lib/auth-resolver'
import { MemoryManager, QuotaError } from '@1scratch/memory'
import { ensureStrategiesRegistered } from '@/lib/memory/strategy-loader'
import { buildStrategyCtx } from '@/lib/memory/context'
import { loadUserConfig } from '@/lib/memory/config-loader'
import { loadQuotaSnapshot, insertItem, incrementCounters } from '@/lib/memory/ingest-helpers'
import { sqlUser, withRls } from '@/db/rls'

export const runtime = 'nodejs'
export const maxDuration = 300

const VectorSchema = z.object({
  text: z.string().min(1),
  embedding: z.array(z.number()).min(1),
  dim: z.number().int().positive(),
  embedding_model_id: z.string(),
})

const BodySchema = z.object({
  trigger: z.string().min(1),
  scope: z.object({ kind: z.enum(['user', 'workspace', 'section', 'canvas']), refId: z.string().uuid().nullable() }),
  payload: z.unknown(),
  vectors: z.array(VectorSchema).min(1),
})

export async function POST(req: Request) {
  ensureStrategiesRegistered()
  const userId = await resolveAuthedUserId(req)
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  const body = parsed.data

  const ctx = await buildStrategyCtx(userId)
  // Validate every vector matches the user's registered dim + model.
  for (const v of body.vectors) {
    if (v.dim !== ctx.embed.dim) return NextResponse.json({ error: 'dim_mismatch', expected: ctx.embed.dim, got: v.dim }, { status: 400 })
    if (v.embedding_model_id !== ctx.embed.modelId) return NextResponse.json({ error: 'model_mismatch', expected: ctx.embed.modelId, got: v.embedding_model_id }, { status: 400 })
    if (v.embedding.length !== v.dim) return NextResponse.json({ error: 'vector_length_mismatch' }, { status: 400 })
  }

  const mgr = new MemoryManager(ctx, {
    loadUserConfig,
    loadQuotaSnapshot,
    insertItem,
    // Override embedAndStore to use pre-computed vectors rather than calling ctx.embed (which would throw).
    embedAndStore: async (_ctx, item) => {
      const match = body.vectors.find(v => v.text === item.text)
      if (!match) return
      const literal = `[${match.embedding.join(',')}]`
      const sql = sqlUser()
      await withRls(userId, [
        sql`INSERT INTO memory_vectors (memory_item_id, embedding_model_id, dim, embedding)
            VALUES (${item.id}, ${match.embedding_model_id}, ${match.dim}, ${literal}::vector)
            ON CONFLICT (memory_item_id, embedding_model_id)
              DO UPDATE SET embedding = EXCLUDED.embedding, dim = EXCLUDED.dim`,
      ])
    },
    incrementCounters,
  })

  try {
    const items = await mgr.ingest({ userId, scope: body.scope as any, trigger: body.trigger, payload: body.payload })
    return NextResponse.json({ items })
  } catch (e) {
    if (e instanceof QuotaError) return NextResponse.json({ error: 'memory_quota_exceeded', which: e.which }, { status: 402 })
    console.error('memory.ingest.client-embed.failed', e)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Verify pass**

Run: `pnpm --filter @1scratch/web test tests/integration/memory-client-embed.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/memory/ingest/client-embed/route.ts apps/web/tests/integration/memory-client-embed.test.ts
git commit -m "feat(memory/api): POST /api/memory/ingest/client-embed with dim validation"
```

---

## Task 20: POST /api/memory/search

**Files:**
- Create: `apps/web/src/app/api/memory/search/route.ts`
- Create: `apps/web/tests/integration/memory-search.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { sqlAdmin } from '@/db/rls'
import { POST as ingest } from '@/app/api/memory/ingest/route'
import { POST as search } from '@/app/api/memory/search/route'

const USER = 'user_m1a_search'

beforeAll(async () => {
  const admin = sqlAdmin()
  await admin`DELETE FROM memory_items WHERE user_id = ${USER}`
  await admin`INSERT INTO users (id, email, tier, memory_embedding_provider, memory_embedding_model_id,
              memory_item_count, memory_bytes_count)
              VALUES (${USER}, ${USER + '@t.local'}, 'pro', 'gateway', 'openai/text-embedding-3-small', 0, 0)
              ON CONFLICT (id) DO UPDATE SET tier = 'pro',
                memory_embedding_provider = 'gateway',
                memory_embedding_model_id = 'openai/text-embedding-3-small',
                memory_item_count = 0, memory_bytes_count = 0`

  // Seed two items — one with term "alpha", one with "zeta".
  for (const text of ['alpha cat', 'zeta dog']) {
    await ingest(new Request('http://localhost/api/memory/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer test:${USER}` },
      body: JSON.stringify({ trigger: 'note_added', scope: { kind: 'user', refId: null }, payload: { text, tags: [] } }),
    }))
  }
})

describe('POST /api/memory/search', () => {
  it('returns ScoredItems and an injected block', async () => {
    const res = await search(new Request('http://localhost/api/memory/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer test:${USER}` },
      body: JSON.stringify({
        queryText: 'alpha',
        filter: {},
        budget: { topK: 8, tokenBudget: 2000 },
        currentScope: { kind: 'user', refId: null },
      }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.injected).toBeDefined()
  })
})
```

- [ ] **Step 2: Verify fail**

Run that test; FAIL.

- [ ] **Step 3: Write route**

```ts
// apps/web/src/app/api/memory/search/route.ts
import { z } from 'zod'
import { NextResponse } from 'next/server'
import { resolveAuthedUserId } from '@/lib/auth-resolver'
import { MemoryManager } from '@1scratch/memory'
import { ensureStrategiesRegistered } from '@/lib/memory/strategy-loader'
import { buildStrategyCtx } from '@/lib/memory/context'
import { loadUserConfig } from '@/lib/memory/config-loader'
import { loadQuotaSnapshot, insertItem, embedAndStore, incrementCounters } from '@/lib/memory/ingest-helpers'

export const runtime = 'nodejs'
export const maxDuration = 60

const BodySchema = z.object({
  queryText: z.string().min(1),
  queryEmbedding: z.array(z.number()).optional(),
  filter: z.object({
    tags: z.array(z.string()).optional(),
    sourceKinds: z.array(z.string()).optional(),
    strategies: z.array(z.string()).optional(),
    excludeItemIds: z.array(z.string()).optional(),
  }).default({}),
  budget: z.object({ topK: z.number().int().min(1).max(50), tokenBudget: z.number().int().min(1).max(8000) }),
  currentScope: z.object({ kind: z.enum(['user', 'workspace', 'section', 'canvas']), refId: z.string().uuid().nullable() }),
})

export async function POST(req: Request) {
  ensureStrategiesRegistered()
  const userId = await resolveAuthedUserId(req)
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })

  const ctx = await buildStrategyCtx(userId)
  const mgr = new MemoryManager(ctx, {
    loadUserConfig,
    loadQuotaSnapshot,
    insertItem,
    embedAndStore,
    incrementCounters,
  })

  const result = await mgr.retrieve({
    userId,
    currentScope: parsed.data.currentScope as any,
    queryText: parsed.data.queryText,
    queryEmbedding: parsed.data.queryEmbedding ? Float32Array.from(parsed.data.queryEmbedding) : undefined,
    filter: parsed.data.filter,
    budget: parsed.data.budget,
  })

  return NextResponse.json(result)
}
```

- [ ] **Step 4: Verify pass**

Run the search integration test.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/memory/search/route.ts apps/web/tests/integration/memory-search.test.ts
git commit -m "feat(memory/api): POST /api/memory/search"
```

---

## Task 21: GET/DELETE /api/memory/items + /:id

**Files:**
- Create: `apps/web/src/app/api/memory/items/route.ts`
- Create: `apps/web/src/app/api/memory/items/[id]/route.ts`

- [ ] **Step 1: Write `items/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { resolveAuthedUserId } from '@/lib/auth-resolver'
import { sqlUser, withRls } from '@/db/rls'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const userId = await resolveAuthedUserId(req)
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const url = new URL(req.url)
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200)
  const cursor = url.searchParams.get('cursor')
  const source = url.searchParams.get('source')

  const sql = sqlUser()
  const [rows] = await withRls<[Array<any>]>(userId, [
    sql`SELECT id, scope_kind, scope_ref_id, source_kind, source_ref_id, text, tags, metadata, tier, expires_at, created_at
          FROM memory_items
         WHERE user_id = ${userId}
           ${source ? sql`AND source_kind = ${source}` : sql``}
           ${cursor ? sql`AND created_at < ${cursor}` : sql``}
         ORDER BY created_at DESC
         LIMIT ${limit}`,
  ])
  const nextCursor = rows.length === limit ? rows[rows.length - 1]?.created_at : null
  return NextResponse.json({ items: rows, nextCursor })
}

export async function DELETE(req: Request) {
  const userId = await resolveAuthedUserId(req)
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const url = new URL(req.url)
  const scope = url.searchParams.get('scope')
  const source = url.searchParams.get('source')

  const sql = sqlUser()
  const [rows] = await withRls<[Array<{ deleted_count: string }>]>(userId, [
    sql`WITH deleted AS (
          DELETE FROM memory_items
           WHERE user_id = ${userId}
             ${scope ? sql`AND scope_kind = ${scope}` : sql``}
             ${source ? sql`AND source_kind = ${source}` : sql``}
           RETURNING length(text) AS len
        )
        SELECT count(*) AS deleted_count FROM deleted`,
  ])
  const n = Number(rows[0]?.deleted_count ?? 0)
  // Reset counters from truth.
  await withRls(userId, [
    sql`UPDATE users u SET
          memory_item_count = (SELECT count(*) FROM memory_items WHERE user_id = ${userId}),
          memory_bytes_count = (SELECT coalesce(sum(length(text)), 0) FROM memory_items WHERE user_id = ${userId})
        WHERE u.id = ${userId}`,
  ])
  return NextResponse.json({ deleted_count: n })
}
```

- [ ] **Step 2: Write `items/[id]/route.ts`**

```ts
import { NextResponse } from 'next/server'
import { resolveAuthedUserId } from '@/lib/auth-resolver'
import { sqlUser, withRls } from '@/db/rls'

export const runtime = 'nodejs'

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const userId = await resolveAuthedUserId(req)
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const sql = sqlUser()
  await withRls(userId, [
    sql`DELETE FROM memory_items WHERE id = ${id} AND user_id = ${userId}`,
    sql`UPDATE users SET
          memory_item_count = (SELECT count(*) FROM memory_items WHERE user_id = ${userId}),
          memory_bytes_count = (SELECT coalesce(sum(length(text)), 0) FROM memory_items WHERE user_id = ${userId})
        WHERE id = ${userId}`,
  ])
  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -w tsc -b`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/memory/items
git commit -m "feat(memory/api): GET /api/memory/items (paginated) + DELETE (bulk + :id)"
```

---

## Task 22: GET/PUT /api/memory/config

**Files:**
- Create: `apps/web/src/app/api/memory/config/route.ts`

- [ ] **Step 1: Write**

```ts
import { z } from 'zod'
import { NextResponse } from 'next/server'
import { resolveAuthedUserId } from '@/lib/auth-resolver'
import { sqlUser, withRls } from '@/db/rls'

export const runtime = 'nodejs'

const InjectionPolicySchema = z.object({
  format: z.enum(['system-message', 'user-xml-block']),
  topK: z.number().int().min(1).max(50),
  tokenBudget: z.number().int().min(1).max(8000),
})

const StrategySchema = z.object({
  strategy: z.string().min(1),
  scope_kind: z.enum(['user', 'workspace', 'section', 'canvas', 'task']),
  scope_ref_id: z.string().uuid().nullable(),
  enabled: z.boolean(),
  weight: z.number().finite(),
  params: z.record(z.string(), z.unknown()).default({}),
})

const PutSchema = z.object({
  embedding_provider: z.enum(['gateway', 'byok', 'local']).optional(),
  embedding_model_id: z.string().optional(),
  injection_policy: InjectionPolicySchema.optional(),
  strategies: z.array(StrategySchema).optional(),
})

export async function GET(req: Request) {
  const userId = await resolveAuthedUserId(req)
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const sql = sqlUser()
  const [userRows, strategyRows] = await withRls<[Array<any>, Array<any>]>(userId, [
    sql`SELECT memory_embedding_provider, memory_embedding_model_id, memory_injection_policy FROM users WHERE id = ${userId}`,
    sql`SELECT strategy, scope_kind, scope_ref_id, enabled, weight, params FROM memory_strategy_config WHERE user_id = ${userId}`,
  ])
  return NextResponse.json({
    embedding_provider: userRows[0]?.memory_embedding_provider ?? null,
    embedding_model_id: userRows[0]?.memory_embedding_model_id ?? null,
    injection_policy: userRows[0]?.memory_injection_policy ?? null,
    strategies: strategyRows,
  })
}

export async function PUT(req: Request) {
  const userId = await resolveAuthedUserId(req)
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const parsed = PutSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })

  const { embedding_provider, embedding_model_id, injection_policy, strategies } = parsed.data
  const sql = sqlUser()

  // Single-model-per-user lock: if embedding model/provider changes, clear memory + vectors.
  const switchingProvider = embedding_provider !== undefined || embedding_model_id !== undefined
  if (switchingProvider) {
    await withRls(userId, [
      sql`DELETE FROM memory_items WHERE user_id = ${userId}`,  // cascades memory_vectors via FK
      sql`UPDATE users SET memory_item_count = 0, memory_bytes_count = 0,
            memory_embedding_provider = ${embedding_provider ?? null},
            memory_embedding_model_id = ${embedding_model_id ?? null}
          WHERE id = ${userId}`,
    ])
  }

  if (injection_policy) {
    await withRls(userId, [
      sql`UPDATE users SET memory_injection_policy = ${injection_policy as any}::jsonb WHERE id = ${userId}`,
    ])
  }

  if (strategies) {
    for (const s of strategies) {
      await withRls(userId, [
        sql`INSERT INTO memory_strategy_config (user_id, scope_kind, scope_ref_id, strategy, enabled, weight, params)
            VALUES (${userId}, ${s.scope_kind}, ${s.scope_ref_id}, ${s.strategy}, ${s.enabled}, ${s.weight}, ${s.params as any}::jsonb)
            ON CONFLICT (user_id, scope_kind, scope_ref_id, strategy)
            DO UPDATE SET enabled = EXCLUDED.enabled, weight = EXCLUDED.weight, params = EXCLUDED.params, updated_at = now()`,
      ])
    }
  }

  return GET(req)
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -w tsc -b`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/memory/config/route.ts
git commit -m "feat(memory/api): GET/PUT /api/memory/config with embed-provider switch clears memory"
```

---

## Task 23: GET /api/memory/usage

**Files:**
- Create: `apps/web/src/app/api/memory/usage/route.ts`

- [ ] **Step 1: Write**

```ts
import { NextResponse } from 'next/server'
import { resolveAuthedUserId } from '@/lib/auth-resolver'
import { sqlUser, withRls } from '@/db/rls'
import { PRO_ITEM_CAP, PRO_BYTE_CAP } from '@1scratch/memory'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const userId = await resolveAuthedUserId(req)
  if (!userId) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })
  const sql = sqlUser()
  const [rows] = await withRls<[Array<{ tier: 'free' | 'pro'; memory_item_count: number; memory_bytes_count: string }>]>(userId, [
    sql`SELECT tier, memory_item_count, memory_bytes_count FROM users WHERE id = ${userId}`,
  ])
  const r = rows[0]
  return NextResponse.json({
    tier: r?.tier ?? 'free',
    item_count: r?.memory_item_count ?? 0,
    bytes_count: Number(r?.memory_bytes_count ?? 0),
    caps: {
      item_cap: PRO_ITEM_CAP,
      byte_cap: PRO_BYTE_CAP,
    },
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -w tsc -b`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/memory/usage/route.ts
git commit -m "feat(memory/api): GET /api/memory/usage"
```

---

## Task 24: Tier gate + quota integration test

**Files:**
- Create: `apps/web/tests/integration/memory-tier.test.ts`
- Create: `apps/web/tests/integration/memory-quota.test.ts`

- [ ] **Step 1: Write `memory-tier.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { sqlAdmin } from '@/db/rls'
import { POST as ingest } from '@/app/api/memory/ingest/route'

const USER = 'user_m1a_free'

beforeAll(async () => {
  const admin = sqlAdmin()
  await admin`INSERT INTO users (id, email, tier) VALUES (${USER}, ${USER + '@t.local'}, 'free')
              ON CONFLICT (id) DO UPDATE SET tier = 'free'`
})

describe('tier gate', () => {
  it('returns 402 with which=not_pro on ingest for free user', async () => {
    const res = await ingest(new Request('http://localhost/api/memory/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer test:${USER}` },
      body: JSON.stringify({ trigger: 'note_added', scope: { kind: 'user', refId: null }, payload: { text: 'hi' } }),
    }))
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.which).toBe('not_pro')
  })
})
```

- [ ] **Step 2: Write `memory-quota.test.ts`**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { sqlAdmin } from '@/db/rls'
import { POST as ingest } from '@/app/api/memory/ingest/route'

const USER = 'user_m1a_quota'

beforeAll(async () => {
  const admin = sqlAdmin()
  await admin`INSERT INTO users (id, email, tier, memory_embedding_provider, memory_embedding_model_id,
              memory_item_count, memory_bytes_count)
              VALUES (${USER}, ${USER + '@t.local'}, 'pro', 'gateway', 'openai/text-embedding-3-small', 50000, 0)
              ON CONFLICT (id) DO UPDATE SET tier = 'pro',
                memory_embedding_provider = 'gateway',
                memory_embedding_model_id = 'openai/text-embedding-3-small',
                memory_item_count = 50000`
})

describe('quota gate', () => {
  it('returns 402 with which=item_cap at 50k', async () => {
    const res = await ingest(new Request('http://localhost/api/memory/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer test:${USER}` },
      body: JSON.stringify({ trigger: 'note_added', scope: { kind: 'user', refId: null }, payload: { text: 'hi there' } }),
    }))
    expect(res.status).toBe(402)
    const body = await res.json()
    expect(body.which).toBe('item_cap')
  })
})
```

- [ ] **Step 3: Run + commit**

```bash
pnpm --filter @1scratch/web test tests/integration/memory-tier.test.ts tests/integration/memory-quota.test.ts
```
Expected: PASS.

```bash
git add apps/web/tests/integration/memory-tier.test.ts apps/web/tests/integration/memory-quota.test.ts
git commit -m "test(memory): tier gate + quota caps integration coverage"
```

---

## Task 25: RLS cross-tenant integration test

**Files:**
- Create: `apps/web/tests/integration/memory-rls.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { sqlAdmin, withRls, sqlUser } from '@/db/rls'

const A = 'user_m1a_rls_a'
const B = 'user_m1a_rls_b'

beforeAll(async () => {
  const admin = sqlAdmin()
  for (const u of [A, B]) {
    await admin`INSERT INTO users (id, email, tier, memory_embedding_provider, memory_embedding_model_id)
                VALUES (${u}, ${u + '@t.local'}, 'pro', 'gateway', 'openai/text-embedding-3-small')
                ON CONFLICT (id) DO UPDATE SET tier = 'pro'`
  }
  await admin`INSERT INTO memory_items (user_id, scope_kind, source_kind, text)
              VALUES (${A}, 'user', 'note', 'A-secret'),
                     (${B}, 'user', 'note', 'B-secret')`
})

describe('memory RLS', () => {
  it('user A cannot see user B rows', async () => {
    const sql = sqlUser()
    const [rows] = await withRls<[Array<{ text: string }>]>(A, [sql`SELECT text FROM memory_items`])
    expect(rows.map(r => r.text)).toEqual(['A-secret'])
  })

  it('user B cannot see user A rows', async () => {
    const sql = sqlUser()
    const [rows] = await withRls<[Array<{ text: string }>]>(B, [sql`SELECT text FROM memory_items`])
    expect(rows.map(r => r.text)).toEqual(['B-secret'])
  })
})
```

- [ ] **Step 2: Run + commit**

Run: `pnpm --filter @1scratch/web test tests/integration/memory-rls.test.ts`
Expected: PASS.

```bash
git add apps/web/tests/integration/memory-rls.test.ts
git commit -m "test(memory): RLS cross-tenant isolation"
```

---

## Task 26: `aiStreamWorkflow` — `retrieveMemory` step

**Files:**
- Modify: `apps/web/src/workflows/ai-stream.ts`

- [ ] **Step 1: Extend `StreamInput`**

In `apps/web/src/workflows/ai-stream.ts`, add optional fields:

```ts
export interface StreamInput {
  // ... existing ...
  memoryPolicy?: 'auto' | 'off'
  memoryFilter?: { tags?: string[]; sourceKinds?: string[]; strategies?: string[]; excludeItemIds?: string[] }
  memoryBudget?: { topK: number; tokenBudget: number }
}
```

- [ ] **Step 2: Add `retrieveMemory` step before `buildAttemptChain`**

```ts
import type { InjectedMemory } from '@1scratch/memory'
import { MemoryManager } from '@1scratch/memory'
import { ensureStrategiesRegistered } from '@/lib/memory/strategy-loader'
import { buildStrategyCtx } from '@/lib/memory/context'
import { loadUserConfig } from '@/lib/memory/config-loader'
import { loadQuotaSnapshot, insertItem, embedAndStore, incrementCounters } from '@/lib/memory/ingest-helpers'
import { resolveScopeFromCard } from '@/lib/memory/scope'

async function retrieveMemory(input: StreamInput): Promise<InjectedMemory | null> {
  'use step'
  if (input.memoryPolicy === 'off') return null
  const sql = sqlUser()
  const [rows] = await withRls<[Array<{ tier: 'free' | 'pro' }>]>(input.userId, [
    sql`SELECT tier FROM users WHERE id = ${input.userId}`,
  ])
  if (rows[0]?.tier !== 'pro') return null

  ensureStrategiesRegistered()
  const ctx = await buildStrategyCtx(input.userId)
  const mgr = new MemoryManager(ctx, {
    loadUserConfig, loadQuotaSnapshot, insertItem, embedAndStore, incrementCounters,
  })

  let currentScope: { kind: 'user' | 'canvas' | 'section' | 'workspace'; refId: string | null } = { kind: 'user', refId: null }
  if (input.cardId) {
    try {
      const r = await resolveScopeFromCard(input.userId, input.cardId)
      currentScope = r.current
    } catch { /* swallow; fall back to user scope */ }
  }

  try {
    const { injected } = await mgr.retrieve({
      userId: input.userId,
      currentScope,
      queryText: input.prompt,
      filter: input.memoryFilter ?? {},
      budget: input.memoryBudget ?? { topK: 8, tokenBudget: 2000 },
    })
    return injected
  } catch (e) {
    ctx.logger.warn('memory.retrieval_skipped', { error: String(e) })
    return null
  }
}
```

- [ ] **Step 3: Feed injection into `runAttempt`**

Wherever `runAttempt` constructs its messages array:

```ts
// Before building messages array:
const injected = await retrieveMemory(input)

// When building:
const systemMessages: Array<{ role: 'system'; content: string }> = []
if (injected && injected.format === 'system-message' && injected.content) {
  systemMessages.push({ role: 'system', content: injected.content })
}
let userPrompt = input.prompt
if (injected && injected.format === 'user-xml-block' && injected.content) {
  userPrompt = `${injected.content}\n\n${input.prompt}`
}
// Pass systemMessages + userPrompt into streamText({ messages: [...systemMessages, { role: 'user', content: userPrompt }] }).

// Stream a sentinel event so the client can render the indicator:
if (injected && injected.itemIds.length > 0) {
  await (await getWritable()).write(`\n__MEMORY_USED__:${JSON.stringify(injected.itemIds)}\n`)
}
```

(Adapt exactly to the existing `runAttempt` signature — the injection is additive only, not a restructure.)

- [ ] **Step 4: Typecheck**

Run: `pnpm -w tsc -b`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/workflows/ai-stream.ts
git commit -m "feat(workflow): retrieveMemory step injected into aiStreamWorkflow"
```

---

## Task 27: `aiStreamWorkflow` — `maybeIngestCompletion` step

**Files:**
- Modify: `apps/web/src/workflows/ai-stream.ts`

- [ ] **Step 1: Add step**

Append within the workflow module:

```ts
async function maybeIngestCompletion(input: StreamInput, finalText: string): Promise<void> {
  'use step'
  if (!input.cardId) return
  if (finalText.length < 40 || input.prompt.length < 10) return
  const sql = sqlUser()
  const [rows] = await withRls<[Array<{ tier: 'free' | 'pro' }>]>(input.userId, [
    sql`SELECT tier FROM users WHERE id = ${input.userId}`,
  ])
  if (rows[0]?.tier !== 'pro') return

  ensureStrategiesRegistered()
  const ctx = await buildStrategyCtx(input.userId)
  const mgr = new MemoryManager(ctx, {
    loadUserConfig, loadQuotaSnapshot, insertItem, embedAndStore, incrementCounters,
  })

  try {
    await mgr.ingest({
      userId: input.userId,
      scope: { kind: 'user', refId: null },
      trigger: 'card_completed',
      payload: { cardId: input.cardId, prompt: input.prompt, response: finalText },
    })
  } catch (e) {
    ctx.logger.warn('memory.ingest_skipped', { error: String(e) })
  }
}
```

- [ ] **Step 2: Wire into tail of workflow**

After `writeUsageRow` (or wherever the successful-completion tail runs):

```ts
await maybeIngestCompletion(input, result.text)
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -w tsc -b`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/workflows/ai-stream.ts
git commit -m "feat(workflow): maybeIngestCompletion step (idempotent via response_sha256)"
```

---

## Task 28: Auto-ingest idempotency integration test

**Files:**
- Create: `apps/web/tests/integration/memory-auto-ingest.test.ts`

- [ ] **Step 1: Write test**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { sqlAdmin } from '@/db/rls'
import { POST as ingest } from '@/app/api/memory/ingest/route'

const USER = 'user_m1a_idem'
const CARD = 'deadbeef-0000-4000-8000-000000000042'

beforeAll(async () => {
  const admin = sqlAdmin()
  await admin`DELETE FROM memory_items WHERE user_id = ${USER}`
  await admin`INSERT INTO users (id, email, tier, memory_embedding_provider, memory_embedding_model_id,
              memory_item_count, memory_bytes_count)
              VALUES (${USER}, ${USER + '@t.local'}, 'pro', 'gateway', 'openai/text-embedding-3-small', 0, 0)
              ON CONFLICT (id) DO UPDATE SET tier = 'pro',
                memory_item_count = 0, memory_bytes_count = 0`
})

async function doIngest() {
  return await ingest(new Request('http://localhost/api/memory/ingest', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer test:${USER}` },
    body: JSON.stringify({
      trigger: 'card_completed',
      scope: { kind: 'user', refId: null },
      payload: { cardId: CARD, prompt: 'what is pgvector?', response: 'pgvector is a PostgreSQL extension for storing and querying vector embeddings.' },
    }),
  }))
}

describe('card_pair idempotency', () => {
  it('second ingest for same response_sha256 does not create a duplicate', async () => {
    await doIngest()
    await doIngest()
    const admin = sqlAdmin()
    const [rows] = await admin`SELECT count(*)::int AS n FROM memory_items WHERE source_ref_id = ${CARD}::uuid`
    expect(rows.n).toBe(1)
  })
})
```

- [ ] **Step 2: Run, verify pass**

Run: `pnpm --filter @1scratch/web test tests/integration/memory-auto-ingest.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/integration/memory-auto-ingest.test.ts
git commit -m "test(memory): card_pair auto-ingest idempotency on response_sha256"
```

---

## Task 29: Snapshot fan-out integration test

**Files:**
- Create: `apps/web/tests/integration/memory-snapshot.test.ts`

- [ ] **Step 1: Write**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { sqlAdmin } from '@/db/rls'
import { POST as ingest } from '@/app/api/memory/ingest/route'

const USER = 'user_m1a_snap'

beforeAll(async () => {
  const admin = sqlAdmin()
  await admin`DELETE FROM memory_items WHERE user_id = ${USER}`
  await admin`INSERT INTO users (id, email, tier, memory_embedding_provider, memory_embedding_model_id,
              memory_item_count, memory_bytes_count)
              VALUES (${USER}, ${USER + '@t.local'}, 'pro', 'gateway', 'openai/text-embedding-3-small', 0, 0)
              ON CONFLICT (id) DO UPDATE SET tier = 'pro',
                memory_item_count = 0, memory_bytes_count = 0`
})

describe('canvas_saved fan-out', () => {
  it('emits parent + N children with parent_snapshot_id linkage', async () => {
    const res = await ingest(new Request('http://localhost/api/memory/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer test:${USER}` },
      body: JSON.stringify({
        trigger: 'canvas_saved',
        scope: { kind: 'user', refId: null },
        payload: {
          canvasId: 'deadbeef-0000-4000-8000-000000000900',
          cards: [
            { id: 'deadbeef-0000-4000-8000-000000000901', prompt: 'what is A?', response: 'A is something important with detail past forty chars.' },
            { id: 'deadbeef-0000-4000-8000-000000000902', prompt: 'what is B?', response: 'B is another thing we describe in more than forty chars.' },
          ],
        },
      }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    // Expect 3 inserts: 1 parent + 2 children
    expect(body.items.length).toBeGreaterThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Write snapshot-aware `insertItem` post-processing**

Modify `apps/web/src/lib/memory/ingest-helpers.ts` to resolve the `parent_snapshot_id: '__pending__'` sentinel. After a `canvas_snapshot` or `section_snapshot` parent is inserted, subsequent children from the same ingestor batch get the real id.

Simplest wire: extend `MemoryManager.ingest` loop to remember the last inserted non-card_pair item per user/source_ref_id (in-memory inside the `.ingest()` call) and substitute `__pending__` with its id before calling `insertItem` for children. Implement in `manager.ts`:

```ts
// Inside the .ingest() for loop, before enforceQuota + insertItem:
let lastSnapshotParentId: string | null = null
for (const draft of drafts) {
  if (draft.sourceKind === 'canvas_snapshot' || draft.sourceKind === 'section_snapshot') {
    const saved = await this.adapters.insertItem(this.deps, draft)
    lastSnapshotParentId = saved.id
    created.push(saved)
    await this.adapters.embedAndStore(this.deps, saved)
    await this.adapters.incrementCounters(this.deps.db, event.userId, 1, draft.text.length)
    continue
  }
  const resolved = (draft.metadata as any).parent_snapshot_id === '__pending__' && lastSnapshotParentId
    ? { ...draft, metadata: { ...(draft.metadata as any), parent_snapshot_id: lastSnapshotParentId } }
    : draft
  // ... quota + insert + embed + counters for resolved
}
```

Re-run unit + integration tests.

- [ ] **Step 3: Run, verify pass**

Run: `pnpm --filter @1scratch/web test tests/integration/memory-snapshot.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/integration/memory-snapshot.test.ts packages/memory/src/manager.ts
git commit -m "feat(memory): snapshot parent-id substitution; integration coverage for canvas fan-out"
```

---

## Task 30: `ai_usage.kind` unified cap test

**Files:**
- Create: `apps/web/tests/integration/memory-usage-cap.test.ts`

- [ ] **Step 1: Write**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { sqlAdmin } from '@/db/rls'
import { checkCap } from '@/lib/spend-cap'

const USER = 'user_m1a_cap_kind'

beforeAll(async () => {
  const admin = sqlAdmin()
  await admin`INSERT INTO users (id, email, tier, daily_ai_cap_cents) VALUES (${USER}, ${USER + '@t.local'}, 'pro', 2000)
              ON CONFLICT (id) DO UPDATE SET daily_ai_cap_cents = 2000`
  await admin`DELETE FROM ai_usage WHERE user_id = ${USER}`
  // Seed: one completion row + one embedding row, both today.
  const today = new Date().toISOString().slice(0, 10)
  await admin`INSERT INTO ai_usage (user_id, usage_date, provider, model, input_tokens, output_tokens, cost_micros, kind)
              VALUES (${USER}, ${today}, 'anthropic', 'claude-sonnet-4-6', 1000, 500, 100000, 'completion')`  // 10 cents
  await admin`INSERT INTO ai_usage (user_id, usage_date, provider, model, input_tokens, output_tokens, cost_micros, kind)
              VALUES (${USER}, ${today}, 'gateway', 'openai/text-embedding-3-small', 1000, 0, 20000, 'embedding')`  // 2 cents
})

describe('ai_usage.kind unified cap', () => {
  it('checkCap sums completion + embedding usage against the daily cap', async () => {
    const res = await checkCap(USER)
    expect(res.usedCents).toBe(12)
    expect(res.capCents).toBe(2000)
    expect(res.allowed).toBe(true)
  })
})
```

- [ ] **Step 2: Run + commit**

Run: `pnpm --filter @1scratch/web test tests/integration/memory-usage-cap.test.ts`
Expected: PASS.

```bash
git add apps/web/tests/integration/memory-usage-cap.test.ts
git commit -m "test(memory): ai_usage.kind unified daily-cap sum"
```

---

## Task 31: End-to-end retrieval integration test

**Files:**
- Create: `apps/web/tests/integration/memory-e2e.test.ts`

- [ ] **Step 1: Write**

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { sqlAdmin } from '@/db/rls'
import { POST as ingest } from '@/app/api/memory/ingest/route'
import { POST as search } from '@/app/api/memory/search/route'

const USER = 'user_m1a_e2e'

beforeAll(async () => {
  const admin = sqlAdmin()
  await admin`DELETE FROM memory_items WHERE user_id = ${USER}`
  await admin`INSERT INTO users (id, email, tier, memory_embedding_provider, memory_embedding_model_id,
              memory_item_count, memory_bytes_count)
              VALUES (${USER}, ${USER + '@t.local'}, 'pro', 'gateway', 'openai/text-embedding-3-small', 0, 0)
              ON CONFLICT (id) DO UPDATE SET tier = 'pro',
                memory_item_count = 0, memory_bytes_count = 0`
})

describe('memory end-to-end', () => {
  it('auto-ingest → search retrieves the same text', async () => {
    await ingest(new Request('http://localhost/api/memory/ingest', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer test:${USER}` },
      body: JSON.stringify({
        trigger: 'note_added',
        scope: { kind: 'user', refId: null },
        payload: { text: 'the quick brown fox jumps over the lazy dog', tags: ['animals'] },
      }),
    }))

    const res = await search(new Request('http://localhost/api/memory/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer test:${USER}` },
      body: JSON.stringify({
        queryText: 'fox',
        filter: {},
        budget: { topK: 8, tokenBudget: 2000 },
        currentScope: { kind: 'user', refId: null },
      }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items.length).toBeGreaterThan(0)
    expect(body.items[0].item.text).toMatch(/fox/)
  })
})
```

- [ ] **Step 2: Run + commit**

Run: `pnpm --filter @1scratch/web test tests/integration/memory-e2e.test.ts`
Expected: PASS. If Gateway embedding is unavailable in the test env, the Gateway client's `embedMany` call will fail — swap the test user's provider to a deterministic in-process fake by inserting into a fixtures module (see `packages/memory/src/embed.ts::makeFakeEmbedClient`) and adjusting `resolveEmbedClient` to short-circuit to the fake when `NODE_ENV === 'test'` or `MEMORY_EMBED_FAKE=1` is set. Record this branching in the Build Log.

```bash
git add apps/web/tests/integration/memory-e2e.test.ts
git commit -m "test(memory): end-to-end ingest → search round-trip"
```

---

## Task 32: Barrel + strategy-loader — final verification

**Files:**
- Read: `packages/memory/src/index.ts`

- [ ] **Step 1: Ensure barrel exports are complete**

Expected contents of `packages/memory/src/index.ts`:

```ts
export * from './types'
export * as registry from './registry'
export * from './manager'
export * from './injection'
export * from './rrf'
export * from './quota'
export * from './embed'
export { ragStrategy } from './strategies/rag'
```

If any export is missing, add it.

- [ ] **Step 2: Verify all tests pass**

```bash
pnpm --filter @1scratch/memory test
pnpm --filter @1scratch/web test:integration
pnpm -w tsc -b
```

All PASS.

- [ ] **Step 3: Commit any missing exports**

If anything was added, commit:

```bash
git add packages/memory/src/index.ts
git commit -m "chore(memory): barrel completeness"
```

---

## Task 33: PLAN.md build-log amendment

**Files:**
- Modify: `PLAN.md`

- [ ] **Step 1: Append a build-log amendment**

Prepend below the `# Build Log — Amendments & Deviations` header (keep newest at top per the PLAN convention):

```markdown
## 2026-04-21 — Phase 4 Memory M1a (backend)

Scoped pass: PLAN §10 Phase 4 bullet 1 (memory backend). Design: `docs/superpowers/specs/2026-04-21-phase4-memory-m1-substrate-design.md`; plan: `docs/superpowers/plans/2026-04-21-phase4-memory-m1a-backend.md`.

**Shipped:**
- `packages/memory` workspace — pluggable strategy framework (interfaces, registry, MemoryManager, RRF fusion, injection formatter, quota) + `rag` default strategy (card_pair + note + canvas_snapshot + section_snapshot ingestors; vector retriever).
- Migration `0004_memory_substrate.sql` — drops PLAN stub `memory_chunks`; adds `memory_items` (canonical), `memory_vectors` (per-(item, embedding-model)), `memory_edges` + `memory_facts` (forward-compat for future strategies), `memory_strategy_config` (per-scope enable/weight/params), users memory columns, `ai_usage.kind`.
- Eight `/api/memory/*` routes — ingest, client-embed ingest, search, items (list + bulk delete + :id delete), config (get/put with single-model-lock clear-on-switch), usage.
- `aiStreamWorkflow` integration — `retrieveMemory` step injects memory (system-message or user-xml-block) on every Pro stream; `maybeIngestCompletion` step auto-ingests card completions idempotently via `response_sha256`.
- Embedding provider abstraction: Gateway (AI SDK + `@ai-sdk/gateway`) / BYOK (reuses existing `provider_connections` + `loadDecryptedKey`) / Local (throws `LocalEmbedRequired`; client-embed endpoint handles).
- Unified cap accounting — `ai_usage.kind` discriminator; `checkCap()` sums completions + embeddings.

**Design decisions locked:**
- Memory is Pro-only (per PLAN §9 line 443 conversion narrative).
- Single embedding-model-per-user (switch clears memory); multi-model + re-embed deferred to M4.
- Hybrid snapshots (parent summary + fan-out children w/ `parent_snapshot_id`).

**Deferred from this scope:**
- Settings → Memory UI, slash-command `/remember`, context-menu actions, response indicator, Tauri local-embed bridge — all land in M1b plan.
- Background reconcile cron for rows with missing vectors — first M1 amendment.
- Retrieval cache (per-prompt memoization) — post-M1.
- Production observability dashboards — ops sub-ticket.
- M2 (short-term tier), M3 (hybrid lexical + vector), M4 (multi-embedding model), M5 (KB), M6 (scope-pin), M7 (consolidation) — each gets its own spec + plan.

**Plan deviations:** (record any actual divergences during implementation here)
```

- [ ] **Step 2: Commit**

```bash
git add PLAN.md
git commit -m "docs(plan): Phase 4 Memory M1a backend build-log entry"
```

---

## Task 34: Full test sweep + lint + typecheck

**Files:** none

- [ ] **Step 1: Run full suite**

```bash
pnpm -w tsc -b
pnpm --filter @1scratch/memory test
pnpm --filter @1scratch/web test
pnpm --filter @1scratch/web test:integration
pnpm -w lint || true  # existing lint config; no new rules added
```

Expected: all PASS. Record any skips (missing `DATABASE_URL_ADMIN` is acceptable locally; CI must have it).

- [ ] **Step 2: Push branch**

```bash
git push -u origin phase4-memory-m1a-backend
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "Phase 4 Memory M1a — backend substrate + rag strategy" --body "$(cat <<'EOF'
## Summary
- New workspace `packages/memory`: pluggable-strategy framework + `rag` default strategy.
- Migration `0004_memory_substrate.sql`: 5 new tables, `users` memory columns, `ai_usage.kind`.
- Eight `/api/memory/*` routes + `aiStreamWorkflow` integration.
- Pro-only tier gate + 50k-item / 200MB-byte quota.
- Embedding provider abstraction: Gateway / BYOK / local-stub.

## Test plan
- [ ] `pnpm --filter @1scratch/memory test` green
- [ ] `pnpm --filter @1scratch/web test:integration` green (requires `DATABASE_URL_ADMIN`)
- [ ] Migration applied on Preview branch; smoke-tested
- [ ] `curl POST /api/memory/ingest` round-trips against a seeded Pro user
- [ ] Free-tier user hits 402 on ingest
- [ ] Quota-cap user hits 402

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Note migration renumber if needed**

If, at PR review time, Phase 3a (`0003`) has not yet merged and a later migration has taken `0004`, rebase:

```bash
git fetch origin
git rebase origin/main
# rename file if conflict:
git mv apps/web/src/db/migrations/0004_memory_substrate.sql apps/web/src/db/migrations/0005_memory_substrate.sql
# update any hard-coded number references (none expected; filename-based discovery)
git add -u && git rebase --continue
git push --force-with-lease
```

---

## Task 35: Manual smoke test checklist (backend-only)

**Files:** none

- [ ] **Step 1: Seed a Pro user** (via Clerk + admin SQL)

- [ ] **Step 2: `curl POST /api/memory/config`** — set `embedding_provider=gateway`, `embedding_model_id=openai/text-embedding-3-small`.

- [ ] **Step 3: `curl POST /api/memory/ingest`** — trigger `note_added`, scope `user`, payload `{text: "smoke test note"}`. Expect 200 + item body.

- [ ] **Step 4: `curl POST /api/memory/search`** — `queryText: "smoke"`, currentScope user. Expect >=1 hit.

- [ ] **Step 5: `curl GET /api/memory/usage`** — expect `item_count >= 1, bytes_count > 0`.

- [ ] **Step 6: Submit prompt via `/api/ai/stream` with `cardId` pointing to a real card**; confirm a row lands in `memory_items` after streaming completes.

- [ ] **Step 7: `curl DELETE /api/memory/items?scope=user`** — expect `{deleted_count: N}`; counters reset to zero.

- [ ] **Step 8: Record results in PLAN build-log under "Plan deviations" if anything unexpected.**

---

## Self-review checklist

Before merging, re-verify:

**Spec coverage.** Each spec §1 locked decision has a task. Decisions 1-18 mapped to Tasks 1-33.

**Placeholders.** No `TBD`, `TODO`, or `fill in` in any Task step body.

**Type consistency.** `MemoryItemDraft`, `MemoryManager`, `StrategyCtx`, `ScopeRef`, `InjectionPolicy`, `InjectedMemory`, `QuotaSnapshot`, `EmbedClient`, `LlmClient`, `QuotaError`, `LocalEmbedRequired` used identically across Tasks 2, 10, 11-14, 15-17, 26-27.

**Migration ordering.** Task 34 Step 4 documents renumber-if-needed against Phase 3a.

**Tests always before implementation** — all TDD steps present.

**Idempotency.** `card_pair` unique index + `ON CONFLICT ... DO UPDATE` in `insertItem` + response_sha256 hash computed consistently in `cardPairIngestor` and children of snapshot ingestors.

**RLS.** Every new table has `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` + a policy keyed on `app_current_user_id()`.

**Pro-only gate.** Enforced server-side via `loadQuotaSnapshot` → `enforceQuota` → throws `QuotaError('not_pro')` → 402.

**Dim validation.** `/api/memory/ingest/client-embed` checks `dim` and `embedding.length` and `embedding_model_id` match the user's registered model.

**Snapshot linkage.** `canvasSnapshotIngestor` and `sectionSnapshotIngestor` emit children with `parent_snapshot_id: '__pending__'`; `MemoryManager.ingest` substitutes the real parent id before child insert (Task 29 Step 2).

---

## Plan complete

Plan complete and saved to `docs/superpowers/plans/2026-04-21-phase4-memory-m1a-backend.md`. Two execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
