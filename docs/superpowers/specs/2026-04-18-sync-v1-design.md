# Sync v1 — Desktop Tauri Client

**Status:** Design approved, ready for implementation plan
**Date:** 2026-04-18
**Phase:** Phase 2, Step 2 (PLAN.md §10)
**Related:** PLAN.md §3 (schema), §4 (sync protocol spec), `packages/sync-proto/src/index.ts` (wire types + HLC)

## Goal

Replace the desktop Tauri client's local-only state (Zustand + `localStorage` + `.scratch` file save/load) with a backend-synced model using a local SQLite mutation queue and `/api/sync/push` + `/api/sync/pull` endpoints. Single-active-device, last-write-wins by HLC. No conflict resolver beyond LWW.

## Non-goals

- Multi-device live collaboration (Phase 4 via Yjs CRDT swap).
- Web workbench canvas parity (web today is single-card; canvas UX port is out of scope).
- Mobile (Tauri Mobile reuses this engine in Phase 3 — no new work here).
- CRDT-level merge for text fields.
- Streaming response durability mid-stream.
- Rate limiting / per-user mutation quotas.
- Snapshot endpoint / tombstone GC (deferred, see §4 checklist).

## Locked design decisions

From brainstorming session (2026-04-18):

1. **Scope:** Desktop Tauri only in Phase 2. Mobile reuses in Phase 3. Web canvas deferred.
2. **Packaging:** Sync engine as a standalone TS package (`packages/sync-engine`) with a pluggable `Store` interface; one impl shipped (`TauriSqliteStore`).
3. **Runtime:** Engine runs in the renderer. No Rust-side worker in v1.
4. **Edit coalescing:** Optimistic in-memory Zustand updates + 500ms `DirtyTracker` flush to outbox.
5. **Streaming response persistence:** Final-mutation-only. `DirtyTracker` ignores `payload.response` while `status === 'streaming'`; one upsert on stream completion (or error).
6. **Single-active-device enforcement:** None. LWW handles concurrent writes. Revisit with v2 CRDT swap.
7. **Entity scope:** `cards`, `canvases`, `sections`. Not `workspaces` (lazy-created server-side), `model_slots`, `provider_connections`, `ai_usage`, `users`.
8. **First sign-in with existing local Zustand data:** Auto-migrate via synthesized upsert mutations; no user-facing import step.
9. **Server reconciliation:** Always append to `mutations` log. Upsert materialized row only when incoming HLC > current row version. Preserves history for v2.
10. **Echo handling:** Client skips pulled `ServerMutation`s where `deviceId === ownDeviceId`.

## Architecture

```
┌─────────── apps/client (Tauri renderer) ───────────┐
│                                                     │
│  React/Zustand (render state — instant updates)     │
│         ↕                                           │
│  SyncProvider (React context, starts loop on login) │
│         ↕                                           │
│  packages/sync-engine                               │
│    ├── SyncLoop       (triggers, backoff, concur)   │
│    ├── Outbox         (pending push queue)          │
│    ├── Reconciler     (apply server mutations→Store)│
│    ├── DirtyTracker   (500ms diff → mutations)      │
│    └── HttpClient     (/api/sync/push, /pull)       │
│         ↕ Store interface                           │
│  apps/client/src/sync/tauri-sqlite-store.ts         │
│         ↕ @tauri-apps/plugin-sql                    │
│  SQLite file (app data dir)                         │
└─────────────────────────────────────────────────────┘
         ↕ HTTPS + Clerk JWT
┌─────────── apps/web (Next.js) ──────────────────────┐
│  POST /api/sync/push   GET /api/sync/pull           │
│     ↕ withRls(userId, …)                            │
│  Neon Postgres: mutations, cards, canvases, sections│
└─────────────────────────────────────────────────────┘
```

**Key invariants:**

- Zustand = UI projection; SQLite = local source of truth; server `mutations` log = global truth.
- On startup: Zustand hydrates from SQLite (fast read), then SyncLoop pulls delta, then DirtyTracker begins observing.
- Every user action: Zustand updates immediately → DirtyTracker flags entity → 500ms debounce → snapshot diff → mutation into SQLite `outbox` → SyncLoop pushes.
- Mutations carry a client-generated `nanoid` id → idempotent replays on retry.
- `packages/sync-engine` has zero Tauri/React deps — pure TS, Node-testable.

## Components

### `packages/sync-engine/src/`

- **`store.ts`** — `Store` interface:
  ```ts
  interface Store {
    listCards(workspaceId: string): Promise<Card[]>
    listCanvases(workspaceId: string): Promise<Canvas[]>
    listSections(workspaceId: string): Promise<Section[]>
    upsertCard(c: Card): Promise<void>
    upsertCanvas(c: Canvas): Promise<void>
    upsertSection(s: Section): Promise<void>
    softDeleteCard(id: string, version: bigint): Promise<void>
    enqueue(m: Mutation): Promise<void>
    peekOutbox(limit: number): Promise<Mutation[]>
    removeFromOutbox(ids: string[]): Promise<void>
    getMeta(key: string): Promise<string | null>
    setMeta(key: string, value: string): Promise<void>
  }
  ```

- **`hlc.ts`** — re-exports `HLC`, `decodeHLC` from `@1scratch/sync-proto` for ergonomics.
- **`dirty-tracker.ts`** — subscribes to Zustand store changes, accumulates dirty `(entityType, entityId)` set, flushes every 500ms: reads current Zustand state, computes minimal patch vs last-flushed snapshot (from `flush_snapshot` table), produces `Mutation[]`, calls `Store.enqueue`.
- **`outbox.ts`** — wraps `Store.peekOutbox` / `removeFromOutbox` with in-memory retry-count metadata (resets on process restart).
- **`reconciler.ts`** — takes `ServerMutation[]`, applies in version order: upsert/softDelete, skips self-echoes (`deviceId === ownDeviceId`), advances `lastServerVersion`.
- **`http-client.ts`** — fetch wrapper for `/api/sync/push` + `/api/sync/pull`. Injects Clerk JWT via provided token-getter. Throws typed errors on 4xx / 5xx / network.
- **`sync-loop.ts`** — orchestrator. Manages triggers (timers, focus, manual), concurrency guard (one push + one pull max in-flight), exponential backoff (1s → 60s cap), online/offline state.
- **`index.ts`** — public factory:
  ```ts
  createSyncEngine(opts: {
    store: Store
    httpClient: HttpClient
    deviceId: string
    getAuthToken: () => Promise<string>
    onError?: (e: Error) => void
  }): {
    start(): void
    stop(): void
    triggerNow(): Promise<void>
    isOnline(): boolean
  }
  ```

### `apps/client/src/sync/`

- **`tauri-sqlite-store.ts`** — `Store` impl using `@tauri-apps/plugin-sql`. Handles schema migrations on open.
- **`sync-provider.tsx`** — React context. On login: creates engine, wires Zustand observer → `DirtyTracker`, exposes `isOnline`, `outboxDepth`, `triggerNow` to UI.
- **`migrate-zustand.ts`** — one-shot helper. Reads legacy `scratch-workspace` Zustand persist + any local card state; synthesizes upsert mutations with fresh HLCs; enqueues.
- **`hydrate.ts`** — reads SQLite into Zustand stores on app start.

### `apps/web/src/app/api/sync/`

- **`push/route.ts`** — POST. Validates body (zod), wraps `applyPush` in `withRls`. Returns `PushResponse`.
- **`pull/route.ts`** — GET. Parses `since` + `limit` query. Wraps `fetchSince` in `withRls`. Returns `PullResponse`.

### `apps/web/src/lib/sync/`

- **`apply-push.ts`** — pure function of `(tx, userId, body)`. Assigns server HLC, inserts into `mutations`, materializes LWW rows. Returns `PushResponse`.
- **`fetch-since.ts`** — queries `mutations` table since a version; returns `PullResponse`.

## Data flow

### Cold start (app launch, logged in)

1. `SyncProvider` mounts.
2. `Store.getMeta('deviceId')` — generate + persist `nanoid()` if missing.
3. `hydrate.ts`: `Store.listCards/Canvases/Sections` → load into Zustand.
4. `SyncLoop.start()`:
   a. `triggerNow()` → pull(since=lastServerVersion) → `Reconciler.apply` → update Zustand.
   b. Push any outbox items from last session.
5. `DirtyTracker` begins observing Zustand.
6. Periodic 30s poll + `window.focus` listener registered.

### User action (e.g., create card)

1. User left-clicks canvas → `Zustand.addCard(...)` → instant render.
2. `DirtyTracker` marks `('card', id)` dirty.
3. 500ms debounce fires:
   a. Read current Zustand card state for dirty ids.
   b. Diff vs `flush_snapshot` row → minimal patch.
   c. For each changed entity: `Mutation { id: nanoid, entityType, entityId, op: 'upsert', patch, clientVersion: HLC.now() }`.
   d. `Store.enqueue(mutations)` — writes to SQLite `outbox` + updates `flush_snapshot`.
4. `SyncLoop` trigger fires → push.

### Push path

1. `outbox.peek(limit=100)` → `Mutation[]`.
2. `HttpClient.push({ deviceId, baseVersion: lastServerVersion, mutations })`.
3. Server response: `{ accepted[], rejected[], serverVersion, additional[] }`.
4. `Store.removeFromOutbox(accepted)`.
5. Handle `rejected[]`: log to Sentry, mark outbox rows permanent-fail (UI surfaces count + discard option).
6. `Reconciler.apply(additional)`.
7. `setMeta('lastServerVersion', serverVersion)`.

### Pull path (poll / focus / manual)

1. `HttpClient.pull({ since: lastServerVersion, limit: 500 })`.
2. `Reconciler.apply(mutations)`:
   - Sorted by `version`.
   - Skip if `m.deviceId === ownDeviceId` (echo).
   - Dispatch by `entityType`: `upsert` → `Store.upsertX`, `delete` → `Store.softDeleteCard` (cards) or hard-delete (canvases/sections).
   - Update Zustand projection.
3. `setMeta('lastServerVersion', serverVersion)`.
4. If `more === true` → schedule next pull immediately.

### Streaming response

1. User submits prompt → `Zustand.updateCard({ status: 'streaming' })` → `DirtyTracker` flushes → server sees streaming.
2. Stream tokens update Zustand's `payload.response` in-memory.
3. `DirtyTracker` ignores `payload.response` while `status === 'streaming'` (no mutation emitted per token).
4. On stream finish: `Zustand.updateCard({ status: 'complete', response, model, tokens })` → `DirtyTracker` emits a single final upsert.
5. On stream error/cancel: `Zustand.updateCard({ status: 'error', errorMessage })` → final mutation with error state.

### First-login auto-migrate

1. After hydrate, before first pull: check `getMeta('migratedFromZustand')`.
2. If falsy AND `lastServerVersion === '0'`:
   a. Read legacy `scratch-workspace` Zustand persist blob + any card state.
   b. Build an id map: legacy nanoid → fresh UUIDv4 (`crypto.randomUUID()`). Server schema stores entity ids as UUID; nanoids can't go over the wire.
   c. Rewrite parent references (`sectionId` on canvases, `canvasId` on cards) through the id map.
   d. Synthesize `upsert` mutations with remapped ids; stamp fresh HLCs.
   e. `Store.enqueue(mutations)`.
   f. Update Zustand in-memory ids to match (so further edits produce consistent mutations).
   g. `setMeta('migratedFromZustand', 'true')`.
3. Push drains naturally on next `SyncLoop` tick.

**Going forward:** all new entity ids in the client are UUIDv4 via `crypto.randomUUID()`. Replace existing `nanoid()` calls in `apps/client/src/store/{cards,workspace}.ts`. `client_mutation_id` stays TEXT (nanoid is fine there since the column is TEXT).

## Sync triggers

| Trigger | Behavior |
|---|---|
| App cold start | Pull since last_seen. |
| `DirtyTracker` flush (500ms) | If outbox non-empty, kick push. |
| `additional[]` from push response | `Reconciler.apply`, advance last_seen, no extra pull. |
| Window focus (Tauri `WindowEvent::Focused(true)`) | Push + pull. |
| Periodic poll | 30s when visible; 5min when hidden. |
| Manual "Sync now" button | Push + pull. |
| `navigator.online` | Drain outbox then pull. |

**Concurrency:** at most one push + one pull in-flight. New trigger while busy → mark pending, run after current finishes.

## Local SQLite schema

Path: `${BaseDirectory.AppData}/scratch/sync.db`.

```sql
-- Materialized projections
CREATE TABLE canvases (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  section_id   TEXT NOT NULL,
  name         TEXT NOT NULL,
  color        TEXT,
  viewport     TEXT NOT NULL,    -- JSON
  position     INTEGER NOT NULL,
  version      TEXT NOT NULL,    -- HLC bigint as decimal string
  updated_at   INTEGER NOT NULL
);
CREATE INDEX canvases_section ON canvases(section_id, position);

CREATE TABLE sections (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name         TEXT NOT NULL,
  color        TEXT,
  position     INTEGER NOT NULL,
  permanent    INTEGER NOT NULL DEFAULT 0,
  version      TEXT NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE cards (
  id           TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  canvas_id    TEXT NOT NULL,
  type         TEXT NOT NULL,
  x REAL, y REAL, width REAL, height REAL, z_index INTEGER,
  payload      TEXT NOT NULL,    -- JSON
  version      TEXT NOT NULL,
  deleted_at   INTEGER,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX cards_canvas ON cards(canvas_id) WHERE deleted_at IS NULL;

CREATE TABLE outbox (
  id             TEXT PRIMARY KEY,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT NOT NULL,
  op             TEXT NOT NULL,
  patch          TEXT NOT NULL,
  client_version TEXT NOT NULL,
  created_at     INTEGER NOT NULL,
  retry_count    INTEGER NOT NULL DEFAULT 0,
  last_error     TEXT
);
CREATE INDEX outbox_order ON outbox(created_at);

CREATE TABLE meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE flush_snapshot (
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  snapshot    TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
```

**Version representation:** stored as decimal string to avoid bigint-vs-SQLite-INTEGER ambiguity and match wire format.

**Migrations:** single `0001_init.sql` for v1. Future migrations numbered; `tauri-sqlite-store.ts` tracks schema version in `meta`.

## Wire protocol

Reuses `packages/sync-proto/src/index.ts` as-is. Two notes:

- **Tenancy:** `Mutation` does not carry `workspaceId`. Server derives from auth context (one workspace per user in v1).
- **Rejection reason `'quota_exceeded'`:** unused in v1; retained for forward-compat.

## Server implementation

### `POST /api/sync/push`

1. Clerk `auth()` → `userId`; 401 if missing.
2. Validate body against zod schema mirroring `PushRequest`.
3. `withRls(userId, async (tx) => applyPush(tx, userId, body))`.

### `applyPush(tx, userId, body)`

1. Resolve `workspaceId` for `userId` (create lazily if first push ever).
2. Initialize server HLC from cached `max(server_version) from mutations where user_id = $1`.
3. For each mutation in array order:
   a. `hlc.observe(m.clientVersion)` then `serverVersion = hlc.now()`.
   b. `INSERT INTO mutations (user_id, device_id, client_mutation_id, entity_type, entity_id, op, patch, client_version, server_version) VALUES (...) ON CONFLICT (user_id, client_mutation_id) DO NOTHING` — idempotent retry.
   c. If `op === 'upsert'`:
      - `INSERT INTO {cards|canvases|sections} (...) ON CONFLICT (id) DO UPDATE SET ... WHERE {table}.version < EXCLUDED.version`.
      - "DO NOTHING" branch when older = intentional LWW.
   d. If `op === 'delete'`:
      - cards: `UPDATE SET deleted_at = now(), version = $serverVersion WHERE id = $entityId AND version < $serverVersion`.
      - canvases/sections: `UPDATE SET deleted_at = now()` if older (spec adds soft-delete on these too for v2 readiness; if current schema lacks `deleted_at` on sections/canvases, use hard DELETE in v1 and defer soft-delete to Phase 4 multi-device swap).
   e. Push mutation's `client_mutation_id` to `accepted[]` on success; otherwise to `rejected[]`.
4. `additional[]`: `SELECT ... FROM mutations WHERE user_id = $1 AND server_version > $baseVersion AND device_id != $deviceId ORDER BY server_version LIMIT 500`.
5. Response `serverVersion` = max server HLC reached by this push (or the baseline if no mutations applied).
6. Return `PushResponse`.

### `GET /api/sync/pull?since=<hlc>&limit=<int>`

1. Clerk auth → `userId`.
2. Validate query (zod).
3. `withRls(userId, async (tx) => fetchSince(tx, userId, since, limit ?? 500))`.

### `fetchSince(tx, userId, since, limit)`

```sql
SELECT client_mutation_id AS id, entity_type, entity_id, op, patch,
       server_version AS version, device_id, created_at
FROM mutations
WHERE user_id = $1 AND server_version > $since
ORDER BY server_version
LIMIT $limit + 1
```

- Take first `limit` rows; `more = rows.length > limit`.
- `serverVersion = max(server_version in result) OR $since if empty`.

### Schema — already in place

No new migration required. `apps/web/src/db/schema.ts` already defines:
- `mutations.client_mutation_id` (text) with `uniqueIndex('mutations_idempotency_idx')` on `(user_id, client_mutation_id)` — idempotent retries.
- `mutations.server_id` (bigserial PK, append order) and `mutations.server_version` (bigint HLC) as distinct columns.
- `cards`, `canvases`, `sections` all have `version bigint` + `deleted_at` (cards only).

Implementation notes for server handlers:
- `fetchSince` pages by `server_version` (the HLC), not `server_id`, to match client's `lastServerVersion` tracking.
- `applyPush` returns `accepted[]` keyed by `client_mutation_id`.

### Tenancy

RLS already filters by `app.user_id` GUC. Push/pull routes wrap in `withRls(userId, …)` — no cross-tenant leak.

### Rate limiting

None in v1. BotID blocks scrapers at edge. Add per-user rate if abuse emerges.

### Payload limits

- `PushRequest` body max 1 MB (Next.js default).
- Client chunks `mutations[]` at 200 per push if outbox larger.
- Patch JSON max 64 KB per mutation (server-enforced; reject `invalid` if exceeded).

## Error handling

### Client-side

| Failure | Behavior |
|---|---|
| Network offline | SyncLoop marks offline, suspends polls. DirtyTracker keeps enqueueing. Drain on `navigator.online`. |
| Push 5xx / timeout | Exponential backoff (1s → 60s cap). Mutations stay in outbox. Sentry breadcrumb after 5 failures. |
| Push 401 | Refresh Clerk session; retry once; on repeat fail → sign out + "Please sign in again". |
| Push 400 rejected per-mutation | Mark outbox row `retry_count=permanent`. Surface count in Settings → Sync Diagnostics. |
| Body > 1 MB | Chunk at 200 mutations. |
| Pull 5xx | Backoff same as push. |
| SQLite write fails | Toast + Sentry. Subsequent writes fail until resolved. |
| Crash mid-push | Un-acked items stay in outbox. On restart, push retries. Server idempotent via `client_mutation_id`. |
| Streaming interrupted | `onError`/`onCancel` sets `status='error'` → mutation flushes. |

### Server-side

| Case | Handling |
|---|---|
| Duplicate mutation id (retry) | `INSERT ... ON CONFLICT (client_mutation_id) DO NOTHING`. |
| Out-of-order within a push | Apply in array order; HLC resolves materialized-row LWW. |
| Child mutation with missing parent (in same push, parent earlier) | Fine. |
| Child mutation with missing parent (never seen) | Reject `invalid`. Client refetches via pull. |
| Patch JSON > 64 KB | Reject `invalid`. |
| User deleted mid-sync | RLS returns empty; push returns `forbidden` for all mutations; client clears local state on re-auth fail. |
| Future: `since` older than GC horizon | Client needs snapshot endpoint. Deferred (no GC in v1). |

## Observability

- Sentry breadcrumbs per push/pull: timing, mutation count, response status.
- Axiom events: `sync.push.bytes`, `sync.outbox.depth`, `sync.pull.backlog`.
- UI: Settings → Sync Diagnostics panel showing outbox depth, last sync time, last error, manual sync button.

## Testing

### Unit tests (Node, vitest)

**`packages/sync-engine/`:**
- `hlc.test.ts` — extend `sync-proto` tests with clock-regression, concurrent-observe cases.
- `dirty-tracker.test.ts` — fake Zustand subject + fake Store: create, update (multi-field), rapid successive edits (coalesce), streaming card (suppress `response` while `status==='streaming'`).
- `reconciler.test.ts` — order-of-application, LWW when local version > incoming, echo filtering by deviceId, upsert+delete on same entity in one batch.
- `sync-loop.test.ts` — fake http + fake store: trigger coalescing, backoff timing, offline/online transitions, concurrency guard.
- `outbox.test.ts` — enqueue/peek/remove ordering, retry-count persistence.

**`apps/web/src/lib/sync/`:**
- `apply-push.test.ts` (gated on `DATABASE_URL_ADMIN` like existing `rls.test.ts`):
  - happy path: 5 upserts accepted, materialized rows match.
  - idempotent retry: same push twice → no duplicates.
  - LWW: push with `clientVersion < currentRow.version` → row unchanged, mutation still logged.
  - cross-tenant: user B using user A's entityId → RLS rejects.
  - malformed patch → rejected, others accepted.
- `fetch-since.test.ts`: pagination (`more=true`), `since=0` returns everything, empty response preserves `serverVersion`.

### Integration tests (`apps/web/tests/integration/sync-push-pull.test.ts`)

- Two fake devices sharing a user:
  - Device A pushes 3 cards → Device B pulls → sees 3.
  - Device A pushes → Device A pulls → echoes filtered.
  - Concurrent pushes from both → both logged, LWW on materialized row.

### Manual QA (Tauri)

- Fresh install: create cards → restart → cards present.
- Mid-edit disconnect: unplug wifi, drag cards, reconnect → outbox drains, server reflects final positions.
- Two-device: sign in on second machine → state mirrors.
- Zustand migration: user with Phase 0 local data signs in → cards/canvases/sections appear in Neon.
- Streaming crash: kill app mid-stream → restart → card shows `status='error'` or prior `complete` (never mid-stream partial).

### Coverage gate

- `packages/sync-engine` ≥ 80% lines.
- Server routes covered by integration test.

## Open items handed to implementation plan

- Choose SQLite schema version storage key (`meta.schema_version` recommended).
- Sync Diagnostics UI surface: new Settings sub-page vs. appended to existing `/app/settings`. Lean: appended.
- Whether to add `deleted_at` columns to `canvases` + `sections` now (multi-device readiness, minor migration) or defer to Phase 4 (hard-delete v1). Lean: defer — v1 single-active-device makes concurrent delete-vs-edit races moot.
- Auth token plumbing into the Tauri client (how `getAuthToken()` retrieves the Clerk JWT from the desktop session — coordinates with Phase 2 step 1 client-swap work).
