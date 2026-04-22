# Phase 4 — Memory Ecosystem M1: Substrate + `rag` strategy (design spec)

**Date:** 2026-04-21
**Scope:** PLAN.md §10 Phase 4 bullet 1 — *memory ecosystem foundation* plus one default strategy (`rag`) that covers the PLAN narrative ("background ingestion of completed prompt/response pairs; RAG retrieval injected into Pro prompts on demand").
**Out of scope (separate specs in the same series):**
- **M2** — Short-term / ephemeral memory tier.
- **M3** — Hybrid lexical + vector retrieval (BM25, query rewriting).
- **M4** — Multi-embedding-model concurrent storage + async re-embed Workflow + model-switch-without-clear.
- **M5** — Knowledge Base ingestor (`kb_doc` source, file parsers, KB UX — this is PLAN §10 Phase 4 bullet 3).
- **M6** — Per-canvas/section embedding model pin.
- **M7** — Consolidation (short→long promotion, summarization, dedup, forgetting, live in-flight summarization of oversized retrieval sets, re-ingestion of card edits).
- Agentic retrieval (LLM tool calls memory as a tool) — post-M7.
- On-device GGUF embedding binding — Phase 4 mobile finish or later (Tauri bridge is shaped for it, Ollama HTTP only in M1).

---

## 1. Locked decisions

| # | Decision | Notes |
|---|---|---|
| 1 | Spec scope | M1 Memory Substrate + `rag` strategy only |
| 2 | Memory is a **pluggable-strategy framework**, not a fixed pipeline | Future strategies (short-term, BM25, AgentMem, Memoria, gmemory, consolidation) register into the same framework without schema or API churn |
| 3 | Canonical store is **text + metadata**, model-agnostic | Any LLM model reads/writes the same items. Vectors are per-(item, embedding-model) derived cache, not canonical. |
| 4 | **Four substrate tables** day-one | `memory_items` (canonical), `memory_vectors` (RAG-like strategies), `memory_edges` (graph-like strategies), `memory_facts` (triple-based strategies). Last two are empty-but-present forward-compat for M2+. |
| 5 | **Scope hierarchy** day-one | `user` \| `workspace` \| `section` \| `canvas`. Retrieval unions all scopes at/above the current request context. |
| 6 | **Source kinds** in M1 | `card_pair`, `note`, `canvas_snapshot`, `section_snapshot`. Future `kb_doc`, `web_clip`, etc. add via new `source_kind` string — no schema change. |
| 7 | **Tier gate: Pro-only** | Matches PLAN §9 line 443 + conversion narrative line 449. Free-tier users see an upgrade wall. Local/BYOK embedding is a **Pro privacy toggle**, not a free-tier carve-out. |
| 8 | **Embedding provider: hybrid** per user | `gateway` (we pay via AI Gateway, default), `byok` (user's OpenAI/Google/Cohere key via `provider_connections`), `local` (Ollama HTTP via Tauri bridge; on-device GGUF future). Single-model-per-user lock at M1 (switch = clear memory). M4 lifts the lock. |
| 9 | **Auto-ingest** fires at `card_completed` | Idempotency key = `(user_id, source_kind='card_pair', source_ref_id=card_id, metadata->>'response_sha256')`. Trivial completions (< 40 chars or < 10-char prompt) skipped. |
| 10 | **Manual ingest surfaces** | Slash-command `/remember <text>` in card editor; contextual "Save to memory" on card, canvas, section; Settings → Memory freeform note field. All four routes write through the same ingest pipeline. |
| 11 | **Canvas/section snapshot = hybrid fan-out** | Parent `*_snapshot` item (LLM-summarized) + children (`card_pair`-style) linked by `metadata.parent_snapshot_id`. Ceiling: 500 cards per snapshot action. |
| 12 | **Retrieval** auto-injects into every Pro `aiStreamWorkflow` run | Policy picks format (`system-message` or `user-xml-block`), top-K, token budget. User-default in `users.memory_injection_policy`; per-task override via API filter. |
| 13 | **Retrieval fusion** = Reciprocal Rank Fusion (RRF) | `k=60`, weight-adjustable per strategy via `memory_strategy_config`. No score normalization needed across heterogeneous strategies. |
| 14 | **Tagging + trackability** day-one | `memory_items.tags text[]`, `memory_items.metadata jsonb` provenance (ingested_by, trigger, parent_snapshot_id, card_ids[]). Retrieval filter accepts `tags[]`, `source_kinds[]`, `strategies[]`. |
| 15 | **Quota** | Pro = 50,000 items / 200 MB text. Enforced by atomic counters on `users`. 402 w/ `{which:'item_cap'\|'byte_cap'\|'not_pro'}` on exceed. |
| 16 | **Cost accounting** | `ai_usage.kind` column added; `'completion'` (existing) and `'embedding'` (new) both count against the daily cap via `checkCap()`. BYOK/local embed logged with `cost_cents=0`. |
| 17 | **Resilience** | Retrieval failure → log `memory.retrieval_skipped`, continue without injection (never block answer). Ingestion failure after response streamed → best-effort retry via background reconcile cron (post-M1 amendment). |
| 18 | **Definition of done** | Pro user round-trip: submit in canvas A → auto-ingest → switch to canvas B → retrieve-and-inject on next prompt → Settings → Memory shows the row → response footer shows `🧠 N items used`. Plus full integration test matrix + manual DoD pass + quota + tier gate verified. |

---

## 2. Workspace layout

```
packages/
  memory/                              NEW workspace package (@1scratch/memory)
    package.json
    tsconfig.json
    src/
      types.ts                         ScopeKind, SourceKind, MemoryItem, IngestEvent, RetrievalContext, ScoredItem, MemoryStrategy, Ingestor, Retriever, StrategyCtx
      registry.ts                      module-static Map<id, MemoryStrategy>
      manager.ts                       MemoryManager: ingest(), retrieve(), enforceQuota()
      rrf.ts                           reciprocal rank fusion + weight application + dedup
      injection.ts                     formatter: system-message | user-xml-block
      quota.ts                         atomic counter updates; QuotaError
      embed.ts                         EmbedClient interface + resolver (gateway|byok|local)
      strategies/
        rag.ts                         v1 strategy: card_pair + note + canvas_snapshot + section_snapshot ingestors, vectorRetriever
      index.ts                         barrel

apps/
  web/
    src/
      app/api/memory/
        ingest/route.ts                POST /api/memory/ingest
        ingest/client-embed/route.ts   POST /api/memory/ingest/client-embed
        search/route.ts                POST /api/memory/search
        items/route.ts                 GET /api/memory/items (paginated) + DELETE (bulk)
        items/[id]/route.ts            DELETE /api/memory/items/:id
        config/route.ts                GET/PUT /api/memory/config
        usage/route.ts                 GET /api/memory/usage
      lib/memory/
        context.ts                     buildStrategyCtx(userId): {db, embed, llm, logger}
        scope.ts                       resolveScopeFromCard(cardId) → {workspace, section, canvas}
        ingest-helpers.ts              sha256, text-length gate, quota preflight
      workflows/
        ai-stream.ts                   +retrieveMemory step, +maybeIngestCompletion step
      db/migrations/
        0004_memory_substrate.sql      NEW (rename to next available number if 3a merges later)

packages/
  ui/
    src/
      settings/memory/
        MemoryPage.tsx                 container
        MemoryProviderPicker.tsx       gateway/BYOK/local radio + model + Test probe
        MemoryStrategyList.tsx         toggle + weight per strategy
        MemoryInjectionPolicy.tsx      format radio + top-K + token-budget inputs
        MemoryNoteInput.tsx            freeform note + scope + tags
        MemoryItemsTable.tsx           paginated item list + per-row delete
      memory/
        local-embed.ts                 Tauri command wrapper for local Ollama
        client.ts                      typed fetch wrappers for all /api/memory/* routes
        slash-remember.tsx             slash-command handler for /remember

apps/
  client/
    src-tauri/
      src/memory.rs                    NEW — Tauri command memory_local_embed(texts, endpoint, model) -> Vec<Vec<f32>>; registers on plugin init
      Cargo.toml                       +reqwest (shared dep)
```

The layout assumes 3a has landed `packages/ui` extraction. If M1 implementation begins before 3a merge, the new `packages/ui/src/settings/memory/` + `packages/ui/src/memory/` land directly in `apps/client/src/` and are moved by the 3a extraction PR (already in 3a's scope per its §2 decision 3).

---

## 3. Data model

### 3.1 Migration `0004_memory_substrate.sql`

```sql
create extension if not exists vector;

-- Canonical, strategy-agnostic store. Truth lives here.
create table memory_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,

  -- Scope hierarchy (who can retrieve this item)
  scope_kind text not null check (scope_kind in ('user','workspace','section','canvas')),
  scope_ref_id uuid,
  check ((scope_kind = 'user') = (scope_ref_id is null)),

  -- Provenance (what was ingested)
  source_kind text not null,
  source_ref_id uuid,

  -- Content
  text text not null,
  tags text[] not null default '{}',
  metadata jsonb not null default '{}',

  -- Classification
  tier text not null default 'long' check (tier in ('short','long')),
  expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index memory_items_user_scope on memory_items (user_id, scope_kind, scope_ref_id)
  where expires_at is null or expires_at > now();
create index memory_items_tags_gin on memory_items using gin (tags);
create index memory_items_source on memory_items (user_id, source_kind, source_ref_id);

alter table memory_items enable row level security;
alter table memory_items force row level security;
create policy memory_items_owner on memory_items for all
  using (user_id = current_setting('app.user_id')::uuid);

-- Per-(item, embedding-model) vector cache. M1 writes one row per item for the
-- user's current embedding model. M4 relaxes to multi-model concurrent rows.
create table memory_vectors (
  memory_item_id uuid not null references memory_items(id) on delete cascade,
  embedding_model_id text not null,
  dim int not null,
  embedding vector,
  created_at timestamptz not null default now(),
  primary key (memory_item_id, embedding_model_id)
);
create index memory_vectors_ann on memory_vectors using hnsw (embedding vector_cosine_ops);
alter table memory_vectors enable row level security;
alter table memory_vectors force row level security;
create policy memory_vectors_owner on memory_vectors for all
  using (exists (
    select 1 from memory_items m
    where m.id = memory_vectors.memory_item_id
      and m.user_id = current_setting('app.user_id')::uuid
  ));

-- Forward-compat: graph edges for AgentMem/Memoria/gmemory-style strategies.
create table memory_edges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  from_item_id uuid not null references memory_items(id) on delete cascade,
  to_item_id   uuid not null references memory_items(id) on delete cascade,
  rel text not null,
  weight real not null default 1.0,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index memory_edges_from on memory_edges (user_id, from_item_id, rel);
create index memory_edges_to   on memory_edges (user_id, to_item_id,   rel);
alter table memory_edges enable row level security;
alter table memory_edges force row level security;
create policy memory_edges_owner on memory_edges for all
  using (user_id = current_setting('app.user_id')::uuid);

-- Forward-compat: structured facts for semantic-memory strategies.
create table memory_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  scope_kind text not null check (scope_kind in ('user','workspace','section','canvas')),
  scope_ref_id uuid,
  subject text not null,
  predicate text not null,
  object jsonb not null,
  source_item_id uuid references memory_items(id) on delete set null,
  confidence real not null default 1.0,
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index memory_facts_subject on memory_facts (user_id, subject);
create index memory_facts_predicate on memory_facts (user_id, predicate);
alter table memory_facts enable row level security;
alter table memory_facts force row level security;
create policy memory_facts_owner on memory_facts for all
  using (user_id = current_setting('app.user_id')::uuid);

-- Per-(user, scope, strategy) config. Per-user default = scope_kind='user', scope_ref_id=null.
create table memory_strategy_config (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  scope_kind text not null check (scope_kind in ('user','workspace','section','canvas','task')),
  scope_ref_id uuid,
  strategy text not null,
  enabled boolean not null default true,
  weight real not null default 1.0,
  params jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, scope_kind, scope_ref_id, strategy)
);
alter table memory_strategy_config enable row level security;
alter table memory_strategy_config force row level security;
create policy memory_strategy_config_owner on memory_strategy_config for all
  using (user_id = current_setting('app.user_id')::uuid);

-- Drop the PLAN §3 stub memory_chunks (no prod data yet).
drop table if exists memory_chunks;

-- Per-user memory settings on `users`.
alter table users
  add column memory_embedding_model_id text,
  add column memory_embedding_provider text
    check (memory_embedding_provider in ('gateway','byok','local')),
  add column memory_injection_policy jsonb not null default
    '{"format":"system-message","token_budget":2000,"top_k":8}'::jsonb,
  add column memory_item_count int not null default 0,
  add column memory_bytes_count bigint not null default 0;

-- ai_usage extension: new 'kind' discriminator for unified cap accounting.
alter table ai_usage add column kind text not null default 'completion'
  check (kind in ('completion','embedding'));
```

**Notes:**
- `embedding vector` column without a fixed dim — pgvector 0.7+ supports late-binding dim. App layer guards that insert `dim` matches the user's registered `memory_embedding_model_id`. Lets M4 introduce concurrent 768+1536 vectors without a column-type change.
- HNSW index (pgvector 0.7+) on `memory_vectors.embedding` — better recall + incremental insert vs IVFFlat; no `lists` tuning required. Impl plan verifies Neon pgvector version ≥ 0.7 before applying.
- RLS on every new table. All reads wrapped in existing `withRls(userId, ...)` from Phase 2.
- `memory_item_count` + `memory_bytes_count` on `users` are materialized counters updated atomically with item insert/delete. Gives O(1) quota checks without full-table scan.
- `memory_strategy_config.scope_kind` includes `'task'` — reserved for future skill-binding; M1 ignores it.

### 3.2 Migration ordering vs Phase 3a

Phase 3a (in worktree `.worktrees/phase3a-mobile-foundation`) has claimed `0003_device_sessions.sql`. M1 claims `0004_memory_substrate.sql`.

- Whichever merges to `main` **first** keeps its number.
- Whichever merges **second** renames its migration file to the next available number, updates migration tracking, and rebases.
- The M1 implementation plan will re-verify the migration number before applying.

No other file conflicts: 3a creates the `packages/ui` shell; M1 adds sibling subdirs (`settings/memory/`, `memory/`).

---

## 4. Strategy framework (`packages/memory`)

### 4.1 Core interfaces

```ts
// packages/memory/src/types.ts

export type ScopeKind = 'user' | 'workspace' | 'section' | 'canvas'
export type SourceKind = 'card_pair' | 'note' | 'canvas_snapshot' | 'section_snapshot' | string
export type Tier = 'short' | 'long'

export interface ScopeRef {
  kind: ScopeKind
  refId: string | null  // null iff kind==='user'
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

export interface IngestEvent {
  userId: string
  scope: ScopeRef
  trigger: 'card_completed' | 'card_saved' | 'canvas_saved' | 'section_saved' | 'note_added' | string
  payload: unknown
}

export interface RetrievalContext {
  userId: string
  currentScope: ScopeRef
  queryText: string
  queryEmbedding?: Float32Array   // optional: client-provided when provider='local'
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

export interface Ingestor {
  triggers: readonly string[]
  produce(event: IngestEvent, ctx: StrategyCtx):
    Promise<Array<Omit<MemoryItem, 'id'|'createdAt'|'updatedAt'>>>
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

export interface StrategyCtx {
  db: DbClient       // RLS-wrapped
  embed: EmbedClient // resolved per-user
  llm?: LlmClient    // thin wrapper over aiStreamWorkflow in non-streaming mode — { summarize(texts: string[]): Promise<string> }; used by snapshot ingestors, optional for other strategies
  logger: Logger
}
```

### 4.2 Registry

```ts
// packages/memory/src/registry.ts
const strategies = new Map<string, MemoryStrategy>()
export function register(s: MemoryStrategy): void { strategies.set(s.id, s) }
export function get(id: string): MemoryStrategy | undefined { return strategies.get(id) }
export function list(): MemoryStrategy[] { return [...strategies.values()] }
```

Module-static map. Strategies self-register at import time via a server-boot barrel that imports them in order.

### 4.3 Memory Manager

```ts
// packages/memory/src/manager.ts
export class MemoryManager {
  constructor(private readonly deps: StrategyCtx) {}

  async ingest(event: IngestEvent): Promise<MemoryItem[]> {
    const config = await loadUserConfig(this.deps.db, event.userId)
    const created: MemoryItem[] = []
    for (const strat of list()) {
      if (!config.enabledFor(strat.id, event.scope)) continue
      for (const ing of strat.ingestors) {
        if (!ing.triggers.includes(event.trigger)) continue
        const drafts = await ing.produce(event, this.deps)
        for (const draft of drafts) {
          await enforceQuota(this.deps.db, event.userId, draft.text.length)
          const saved = await insertItem(this.deps.db, draft)
          await this.embedAndStore(saved)   // synchronous in M1; background Workflow in later amendment
          created.push(saved)
        }
      }
    }
    return created
  }

  async retrieve(ctx: RetrievalContext):
    Promise<{ items: ScoredItem[]; injected: { format: InjectFormat; content: string; itemIds: string[] } }> {
    const config = await loadUserConfig(this.deps.db, ctx.userId)
    const active = list()
      .filter(s => (ctx.filter.strategies ?? null) === null || ctx.filter.strategies!.includes(s.id))
      .filter(s => config.enabledFor(s.id, ctx.currentScope))

    const perStrategy = await Promise.all(
      active.flatMap(s => s.retrievers.map(r => r.retrieve(ctx, this.deps))),
    )
    const fused = reciprocalRankFusion(perStrategy, config.weightsFor(ctx.currentScope))
    const filtered = applyPostFilters(fused, ctx.filter)
    const trimmed = trimToTokenBudget(filtered, ctx.budget)
    const injected = formatInjection(trimmed, config.injectionPolicy)
    return { items: trimmed, injected }
  }
}
```

### 4.4 Reciprocal Rank Fusion

`score(item) = Σ_s weight_s · 1 / (k + rank_s(item))` across strategies, `k=60`. Dedup by `memory_item_id`. No score normalization needed across heterogeneous strategies. Weights come from `memory_strategy_config.weight` for the most-specific enabled scope config.

### 4.5 Injection formatters

```ts
type InjectFormat = 'system-message' | 'user-xml-block'

function formatInjection(items, policy) {
  const rendered = items.map((s, i) =>
    `[${i+1}] (${s.strategy}, ${s.item.scope.kind}, ${s.item.tags.join(',')}) ${s.item.text}`
  ).join('\n')
  if (policy.format === 'system-message') {
    return {
      format: 'system-message',
      content: `Relevant memory items (do not restate unless asked):\n${rendered}`,
      itemIds: items.map(s => s.item.id),
    }
  }
  return {
    format: 'user-xml-block',
    content: `<memory>\n${rendered}\n</memory>`,
    itemIds: items.map(s => s.item.id),
  }
}
```

`aiStreamWorkflow` consumes: `system-message` → push as additional system message; `user-xml-block` → prepend to user prompt. Both handled by one integration point.

### 4.6 v1 strategy: `rag`

```ts
// packages/memory/src/strategies/rag.ts
import { register } from '../registry'
import { cardPairIngestor, noteIngestor, canvasSnapshotIngestor, sectionSnapshotIngestor } from './rag/ingestors'
import { vectorRetriever } from './rag/retriever'

const rag: MemoryStrategy = {
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
register(rag)
```

- `cardPairIngestor` — `(userId, card) → [{text: prompt + '\n\n' + response, metadata: {response_sha256, trigger}, sourceKind:'card_pair', sourceRefId: cardId, scope:{kind:'user',refId:null}}]`. Idempotency: if an existing row matches `(user_id, source_kind='card_pair', source_ref_id=cardId, metadata->>'response_sha256')`, skip insert.
- `noteIngestor` — freeform text + user-chosen scope + tags.
- `canvasSnapshotIngestor` — LLM summary (uses user's default model slot) + fan-out of all cards as `card_pair` items with `metadata.parent_snapshot_id`. 500-card ceiling; return 413 above. **Fan-out collision rule:** if a card already has an auto-ingested `card_pair` row (matching `response_sha256`), the ingestor updates that row's `metadata.parent_snapshot_id` in place instead of creating a duplicate.
- `sectionSnapshotIngestor` — iterates canvases in section; section-level LLM summary + fan-out over all cards across canvases in the section. Does not emit per-canvas nested snapshot parents (M7 handles nested). Same fan-out collision rule as canvas snapshot.
- `vectorRetriever` — reads user's embedding provider + model via `StrategyCtx.embed`; embeds `queryText` (or uses provided `queryEmbedding` for `local`); HNSW cosine search on `memory_vectors` filtered by user_id + scope hierarchy + `topK` from params.

### 4.7 Task/skill binding (framework-ready, API-exposed)

`POST /api/memory/search` accepts `filter.strategies` and `filter.tags` — clients can restrict retrieval to a subset. LLM-tool-driven agentic retrieval (the model calls `memory.search` as a tool) is post-M7, but the framework contract is ready day one.

---

## 5. Ingestion, retrieval, and embed-provider flow

### 5.1 New endpoints (apps/web)

| Route | Auth | Body | Returns |
|---|---|---|---|
| `POST /api/memory/ingest` | Pro | `{ trigger, scope, payload }` | `{ items: [...] }` (server-driven embed) |
| `POST /api/memory/ingest/client-embed` | Pro | `{ trigger, scope, payload, vectors: [{ text, embedding, dim, embedding_model_id }] }` | `{ items }` (local/on-device embed path) |
| `POST /api/memory/search` | Pro | `{ queryText, queryEmbedding?, filter, budget, currentScope }` | `{ items: ScoredItem[], injected }` |
| `GET  /api/memory/items` | Pro | `?scope=&source=&limit=&cursor=` | Paginated list |
| `DELETE /api/memory/items/:id` | Pro | — | 204 |
| `DELETE /api/memory/items` | Pro | `?scope=&source=` (or no filter = clear all) | `{ deleted_count }` |
| `GET/PUT /api/memory/config` | Pro | `{ embedding_provider, embedding_model_id, injection_policy, strategies: [...] }` | Current config |
| `GET  /api/memory/usage` | Pro | — | `{ item_count, bytes_count, caps }` |

All routes: `verifyMobileBearer(req)` → Clerk `auth()` → `withRls(userId, ...)`. Non-Pro users → 402. Matches existing gate pattern + Phase 3a's mobile bearer extension.

### 5.2 Embed-provider abstraction

```ts
// packages/memory/src/embed.ts
export interface EmbedClient {
  readonly providerId: 'gateway' | 'byok' | 'local'
  readonly modelId: string
  readonly dim: number
  embed(text: string[]): Promise<Float32Array[]>
}
```

Resolution per-request:
1. Read `users.memory_embedding_provider` + `users.memory_embedding_model_id`.
2. `gateway` → AI SDK `embedMany({ model: gateway('openai/text-embedding-3-small') })`. Writes `ai_usage(kind='embedding', cost_cents=...)`.
3. `byok` → load user's decrypted provider key via existing `loadDecryptedKey` (reuse Phase 2 crypto path); call provider's embeddings endpoint directly. Writes `ai_usage(kind='embedding', cost_cents=0, provider=<userProvider>)`.
4. `local` → server throws `LocalEmbedRequired`. Caller must route through `/api/memory/ingest/client-embed` (ingestion) or pass `queryEmbedding` in body (retrieval).

Dimension guard: every insert verifies `vectors[i].length === user.registered_dim`; mismatch → 400.

### 5.3 Client-embed path

- Client (Tauri) embeds via `memory_local_embed` Tauri command → Ollama HTTP (`POST http://localhost:11434/api/embeddings`) or future on-device GGUF binding.
- Client POSTs `{ text, embedding, embedding_model_id, dim }` to `/api/memory/ingest/client-embed`.
- Server: validates `dim` matches `users.memory_embedding_model_id` registered dim; writes `memory_items` + `memory_vectors` rows; logs `ai_usage(kind='embedding', cost_cents=0, provider='local')`.
- Rate limit: 100 client-embed POSTs / min / user (cheap writes but DoS protection).

Retrieval symmetry:
- `gateway`/`byok` → server embeds `queryText` then ANN.
- `local` → client computes `queryEmbedding`, posts it + `queryText` (retained for M3 BM25) to `/api/memory/search`.

### 5.4 Wiring to `aiStreamWorkflow`

Two new steps added to `src/workflows/ai-stream.ts`:

```ts
// Before buildAttemptChain
async function retrieveMemory(input: StreamInput): Promise<MemoryInjection | null> {
  'use step'
  if (!(await isProUser(input.userId))) return null
  if (input.memoryPolicy === 'off') return null
  const currentScope = await resolveScope(input)  // cardId → canvas → section → workspace
  const { injected } = await memoryManager.retrieve({
    userId: input.userId,
    currentScope,
    queryText: input.prompt,
    filter: input.memoryFilter ?? {},
    budget: input.memoryBudget ?? { topK: 8, tokenBudget: 2000 },
  })
  return injected
}

// In the tail, after successful completion
async function maybeIngestCompletion(input: StreamInput, result: RunResult): Promise<void> {
  'use step'
  if (!(await isProUser(input.userId))) return
  if (!input.cardId) return
  if (result.text.length < 40 || input.prompt.length < 10) return
  await memoryManager.ingest({
    userId: input.userId,
    scope: { kind: 'user', refId: null },
    trigger: 'card_completed',
    payload: { cardId: input.cardId, prompt: input.prompt, response: result.text },
  })
}
```

- `retrieveMemory` output is fed to `runAttempt`: `system-message` → prepended to the system array; `user-xml-block` → prefixed onto the user prompt.
- Retrieval failure → step returns `null`, logs `memory.retrieval_skipped`, stream continues. Memory is best-effort; response is the contract.
- Ingestion failure after response streamed → logged; background reconcile cron (added in first M1 amendment) scans `mutations` log for completed prompts with no matching `memory_item` in the last 24h and retries.
- Idempotency: rag's `cardPairIngestor` upserts on `(user_id, source_kind, source_ref_id, metadata->>'response_sha256')`. Workflow DevKit retries do not double-insert.

### 5.5 Quota enforcement

```ts
async function enforceQuota(db: DbClient, userId: string, incomingTextLen: number) {
  const u = await db.users.where({id: userId}).select('tier','memory_item_count','memory_bytes_count').first()
  if (u.tier !== 'pro') throw new QuotaError('not_pro')
  if (u.memory_item_count >= 50_000) throw new QuotaError('item_cap')
  if (u.memory_bytes_count + incomingTextLen >= 200_000_000) throw new QuotaError('byte_cap')
}
```

Counter updates (same tx as item insert/delete):

```sql
update users set memory_item_count = memory_item_count + 1,
                 memory_bytes_count = memory_bytes_count + $textLen,
                 updated_at = now()
 where id = $userId
```

QuotaError → HTTP 402 `{error:'memory_quota_exceeded', which:'item_cap'|'byte_cap'|'not_pro'}`.

### 5.6 Canvas / section snapshot fan-out (hybrid)

`trigger: 'canvas_saved'` flow:

1. Load all non-deleted cards in canvas.
2. Call user's LLM slot via a new non-streaming `summarize` entry on `aiStreamWorkflow` (or a dedicated summarize workflow). Counts against daily AI cap.
3. Insert parent `memory_items` row: `source_kind='canvas_snapshot'`, `source_ref_id=canvas_id`, `text=<summary>`, `metadata={card_ids:[...], children_pending:N}`.
4. Fan-out N child `card_pair` items with `metadata.parent_snapshot_id=<parent.id>`.
5. Embed all (server path for gateway/byok; client-driven if provider='local' — the context menu modal handles that by invoking local embed before POST).
6. Partial-failure: parent keeps `metadata.children_pending` count; reconcile cron retries.
7. 500-card ceiling; above → 413 + "split canvas first".

`trigger: 'section_saved'` — same recipe at section scope. Iterates canvases within section. Section-level parent summary + fan-out over all cards across all canvases. Canvas-level parents are NOT emitted by section save (flat fan-out for M1; M7 can introduce nested summaries).

### 5.7 Cost accounting

- `ai_usage.kind = 'completion' | 'embedding'`.
- `checkCap(userId)` now sums `cost_cents` across both kinds.
- BYOK / local embed → `cost_cents = 0` (observability row only).

---

## 6. UX surfaces

### 6.1 Settings → Memory page

New top-level row in the Settings sidebar ("Memory", below Models, above Sync Diagnostics). Components under `packages/ui/src/settings/memory/`:

```
┌──────────────────────────────────────────────────────┐
│  Memory                                     [Pro]    │
│                                                       │
│  STATUS                                               │
│    • Items:        1,234 / 50,000                     │
│    • Storage:      12.4 MB / 200 MB                   │
│    • Last indexed: 2 min ago                          │
│                                                       │
│  EMBEDDING PROVIDER                                   │
│   ○ Gateway (we pay)     [default]                    │
│   ○ BYOK — OpenAI                                     │
│   ● Local — Ollama [nomic-embed-text]      [Test]     │
│   [Switch model] (warns: clears existing memory)      │
│                                                       │
│  STRATEGIES                                           │
│   ☑ rag                    weight: [1.0]              │
│                                                       │
│  INJECTION                                            │
│   Format:   (•) System message   ( ) XML block        │
│   Top K:    [  8 ]       Token budget: [ 2000 ]       │
│                                                       │
│  ADD NOTE                                             │
│   ┌─────────────────────────────────────┐             │
│   │ Freeform note…                      │             │
│   └─────────────────────────────────────┘             │
│   Scope: [User ▾]   Tags: [comma-separated]           │
│   [Save to memory]                                    │
│                                                       │
│  RECENT ITEMS                          [Filter ▾]     │
│   2m  card_pair  [canvas]  "Explain HNSW indexes…"    │
│   5m  note       [user]    tag:python                 │
│   ...                      [Load more]                │
│                                                       │
│  DANGER                                               │
│   [Clear all memory]   [Export memory (JSON)]         │
└──────────────────────────────────────────────────────┘
```

Components:
- `MemoryPage.tsx` — fetches `/api/memory/usage`, `/api/memory/config`, `/api/memory/items` paginated.
- `MemoryProviderPicker.tsx` — radio (gateway/BYOK/local), model dropdown (populated from live list for BYOK/local), "Test" button fires 1-token probe.
- `MemoryStrategyList.tsx` — one row per registered strategy, enable toggle + weight number input.
- `MemoryInjectionPolicy.tsx` — format radio, top-K + token-budget inputs. Saves to `/api/memory/config`.
- `MemoryNoteInput.tsx` — freeform text, scope dropdown, tag input. POSTs `/api/memory/ingest { trigger:'note_added' }`.
- `MemoryItemsTable.tsx` — paginated, filter dropdown (source_kind, scope), per-row delete, click row to expand full text.

### 6.2 Slash-command `/remember`

Existing card editor gains one slash command:

- Types `/remember <text>` or `/remember #tag1,tag2 <text>` → intercepted client-side before submission.
- POSTs `/api/memory/ingest` with `trigger='note_added'`, `scope={kind:'canvas', refId:currentCanvasId}`, `payload={text, tags}`.
- Toast: "Saved to memory (canvas scope)".
- Does NOT submit the card's prompt to the LLM (short-circuits card submission).

### 6.3 Contextual "Save to memory"

Card right-click (desktop) / long-press (mobile 3b):
- "Save to memory (as card_pair)" → `trigger:'card_saved'`, `scope={user}`, payload={cardId}. For already-completed cards that were auto-ingested, this becomes a tagging/scope-update action (upsert).

Sidebar canvas-tab right-click:
- "Save canvas to memory" → opens modal:
```
┌─ Save canvas "HNSW research" to memory ─┐
│  Cards: 47                               │
│  Est. cost:    ~$0.03 (embed)            │
│                ~$0.12 (summary LLM)      │
│  Scope: (•) User   ( ) Workspace         │
│         ( ) This section                 │
│  Tags:  [research, vector db]            │
│  [Cancel]              [Save to memory]  │
└──────────────────────────────────────────┘
```
POSTs `trigger:'canvas_saved'`.

Sidebar section right-click: "Save section to memory" — same modal, `trigger:'section_saved'`.

### 6.4 Response-time indicator

Card footer shows `🧠 N memory items used` when retrieval ran. Click → popover listing item texts + `strategy` + link to Settings → Memory filtered to those IDs.

Data source: `aiStreamWorkflow` streams a sentinel event `{type:'memory_used', itemIds:[...]}` at start of completion. Client stores on the card row. Graceful absence when retrieval skipped.

### 6.5 Free-user gate

Non-Pro users — Settings → Memory shows:

```
Memory is a Pro feature.
Capture prompt/response pairs across canvases, bring your own
embedding provider (OpenAI / local Ollama), or use Gateway (included).

Pro also gets: knowledge base, image attachments, sync across devices.

[Upgrade to Pro — $10/mo]
```

Ingest / search endpoints return 402. Slash-command shows toast: "Memory is a Pro feature".

### 6.6 Tauri local-embed bridge

- Tauri command `memory_local_embed(text: Vec<String>, endpoint: String, model_id: String) -> Vec<Vec<f32>>` in `apps/client/src-tauri/src/memory.rs`.
- Uses `reqwest` to POST Ollama's `/api/embeddings`.
- JS wrapper `packages/ui/src/memory/local-embed.ts` exposes `localEmbed(texts)` using `@tauri-apps/api/core invoke`.
- Settings "Test" probe calls this path with a 1-token string.
- On-device GGUF binding (llama.cpp Rust) is a deferred implementation swap behind the same Tauri command; spec-compatible today.

---

## 7. Testing strategy

### 7.1 Unit tests (Vitest, CI Linux)

`packages/memory/` (no DB):
- `registry.test.ts` — register/get/list, idempotent registration.
- `manager.test.ts` — ingest fan-out only to subscribed triggers; retrieve fans out, fuses, filters, truncates.
- `rrf.test.ts` — RRF math, weight application, dedup by item id.
- `injection.test.ts` — both formatters; token budget honored; empty items → empty injection (no spurious wrapper).
- `quota.test.ts` — quota math (item + byte caps); atomic counter updates.
- `embed.test.ts` — provider resolver; `local` throws `LocalEmbedRequired`.
- `strategies/rag.test.ts` — card_pair idempotency on response_sha256; note tag pass-through; canvas_snapshot fan-out (parent + N children; parent_snapshot_id linkage); 500-card ceiling → 413.

`apps/web/tests/integration/` (gated on `DATABASE_URL_ADMIN`):
- `memory-rls.test.ts` — cross-tenant isolation across all four new tables.
- `memory-ingest.test.ts` — `POST /api/memory/ingest` writes row + vector + usage row; bumps counters.
- `memory-search.test.ts` — semantic retrieval returns the right chunk (deterministic fixture vectors); scope hierarchy filter works; tag filter works.
- `memory-quota.test.ts` — 402 at item cap; 402 at byte cap; 402 for free tier.
- `memory-client-embed.test.ts` — `POST /api/memory/ingest/client-embed` validates dim vs registered model; mismatch → 400.
- `memory-snapshot.test.ts` — canvas_saved fans out parent + children with parent_snapshot_id; section_saved iterates canvases.
- `memory-auto-ingest.test.ts` — `aiStreamWorkflow` idempotency: re-running workflow does not double-insert.
- `memory-tier.test.ts` — free user endpoints → 402.

Fixtures: seed `users` row with `tier='pro'`, `memory_embedding_model_id='openai/text-embedding-3-small'`, deterministic vectors generated via `seed + index` (no live provider calls in tests).

### 7.2 Manual DoD pass

Pro-seeded user against a Preview deployment, walked end-to-end:

1. Sign in. Settings → Memory loads, zero items.
2. Provider picker: Gateway. Test probe succeeds.
3. Open canvas A. Submit prompt → card completes → Settings count = 1.
4. Open canvas B. Submit prompt referencing canvas A's content. Response uses retrieved memory. Footer: `🧠 1 memory item used`.
5. Slash-command `/remember #python list comprehensions are expressive` → toast confirms → Settings shows note row with tag `python`, scope `canvas`.
6. Right-click canvas A in sidebar → "Save canvas to memory" → modal → confirm → parent + children land, linked by `parent_snapshot_id`.
7. Switch embedding provider to Local Ollama (`nomic-embed-text`, dim 768). Test probe through local bridge passes. Warning modal → confirm → memory cleared.
8. Repeat step 3. Verify row stored with `dim=768`, `embedding_model_id='ollama/nomic-embed-text'`.
9. Hit item cap (seed 50,000 rows via test harness). Next ingest → 402 + quota-exceeded UI. "Clear all" resets.

### 7.3 CI

- `pnpm -w tsc -b` covers new `packages/memory`.
- Integration tests run on `DATABASE_URL_ADMIN` (existing pattern).
- Migration applied via Neon MCP `prepare_database_migration` + `run_sql_transaction` with leading `SET ROLE neondb_owner`.

---

## 8. Explicit deferrals

| Deferred to | Item |
|---|---|
| **M2** — Short-term layer | Canvas-scoped ephemeral tier, TTL, recency retrieval, fuse with long-term |
| **M3** — Hybrid retrieval | Postgres FTS / BM25 + hybrid ranking fuse + query rewriting |
| **M4** — Multi-embedding-model | `memory_vectors` multi-row concurrent storage; async re-embed Workflow; model-switch-without-clear UX |
| **M5** — Knowledge Base | `kb_doc` source_kind, file parsers, chunk strategies, drag-folder UX (PLAN §10 Phase 4 bullet 3) |
| **M6** — Per-scope embed pin | Per-canvas/section embedding-model override |
| **M7** — Consolidation | Short→long promotion, summarization, dedup, forgetting, live in-flight summarization, re-ingestion of card edits |
| Post-M7 | LLM tool-driven agentic retrieval (`memory.search` as a tool) |
| Phase 4 mobile finish or later | On-device GGUF embedding binding (Tauri bridge is shaped for it; Ollama HTTP only in M1) |
| First M1 amendment | Background reconcile cron for rows with missing vectors |
| Post-M1 | Retrieval cache (per-prompt memoization) |
| Ops ticket alongside M1 | Production observability dashboards (p95 retrieve latency, ingest success, cost per user per day) |

---

## 9. Risks

- **Embedding cost runaway on canvas/section snapshot.** Mitigation: 500-card ceiling + cost-preview modal + snapshot calls counted against the daily AI cap.
- **Retrieval quality tied to embedding model + chunking.** M1 uses card-pair-as-chunk (no sub-chunking). Very long responses (>8K tokens) become dense vectors that dilute ranking. Acceptable for v1; M5 or M7 introduces sub-chunking.
- **HNSW index build/rebuild cost at scale.** HNSW is incremental, but major pgvector upgrades may require `REINDEX CONCURRENTLY`. Mitigation: default `m=16`, `ef_construction=64`; document a rebuild runbook in the impl plan.
- **Strategy registry is module-static.** Hot-adding a strategy requires a redeploy. Fine for first-party v1. If third-party strategies ever happen, registry needs DB-backed discovery.
- **Dim-agnostic pgvector column** relies on pgvector ≥ 0.7 late-binding dim + HNSW. Impl plan must verify Neon's installed version before applying.
- **Free-tier gate drift.** If the product later offers a small free allowance, the 402 wall becomes a soft gate. Schema supports via `memory_strategy_config` and per-tier quota columns.
- **Workflow DevKit step granularity.** Ingestion-in-tail means a mid-flight failure after the response streamed leaves no memory row; user already saw the answer. Acceptable — memory is best-effort, the answer is the contract. Reconcile cron catches misses.
- **Browser handoff cookie / Clerk session for Settings page.** Already solved by Phase 2 + 3a auth flow; memory page is no new surface for auth.

---

## 10. Definition of Done

1. Migration `0004_memory_substrate.sql` applied on Neon prod. Four new tables + five `users` columns + `ai_usage.kind` column + HNSW index + RLS policies. `memory_chunks` stub dropped.
2. `packages/memory` builds clean under `pnpm -w tsc -b`. Exports stable barrel. Zero circular deps with `apps/web` / `packages/ui`.
3. `rag` strategy registers at server boot. Log line `memory.strategy.registered strategy=rag version=1.0.0` emitted.
4. Eight new `/api/memory/*` routes live. Each behind `withRls(userId, ...)`. Each returns 402 for non-Pro users.
5. `aiStreamWorkflow` integrated — retrieval step before `buildAttemptChain`, ingestion step in tail. Failures in either are logged + non-blocking. Workflow DevKit idempotency preserved.
6. Quota enforced. Pro cap = 50k items / 200 MB. Counters stay consistent under 100 parallel inserts (integration test).
7. Cost accounting — every embed call writes `ai_usage(kind='embedding')`. `checkCap()` sums both kinds.
8. UX surfaces shipped in `packages/ui`: Settings → Memory page, slash-command `/remember`, card/canvas/section "Save to memory" context menu + confirm modal, response footer indicator, free-user gate.
9. Tauri local-embed bridge works end-to-end against local Ollama. "Test" probe passes on a dev machine with Ollama running. On-device GGUF binding stubbed path-compatible.
10. Integration test matrix green (§7.1).
11. Manual DoD pass completed (§7.2 steps 1–9), recorded in PLAN.md build log.
12. PLAN.md build-log amendment documents: `memory_chunks` stub replacement; unified `ai_usage.kind` cap accounting; Phase 4 bullet 1 "chunk→embed→upsert" superseded by this framework spec series.
13. PLAN §9 unchanged — memory remains Pro-exclusive per locked pricing (b).
14. No work beyond M1 scope. M2–M7 remain deferred. Exit criteria PLAN §10 line 545 ("Pro users have memory") is satisfied for the memory bullet only; other Phase 4 bullets pursue their own specs.

---

## 11. Out of scope (this spec only)

This spec covers **M1 Memory Substrate + `rag` strategy**. The following are explicitly NOT addressed and will have their own specs in this series:

- Short-term / ephemeral tier — M2.
- Hybrid lexical + vector retrieval (BM25) — M3.
- Multi-embedding-model concurrent storage + async re-embed + switch-without-clear — M4.
- Knowledge Base file ingestion (drag-folder, parsers, chunking) — M5.
- Per-canvas / per-section embedding-model pin — M6.
- Consolidation (short→long promotion, summarization, dedup, forgetting, live in-flight summarization, re-ingestion of card edits) — M7.
- LLM-tool-driven agentic retrieval — post-M7.
- On-device GGUF embedding binding — Phase 4 mobile finish or later.
- Background reconcile cron for missing vectors — first M1 amendment.
- Retrieval cache — post-M1.
