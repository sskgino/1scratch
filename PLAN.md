# Scratch — Platform Ultraplan

> **Scope:** Take the existing single-user local Tauri MVP and turn it into a worldwide multi-tenant SaaS with desktop **and** mobile clients, BYOK + provider OAuth, multi-model support (Anthropic/OpenAI/Google/Ollama/local), sync-on-change architecture (with a multi-device-ready substrate), launching on App Store + Play Store + desktop in **~3 months**.
>
> **Target:** Plan for **100K users** (worldwide). All decisions sized for that ceiling.
>
> **Non-negotiable:** **Security first.** Encrypted-at-rest credentials, server-side AI proxy, OIDC sign-in, per-user spend caps, row-level isolation, audited auth events.

---

## 0. Foundation — Local Tauri MVP (✅ done)

The existing app is the canvas + card UX + Anthropic streaming, all running locally. That code is the foundation; the platform plan layers a backend, account system, sync, and mobile distribution underneath/around it. The full local-app design is preserved at the bottom of this doc as **Appendix A** (originally Phases 1-2 of the previous plan).

What we keep:
- The infinite-canvas + card metaphor
- Zustand stores (`canvas`, `cards`, `workspace`, `settings`)
- React 19 + Vite + Tailwind v4 frontend
- Tauri v2 desktop shell (now also: Tauri 2 Mobile)

What we replace:
- `localStorage` API-key storage → server-side encrypted credential vault
- Direct browser-to-Anthropic call (`dangerouslyAllowBrowser: true`) → server proxy via Vercel AI Gateway
- File-based `.scratch` JSON saves → Postgres-backed canvases with sync log
- Single-user state → multi-tenant with row-level isolation and OIDC auth

---

## 1. Stack at a Glance

| Layer | Choice | Why |
|---|---|---|
| **Frontend (desktop)** | Tauri v2 + React 19 + Vite | Already in place |
| **Frontend (mobile)** | **Tauri 2 Mobile** (iOS + Android) | Reuse ~85% of React code per user choice |
| **Backend** | **Vercel** (Next.js 16 App Router + Fluid Compute) | Fluid Compute handles streaming AI proxy + scales to 100K+ MAU; multi-region functions |
| **Auth** | **Clerk** (Vercel Marketplace) | Out-of-box Google/Apple/GitHub/magic-link/password, SOC2, GDPR-ready, ~$25/mo + $0.02/MAU above 10K |
| **Primary DB** | **Neon Postgres** (Marketplace) | Branching for preview envs, autoscaling, read replicas in EU/APAC |
| **Edge reads** | **Vercel Edge Config** | Model registry, feature flags, palette — read in <10ms worldwide |
| **AI proxy** | **Vercel AI Gateway** | Multi-provider, BYOK passthrough, fallbacks, ZDR, observability |
| **Vector / memory** | **pgvector on Neon** | Pro-tier "memory" feature; same DB, no extra service |
| **Object storage** | **Vercel Blob** (private) | Image attachments, exported canvases |
| **Sync queue** | **Vercel Queues** (public beta) | At-least-once replay of offline mutations |
| **Durable AI workflows** | **Vercel Workflow DevKit** | Resumable streams, retry on provider 5xx, memory ingestion pipeline |
| **Bot protection** | **Vercel BotID** | Auth + AI proxy endpoints |
| **Email** | **Resend** (Marketplace) | Magic links, security alerts, billing |
| **Billing** | **Paddle** (Merchant of Record) | Pro subscription; Paddle handles VAT/sales tax filing worldwide |
| **Observability** | **Vercel Analytics + Sentry + Axiom** | Web vitals, errors, structured logs |
| **Local AI on mobile** | **llama.cpp via Rust crate** in Tauri | Gemma 2B / Phi-3-mini / Llama 3.2 — runs offline |
| **Config file** | **vercel.ts** | TypeScript-typed deploy config |
| **Node runtime** | Node.js 24 LTS (Vercel default) | — |

**Why Vercel for 100K users worldwide:** Fluid Compute reuses function instances for concurrent requests (much lower cold-start cost than classic serverless), multi-region deployment is one config flag, AI Gateway is the path of least resistance for multi-provider, and the Marketplace integrations (Clerk, Neon, Resend) are auto-provisioned with environment variables. (Paddle is integrated separately via webhooks — not on the Vercel Marketplace.) At 100K MAU rough infra cost incl. payment fees: **~$6-9K/mo**, comfortable against a 3% Pro conversion at $10/mo (~$30K MRR).

---

## 2. Threat Model

| Threat | Mitigation |
|---|---|
| API key exfiltration from client bundle | Keys **never** exist on client. All AI calls proxied. |
| API key theft from DB dump | **Envelope encryption**: per-key AES-256-GCM with DEK; DEK encrypted by KMS-held KEK. DB compromise alone yields ciphertext. |
| Cross-tenant data leak | Postgres **row-level security** policies on every table; all queries scoped by `user_id` derived from verified session. |
| Stolen session token | Short-lived (15 min) access JWT + 30-day refresh token rotated on use; refresh stored in OS-secure store (Keychain/Keystore); revocable server-side. |
| Account takeover via OAuth | Clerk-managed: email verification required, suspicious-sign-in detection, optional MFA. |
| Runaway AI cost (key compromise or abuse) | Per-user **hard daily $ cap** + RPM rate limit on AI proxy. Alerts at 50/80/100% of cap. |
| Bot signups / credential stuffing | Vercel BotID on `/auth/*` and `/ai/*`. |
| Server-side request forgery via Ollama URL | Allowlist scheme/host patterns; block RFC1918 + link-local; require user-supplied bearer token; never proxy Ollama through our servers — invoke direct from client to user's local network. |
| Prompt injection (stored content executes tool calls) | Tool use disabled in v1; content sanitized before rendering markdown (already using `react-markdown` which is safe by default). |
| Mobile binary reverse-engineering reveals endpoints | Endpoints are public anyway (auth-gated). No secrets in binary. Cert-pin to `*.1scratch.ai` to harden against MITM on hostile networks. |
| GDPR — right to erasure | `DELETE /me/account` cascades deletes all user-owned rows; Blob URLs purged; logs retained 30 days then auto-pruned (Axiom retention policy). |
| GDPR / data residency | EU-resident users → DB writes routed to EU Neon read-replica + future EU primary if needed. Today: single-region (us-east-1) primary; document residency limit, add EU region in Phase 4. |
| Compromised provider OAuth refresh token | Tokens encrypted at rest, rotated, scoped read-only where the provider allows. Per-token revoke endpoint. |

**Audit log table** (`auth_events`) captures: sign-in, sign-out, token refresh, credential add/remove/decrypt-for-use, billing change, account delete. Retained 90 days, queryable by user.

---

## 3. Data Model

Postgres. All tables include `id (uuid pk default gen_random_uuid())`, `user_id (uuid not null)`, `created_at`, `updated_at`. RLS on every table: `using (user_id = current_setting('app.user_id')::uuid)`.

```sql
-- Identity is owned by Clerk; we mirror just what we need.
users (
  id uuid pk,                      -- = Clerk user id
  email text not null unique,
  display_name text,
  tier text not null default 'free' check (tier in ('free','pro')),
  daily_ai_cap_cents int not null default 200,  -- $2/day default
  created_at, updated_at
)

-- Workspaces map 1:1 to a user today; structured for future "team" concept.
workspaces (id, owner_id → users, name, created_at, updated_at)

-- The sidebar sections from the local app.
sections (id, workspace_id, name, color, position int, permanent bool, created_at, updated_at)

-- Horizontal tabs (canvases) inside a section.
canvases (
  id, workspace_id, section_id,
  name, color,
  viewport jsonb not null,         -- { panX, panY, zoom }
  position int,
  version bigint not null default 0,    -- HLC-encoded; bumped on every write
  created_at, updated_at
)

-- One row per card. JSONB for the type-specific payload keeps schema flexible.
cards (
  id, workspace_id, canvas_id,
  type text not null,              -- 'card' for now; expansion-ready
  x real, y real, width real, height real, z_index int,
  payload jsonb not null,          -- { prompt, modelSlot, response, model, status, ... }
  version bigint not null,
  deleted_at timestamptz,          -- soft-delete for sync semantics
  created_at, updated_at
)

-- Append-only change log for sync.
mutations (
  id bigserial pk,
  user_id uuid not null,
  workspace_id uuid not null,
  device_id text not null,
  version bigint not null,         -- HLC at write time
  entity_type text not null,       -- 'card' | 'canvas' | 'section'
  entity_id uuid not null,
  op text not null,                -- 'upsert' | 'delete'
  patch jsonb not null,            -- minimal diff for upserts
  created_at timestamptz not null default now()
);
create index on mutations (user_id, version);

-- Provider connections — encrypted credentials.
provider_connections (
  id, user_id,
  provider text not null,          -- 'anthropic'|'openai'|'google'|'openrouter'|'vercel-gateway'|'ollama'
  kind text not null,              -- 'api_key' | 'oauth'
  label text,                      -- user-facing nickname
  -- For api_key: encrypted with envelope encryption
  ciphertext bytea,
  dek_id text,                     -- references KMS-managed DEK
  -- For oauth:
  oauth_access_ciphertext bytea,
  oauth_refresh_ciphertext bytea,
  oauth_expires_at timestamptz,
  oauth_scopes text[],
  -- For ollama:
  endpoint_url text,
  endpoint_token_ciphertext bytea,
  status text not null default 'unverified',  -- 'unverified'|'connected'|'invalid'|'revoked'
  last_verified_at timestamptz,
  created_at, updated_at,
  unique (user_id, provider, label)
)

-- The 0–9 model slots, now per-user and decoupled from connection.
model_slots (
  user_id, slot smallint check (slot between 0 and 9),
  provider_connection_id uuid references provider_connections(id) on delete set null,
  model_id text,                   -- e.g. 'claude-sonnet-4-6', 'gpt-5o', 'ollama/gemma2:2b'
  display_label text,
  primary key (user_id, slot)
)

-- AI usage ledger — for spend caps + Pro analytics.
ai_usage (
  id bigserial,
  user_id uuid,
  ts timestamptz not null default now(),
  provider text, model text, slot smallint,
  input_tokens int, output_tokens int,
  cost_cents int,                  -- estimated using priced model registry
  request_id text                  -- correlate with AI Gateway logs
);
create index on ai_usage (user_id, ts);

-- Pro: long-term memory. Embeddings live alongside source text.
memory_chunks (
  id, user_id, source_canvas_id,
  text text, embedding vector(1536),
  created_at
);
create index on memory_chunks using ivfflat (embedding vector_cosine_ops);

-- Audit log
auth_events (id bigserial, user_id, kind, ip inet, ua text, meta jsonb, ts)
```

**Deliberate choices:**
- `payload jsonb` on `cards` — avoids schema migrations as new card types appear. Index the few fields we ever query (none today; canvas-level fetches return all cards).
- `version bigint` everywhere — encoded **Hybrid Logical Clock** (`(timestamp_ms << 16) | logical_counter`). Lets us reconcile concurrent writes deterministically without server round-trips, and is forward-compatible with CRDTs.
- `mutations` log is the truth for sync; `cards`/`canvases` are materialized views the server keeps current. Lets a client say "give me everything since version X" with a single indexed scan.
- `model_slots` decoupled from `provider_connections` — a slot can hold any model from any connection, and a connection failure doesn't blank the slot's model name.

---

## 4. Sync Protocol (multi-device-ready from day one)

Even though v1 is **single-active-device**, we bake in the substrate so v2 (live multi-device) is a swap of the merge layer, not a rewrite.

### Client → Server

Every mutation is appended locally first to a mutation queue (SQLite via Tauri SQL plugin / `@tauri-apps/plugin-sql`). The queue replays to the server when online.

```
POST /sync/push
Authorization: Bearer <jwt>
Body: {
  device_id: "uuid-stable-per-install",
  base_version: 12345,           // last server version this device has seen
  mutations: [
    { id, entity_type, entity_id, op, patch, client_version }
  ]
}
Response: {
  accepted: [mutation_id, ...],
  rejected: [{ mutation_id, reason }],
  server_version: 12350
}
```

Server applies in order, assigns server-side HLC, writes to `mutations` log, and updates materialized rows. Conflicts: last-write-wins by HLC for v1; for known-conflict-prone fields (e.g. `cards.payload.prompt`), we'll layer Yjs in v2.

### Server → Client

```
GET /sync/pull?since=12340
Response: {
  mutations: [...],
  server_version: 12350,
  more: false
}
```

Triggers:
- App focus (web visibility / mobile foreground)
- Successful push (server may include other devices' mutations in response)
- Manual refresh
- Periodic poll: every 30s when active
- (Phase 2) WebSocket / SSE push from server when other device commits

**Offline behavior (mobile):** All writes go to local SQLite immediately. Mutation queue grows. On reconnect, push queue then pull. AI calls fail gracefully with "offline — try a local model" CTA. Local Ollama / on-device models continue to work.

### Multi-device readiness checklist (now, even with single-active enforcement)

- ✅ HLC-encoded versions on every record
- ✅ Stable `device_id` per install
- ✅ Append-only mutation log
- ✅ Patch-based payloads (so partial conflicts are reconcilable)
- ⏳ Soft-delete with `deleted_at` (cards table) — required so deletes don't lose to concurrent edits
- ⏳ Tombstone GC after 30 days
- 🔮 **Phase 2 swap:** introduce Yjs documents per `canvas`, persist Yjs binary updates in a new `canvas_doc_updates` table, server is just a relay. Existing card-table rows continue to exist as a queryable projection.

### Architecture (v1 — Phase 2 step 2)

Implementation architecture for the desktop Tauri client. Mobile (Phase 3) reuses the same engine via `@tauri-apps/plugin-sql`. Web gets an IndexedDB store impl only when/if the canvas UX ports to web.

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
- Every user action: Zustand updates immediately → DirtyTracker flags entity → 500ms debounce → snapshot diff → mutation into SQLite `outbox` table → SyncLoop pushes.
- Mutations carry a client-generated `nanoid` id → idempotent replays on retry.
- `packages/sync-engine` has zero Tauri/React deps — pure TS, Node-testable; `Store` interface is the seam for future IndexedDB / other impls.

**Locked design decisions (from brainstorming 2026-04-18):**
- Scope: desktop Tauri only in Phase 2; mobile reuses in Phase 3; web canvas deferred.
- Streaming response persistence: final-mutation-only (single upsert on stream completion; partial text not durable mid-stream).
- Edit coalescing: optimistic in-memory via Zustand + 500ms DirtyTracker flush to outbox.
- Single-active-device: no enforcement in v1; LWW by HLC handles concurrent writes; revisit with v2 CRDT swap.
- Entity scope: `cards`, `canvases`, `sections` only. Not `workspaces`/`model_slots`/`provider_connections`/`ai_usage`.
- First-sign-in with existing local Zustand data: auto-migrate via synthesized upsert mutations; no user-facing import step.
- Server reconciliation: always append to `mutations` log; upsert materialized row only when incoming HLC > current row version. Preserves history for v2.
- Echo handling: client skips pulled `ServerMutation`s where `deviceId === ownDeviceId`.

Full spec: `docs/superpowers/specs/2026-04-18-sync-v1-design.md`.

---

## 5. Auth Flow

**Provider:** Clerk via Vercel Marketplace (auto-provisions env vars).

**Sign-in methods enabled:**
- Google
- **Apple** (mandatory if any other third-party SSO is offered, per App Store rules — we have several)
- GitHub
- Email magic link (Resend as transactional sender)
- Email + password

**Session model:**
- 15-min access JWT (in memory only, never persisted)
- 30-day refresh token, rotated on every use, stored in:
  - Desktop (Tauri): `tauri-plugin-stronghold` (encrypted vault) or OS keychain via `tauri-plugin-keyring`
  - iOS: Keychain (via Tauri Mobile plugin or Rust binding)
  - Android: EncryptedSharedPreferences / Keystore

**Backend session middleware:** Next.js middleware (Vercel Routing Middleware now powered by Fluid Compute) verifies JWT signature with Clerk's JWKS, extracts `user_id`, sets `app.user_id` Postgres GUC for RLS.

**Account deletion:** Self-serve from Settings → "Delete account". Cascades delete across all owned rows + Blob objects. Audit-logged. Confirmation via email link with 24-hr cool-off (revocable within 24 hr).

---

## 6. Provider Architecture

The 9 model slots can point to a model from any of these provider types:

| Provider | Connection method | OAuth available? | Notes |
|---|---|---|---|
| **Anthropic** | BYOK API key | No public consumer OAuth | Validate via `messages.count_tokens` probe |
| **OpenAI** | BYOK API key | No (enterprise SSO only) | Validate via `/v1/models` probe |
| **Google AI Studio** | BYOK API key | (Google OAuth → Vertex possible later) | API key is simplest |
| **Mistral / Cohere / Groq / xAI** | BYOK API key | No | Pattern: validate via small probe |
| **OpenRouter** | BYOK API key OR **OAuth** ✓ | **Yes — supports PKCE OAuth** | One credential → 200+ models. Recommend as default for users who don't want to manage keys. |
| **Vercel AI Gateway (BYOK passthrough)** | Server-managed | n/a | We use this internally as the proxy layer; passes through user's keys |
| **Ollama / local** | Endpoint URL + optional bearer | n/a | Direct from client (we never see the URL) |
| **On-device (mobile)** | none — bundled | n/a | llama.cpp Rust binding |

**Validation pattern:** "Connect" → server calls a 1-token / list-models probe with the user's credential → returns `connected | invalid | rate_limited` + the list of available models for that provider. Result cached 24h.

**Proxy flow:** Client requests `POST /ai/stream { slot, prompt }` → server resolves slot → fetches encrypted credential → decrypts in-memory → forwards via AI Gateway → streams response back via SSE. Audit row + usage row written on completion. `Workflow DevKit` wraps the call so a transient provider 5xx auto-retries with another model in the slot's fallback chain (set in Edge Config).

**OAuth model accounts ("web logins"):** Where the provider supports it (OpenRouter today; more coming), we run a standard PKCE flow:
1. Client opens system browser (Tauri: `tauri-plugin-shell.open`) → provider authorize URL with our `redirect_uri`
2. User approves → provider redirects to `https://app.1scratch.ai/oauth/callback?code=...`
3. Server exchanges code for tokens, encrypts both, writes `provider_connections` row, kicks back to app via deep link `1scratch://oauth/done?id=...`
4. Refresh handled server-side on demand

---

## 7. Model Page UX Spec

This is the screen the user described — 9 pill buttons (slots 0-9), click to add/edit a model.

```
┌─────────────────────────────────────────────────────────┐
│  Models                                          [Help] │
│                                                          │
│   ┌─0─┐ ┌─1─┐ ┌─2─┐ ┌─3─┐ ┌─4─┐                          │
│   │Snt│ │Opus│ │GPT5│ │ + │ │ + │                        │
│   └───┘ └───┘ └───┘ └───┘ └───┘                          │
│   ┌─5─┐ ┌─6─┐ ┌─7─┐ ┌─8─┐ ┌─9─┐                          │
│   │ + │ │ + │ │ + │ │Gem│ │Lmm│                          │
│   └───┘ └───┘ └───┘ └───┘ └───┘                          │
│                                                          │
│  CONNECTED PROVIDERS                                     │
│   • Anthropic       [verified ✓ 3 hr ago]    [Test] [×] │
│   • OpenRouter      [verified ✓ today]       [Test] [×] │
│   • Ollama (local)  [reachable ✓]            [Test] [×] │
│                                                          │
│   [+ Connect a provider]                                 │
└─────────────────────────────────────────────────────────┘
```

**Interactions:**
- Click a slot → opens slot editor:
  - Pick provider (only connected ones; greyed if missing)
  - Pick model (live-fetched list if BYOK is verified)
  - Optional: short label override
  - Save → slot updated; closing snaps back to grid
- Drag a slot onto another → swap (also: keyboard `Alt+arrows`)
- "Test" → fires a single low-cost call, shows latency + cost estimate
- "+ Connect a provider" → modal with the provider list, picks BYOK vs OAuth depending on what the provider supports
- Empty slot pill is dashed-outline with `+` glyph
- Filled slot shows: short model abbreviation + provider color dot + connection-status indicator

**Verification states:**
- 🟢 verified within last 24h
- 🟡 stale verification (24h-7d) — one-click re-verify
- 🔴 invalid (last call returned 401/403) — slot disabled, prompts to re-connect

**Pill style:** Sidebar pill style (since this is a settings surface, matches the vertical-tab pill aesthetic the user likes). Soft pastel background tied to provider color.

---

## 8. Mobile Considerations (Tauri 2 Mobile)

**The honest tradeoff:** Tauri Mobile is the right pick for code reuse but is **less mature** than React Native. Things we'll need to build / use plugins for:

| Need | Approach | Risk |
|---|---|---|
| Secure key storage | iOS Keychain / Android Keystore via Rust bindings | Medium — write thin wrapper plugin |
| Push notifications | `tauri-plugin-notification` + APNs/FCM via backend | Low |
| Background sync | iOS BGTaskScheduler + Android WorkManager via Rust | **High — bespoke per-platform**, scope to "sync on app launch + foreground" for v1 |
| Biometric unlock | `tauri-plugin-biometric` (community) | Medium |
| Deep links (OAuth callback) | `tauri-plugin-deep-link` | Low |
| Local SQLite | `tauri-plugin-sql` (sqlite) | Low |
| Camera / photo picker | `tauri-plugin-fs` + native pickers | Low |
| llama.cpp on-device | `llama-cpp-rs` crate, custom wrapper command | **High** — defer to Phase 3 |

**App Store specifics (day one):**
- Apple Developer Program ($99/yr) registered Day 1
- Apple Sign-In **mandatory** (we have Google/GitHub) — already in scope
- App Tracking Transparency prompt only if we add tracking SDKs (we won't)
- Privacy Manifest: declare network reasons + storage uses
- Plan **2 weeks slack** for first review
- Crypto export compliance: AES-only, no novel crypto → standard exemption declaration

**Play Store specifics:**
- Play Console fee ($25 one-time)
- Data Safety section filled honestly
- Internal testing track from week 6, closed beta week 10

---

## 9. Free vs Paid

| Feature | Free (BYOK) | Pro ($10/mo) |
|---|---|---|
| Unlimited canvases & cards | ✓ | ✓ |
| BYOK (any provider) | ✓ | ✓ |
| Local / Ollama models | ✓ | ✓ |
| On-device mobile models (Gemma, Phi) | ✓ | ✓ |
| Sync across devices | 1 device | Unlimited |
| Version history | 7 days | 90 days |
| **Persistent memory** (vector recall across canvases) | — | ✓ |
| Image / file attachments | — | ✓ |
| Knowledge base ingestion | — | ✓ |
| Higher daily AI proxy cap | — | ✓ (configurable) |
| Priority support | — | ✓ |

Conversion narrative: free plan does everything a power user needs (BYOK = no provider markup), but the moment you want **memory across canvases** or **multi-device sync**, you upgrade.

---

## 10. Three-Month Roadmap

Each phase is ~3 weeks. Dates are calendar weeks from kickoff (W0 = today).

### Phase 1 — Backend Foundation (W0 → W3)

**Goal:** A deployed Vercel app, schema in Neon, Clerk login working, AI proxy streaming end-to-end. No mobile yet, no sync — just prove the spine.

**Provisioning runbook:** full executable checklist at [`docs/provisioning.md`](./docs/provisioning.md). Summary of status below (as of 2026-04-18):

- [x] **Vercel project** — `1scratch-web` linked, root `apps/web`, Node 24.x, domains `app.1scratch.ai` + `api.1scratch.ai`, first deploy green
- [x] **Neon DB (us-east-1)** — via Marketplace, branching enabled, migrations applied, `admin_user` role + `DATABASE_URL_ADMIN` provisioned (see runbook Step 2 for `BYPASSRLS` gotcha)
- [ ] **Neon EU read replica** — deferred to Phase 4
- [x] **AWS KMS** — KEK `alias/1scratch-kek-prod` in us-east-1, IAM user `vercel-kms-1scratch`, seal/open verified, EncryptionContext binding enforced
- [x] **AI Gateway** — key `1scratch-server` created, Anthropic call verified; ZDR toggle deferred (Hobby plan — tracked in TODO)
- [x] **Resend** — manual signup (Marketplace integration failed), `1scratch.ai` domain verified via Cloudflare DNS, test send confirmed
- [x] **Clerk** — Marketplace integration + dashboard session/JWT/origins done; webhook endpoint registered (Prod+Preview+Dev); `email.created` → Resend handler live for unlocked templates. Three templates (Verification code, Reset password code, Invitation) stay Clerk-delivered on current plan — tracked in TODO for Phase 4 revisit
- [🟡] **Paddle (sandbox)** — product `1Scratch Pro` + price + webhook created, API key verified; Preview env scope pending dashboard; Production waits on live seller approval at Phase 2 exit
- [x] **Sentry** — org `1scratch-llc`, projects `web` + `client`, DSNs + auth token in env; `@sentry/nextjs` install deferred to Phase 1 final sub-step
- [x] **Axiom** — Marketplace integration (new signed-endpoint pattern, no token/dataset pair), log drain active, dataset = `vercel`
- [x] **`vercel.ts` config** (TypeScript-typed) — `apps/web/vercel.ts` (framework + build/install commands; daily compact-mutations cron deferred to Phase 2 when the route exists)
- [x] **Schema migrations (Drizzle ORM)** for §3, RLS policies, seed test data — full §3 schema in `src/db/schema.ts`; 0000_initial_schema + 0001_rls applied
- [x] **Clerk middleware** — `apps/web/middleware.ts` protects `/app/*`, `/api/sync`, `/api/ai`, `/api/providers`; per-request `app.user_id` GUC set via `withRls()` (tx-scoped `set_config`) because Neon HTTP is stateless per request
- [x] **Envelope encryption helper** — `apps/web/src/lib/crypto/kms.ts` (`seal`/`open`) using AWS KMS `GenerateDataKey` + AES-256-GCM; ctx binding enforced
- [🟡] `POST /api/ai/stream` — Clerk-authed, BotID-gated, decrypts stored Anthropic key, streams via AI SDK v6, writes `ai_usage` on finish, rejects over-cap. **Workflow DevKit wrap deferred to Phase 2** (needs multi-provider fallback chain from Edge Config, which is itself Phase 2). **AI Gateway BYOK passthrough deferred to Phase 2** — Phase 1 uses `createAnthropic({ apiKey })` direct; Gateway adds observability + fallbacks but isn't on the exit-criteria critical path
- [x] Per-user spend cap enforcer — `apps/web/src/lib/spend-cap.ts` (`checkCap` / `recordUsage` / `estimateCostMicros`)
- [x] BotID — `withBotId()` wraps next.config, `initBotId()` in `instrumentation-client.ts`, `checkBotId()` at the top of `/api/ai/stream` + `/api/providers`
- [x] Clerk webhook handler — `apps/web/src/app/api/webhooks/clerk/route.ts` (verifyWebhook from `@clerk/nextjs/webhooks`, user.created/deleted → Neon, email.created → Resend with `{error}` check + `clerk-email/${svix-id}` idempotency). Endpoint registered at `https://app.1scratch.ai/api/webhooks/clerk`
- [x] `@sentry/nextjs` install — `instrumentation.ts`, `sentry.{server,edge}.config.ts`, `instrumentation-client.ts` Sentry.init, next.config wrapped with `withSentryConfig`; source-map upload reads `SENTRY_AUTH_TOKEN` in CI
- [x] Web client at `app.1scratch.ai` — `/app` workbench: paste key → prompt → streamed response, cap meter, drafting-vellum aesthetic matching marketing. Single-card surface; full infinite-canvas ports in Phase 2. (Chose real vs throwaway — tokens/design system carry forward.)
- [x] `/api/health` returns live Neon `db_time` (used as provisioning smoke test)
- [x] Integration tests — `tests/integration/rls.test.ts` (cross-tenant isolation, 4 cases including fail-closed), `tests/integration/spend-cap.test.ts`; `src/lib/crypto/kms.test.ts` (KMS round-trip + ctx mismatch). Gated on `DATABASE_URL_ADMIN` — skip gracefully without

**Exit criteria:** A logged-in user with a verified Anthropic key can stream a response end-to-end, with usage logged and capped.

**Accepted Phase 1 exits with deferrals** (documented, tracked in TODO):
- AI Gateway Zero Data Retention — blocks on Vercel Pro upgrade; Phase 1 traffic is pre-beta so no user data at risk
- AI Gateway BYOK passthrough — Phase 1 calls provider SDKs directly; Gateway layering adds fallbacks + observability in Phase 2
- Workflow DevKit wrap — lands with multi-provider fallback chains in Phase 2
- Clerk webhook registration — handler code shipped; dashboard registration pending

### Phase 2 — Desktop Client + Sync v1 (W3 → W6)

**Goal:** The existing Tauri desktop app authenticates against the backend, replaces local-only state with backend-synced state, model page ships.

- [x] Replace `localStorage` settings with Clerk-authenticated session + server-stored `model_slots` and `provider_connections` — server-side CRUD (`GET/PUT /api/model-slots`, `DELETE /api/model-slots/[slot]`, `POST /api/providers/[id]/verify`, `DELETE /api/providers/[id]`) **plus** client swap: workbench now streams by `slot` (no hardcoded model/provider); inline key-paste form removed — all credential management lives on `/app/models`
- [x] Local SQLite mutation queue + sync push/pull (§4) — server `apps/web/src/lib/sync/{apply-push,fetch-since,patch,validate}.ts` + routes `POST /api/sync/push` & `GET /api/sync/pull` (Clerk-authed, RLS-wrapped, idempotent on `(user_id, client_mutation_id)`, LWW via HLC `serverVersion`, piggybacked `additional[]` of other-device mutations). Engine `packages/sync-engine` (pure TS): `Store` interface, `DirtyTracker` (500ms debounce + streaming-response suppression), `Outbox`, `Reconciler` (echo filter + LWW), `HttpClient`, `SyncLoop`. Client `apps/client/src/sync/*`: `TauriSqliteStore` (`@tauri-apps/plugin-sql`), `hydrateFromStore`, one-shot `migrate-zustand`, `SyncProvider` context, Sync Diagnostics panel. Client ids switched `nanoid` → `crypto.randomUUID()`; Zustand `persist` dropped (SQLite source of truth). Spec: `docs/superpowers/specs/2026-04-18-sync-v1-design.md`
- [x] OAuth callback flow — **web path live** for OpenRouter PKCE: `/oauth/start/[provider]` issues S256 challenge + sets HttpOnly verifier cookie, `/oauth/callback/[provider]` exchanges code via `POST /api/v1/auth/keys`, seals the returned API key, inserts `provider_connections` with `kind='oauth'` + `status='connected'`, redirects to `/app/models?oauth=connected`. Desktop `1scratch://` deep-link intercept lands with `tauri-plugin-deep-link` in Phase 3 (mobile also)
- [x] Model page (§7) — full UX: `/app/models` with 10-slot pill grid, connected-providers list (test / remove), slot editor modal (provider + model + label), connect modal (BYOK for all providers; "sign in instead" for OpenRouter OAuth). Aesthetic matches Workbench drafting-vellum
- [x] Provider verifiers for Anthropic, OpenAI, Google, OpenRouter, Ollama — pure verifier fns in `src/lib/verifiers/*.ts` with 5s timeout + SSRF guard (RFC1918/link-local/CGNAT/mDNS/IPv6-ULA); 29 tests pass
- [x] **Workflow DevKit wrap of AI stream** — `src/workflows/ai-stream.ts` orchestrates per-attempt provider calls; multi-provider fallback chain (same-provider only in v1; cross-provider deferred) via static `src/lib/model-registry.ts` (Edge Config deferred to Phase 4); route returns `run.getReadable()` with `X-Workflow-Run-Id` header; 3 orchestrator tests pass
- [x] Migration utility: import existing `.scratch` files into the cloud — `POST /api/import/scratch` (5 MB cap, Zod-validated legacy shape), `importScratchFile()` materializes a workspace + "Imported" section lazily and stamps HLC on inserted cards; Settings → Import UI drives it
- [ ] Paddle Checkout (overlay or hosted) for Pro upgrade; webhook handler for `subscription.created/updated/canceled` writes `users.tier`; Customer Portal for billing self-serve. Sandbox → live at end of phase.
- [x] Account deletion flow with 24-hr cool-off — email-confirm + revocable window. `POST /api/account/delete-request` hashes a one-time token (plaintext emailed via Resend, never stored), `POST /api/account/delete-confirm` starts the 24-hr clock, `POST /api/account/delete-cancel` aborts; hourly cron `/api/cron/purge-deletions` (guarded by `CRON_SECRET`) executes due rows via Clerk `users.deleteUser` + FK cascade. Partial unique index enforces one active request per user
- [x] Audit log viewable in Settings → Security — `auth_events` table (RLS: owner SELECT + INSERT) records sign_in/credential_add/credential_remove/decrypt_for_use/oauth_connected/scratch_imported/account_delete_*; `/app/settings` page renders last 100 events with a refresh button; BYOK + OAuth + deletion routes instrumented via `record()` / `recordAdmin()`
- [🟡] Threat-model items:
  - [x] **RLS verified by automated test** — `tests/integration/rls.test.ts`: 4 cases (user A sees only A, user B sees only B, user A cannot INSERT as B, unset `app.user_id` GUC returns zero rows / fail-closed). Gated on `DATABASE_URL_ADMIN`; runs green against live Neon
  - [x] **Refresh-token rotation** — Clerk-managed. Clerk rotates refresh tokens on every use (sliding sessions); `getAuthToken()` (sync engine) calls Clerk's `session.getToken()` which auto-refreshes. Access JWTs are short-lived (Clerk default), refresh stored server-side. No app code required; config matches §5 Auth Flow
  - [ ] **Cert-pinning the API hostname** — deferred to Phase 3 (mobile launch). Desktop traffic goes through OS TLS trust store; cert-pinning is defense-in-depth against hostile networks, which is the mobile threat surface. Will land in `src-tauri` via `reqwest` pin config alongside mobile build setup

**Exit criteria:** A user can sign in on desktop, configure all 10 model slots with mixed providers, run prompts, and lose/restore the local cache without data loss.

### Phase 3 — Mobile Launch (W6 → W9)

**Goal:** Tauri Mobile builds running on TestFlight + Play internal track, parity with desktop minus local-models.

- [ ] Tauri Mobile project setup, shared `src/` across platforms
- [ ] iOS: Apple Sign-In integration, Keychain wrapper plugin, Privacy Manifest
- [ ] Android: Keystore wrapper, Data Safety form, biometric unlock optional
- [ ] Adapt sidebar / tab UX for touch (longer press → context menu instead of right-click)
- [ ] Offline-first writes, sync on foreground / connectivity resume
- [ ] Push notification infra (APNs + FCM) — opt-in, used for daily-cap alerts and Pro feature events
- [ ] Beta cohort: 50 invitees via TestFlight + Play Internal
- [ ] App Store review submission **week 8** (buffer: review can take 1-2 wk)

**Exit criteria:** Signed builds on both stores in beta tracks; users can prompt → sync → see results on desktop.

### Phase 4 — Premium, Polish, Launch (W9 → W12)

**Goal:** Pro features that justify the upgrade, hardening, multi-region readiness, public launch.

- [ ] **Memory:** background ingestion of completed prompt/response pairs into `memory_chunks` via Workflow DevKit (chunk → embed → upsert); RAG retrieval injected into Pro user prompts on demand
- [ ] **Image attachments:** Vercel Blob upload from desktop & mobile, vision-capable models flagged in slot picker
- [ ] **Knowledge base:** drag-folder ingestion (desktop), shared across canvases (Pro only)
- [ ] **Multi-device sync substrate:** introduce Yjs CRDT for `cards.payload.prompt` and `cards.payload.response`, dual-write during cutover
- [ ] **EU primary:** route EU users to EU Neon primary; document data residency
- [ ] **Local on-device models (mobile):** llama.cpp Rust binding, ship Gemma 2B GGUF as default, Phi-3-mini optional download
- [ ] **Rolling release:** initial public launch via Vercel Rolling Releases (10% → 50% → 100% over 48hr)
- [ ] **Vercel Agent** enabled for incident investigation + PR reviews
- [ ] Bug bash, perf pass (Lighthouse on web, cold-start budget on mobile), accessibility audit
- [ ] Public launch + Product Hunt

**Exit criteria:** Pro users have memory + image + KB; EU users routed to EU primary; on-device Gemma generates tokens on iPhone 13+; rolling release at 100% with no rollback.

---

## 11. Cost & Capacity Estimate

At **100K MAU**, ~3% Pro = 3,000 paying = **$30K MRR**.

| Service | Estimate |
|---|---|
| Vercel (Fluid Compute, Functions, Bandwidth) | $1.5K - $3K/mo |
| Clerk (above 10K MAU at $0.02 each) | ~$2K/mo |
| Neon Postgres (Scale plan + replicas) | $700 - $1,500/mo |
| Vercel Blob (avg 50MB/Pro user) | $200 - $500/mo |
| AI Gateway | near-zero (passthrough; we don't pay for tokens) |
| Sentry / Axiom / Resend / Paddle fees (~5% + $0.50/txn) | $1.5K - $2K/mo bundled (Paddle is the bulk; scales with MRR) |
| Apple + Google annual | $124/yr amortized |
| **Total infra + payment fees** | **~$6K - $9K/mo** |
| Gross margin on Pro at 100K MAU / 3% conversion ($30K MRR) | ~70% |

Paddle's MoR fees (~5% + $0.50/txn) trim margin vs Stripe but eliminate global tax filing overhead, which is the right tradeoff for a worldwide consumer launch. Sustainable at 100K with healthy headroom. Re-evaluate platform choices only at >500K MAU.

---

## 12. Locked Decisions

| Decision | Choice | Locked |
|---|---|---|
| KMS provider | **AWS KMS** — narrow IAM role, env-injected access | ✅ |
| Billing | **Paddle** — Merchant of Record. Paddle invoices the customer in their currency, collects + remits VAT/GST/sales tax in 50+ jurisdictions on our behalf. Fee ~5% + $0.50/txn. | ✅ |
| Legal entity | **1Scratch LLC** (South Carolina, EIN on file) | ✅ |
| Support email | **support@1scratch.ai** | ✅ |
| Domain | **`1scratch.ai`** | ✅ |
| Free-tier daily AI cap | **$2/day** (`daily_ai_cap_cents = 200`) | ✅ |
| Pro pricing | **$10/mo** (annual plan TBD — suggest $96/yr ≈ 20% off) | ✅ |

> **Paddle worldwide note:** As Merchant of Record, Paddle is the legal seller — they file VAT/GST/sales tax in every supported jurisdiction so 1Scratch LLC doesn't have to register in dozens of countries. The tradeoff is the higher per-txn fee (vs. Stripe's ~2.9% + $0.30) and being one step removed from raw payment data. Worth it for a worldwide consumer launch on a 3-month timeline. We integrate via Paddle Billing (their newer API) — overlay/hosted Checkout + webhooks for subscription lifecycle + Customer Portal for self-serve cancel/upgrade.

> **MX / SPF / DKIM:** `support@1scratch.ai` needs a transactional path. Set up Resend or Google Workspace for the mailbox; configure SPF/DKIM/DMARC at DNS in Phase 1 so receipts and security alerts don't land in spam.

### Domain & callback URIs (now fixed)

- App web: `https://app.1scratch.ai`
- API: `https://api.1scratch.ai`
- OAuth callback: `https://app.1scratch.ai/oauth/callback`
- Mobile/desktop deep link: `1scratch://oauth/done`
- Apple Universal Links + Android App Links: file `apple-app-site-association` and `assetlinks.json` at `https://app.1scratch.ai/.well-known/`

## 13. Still-Open Decisions (not blocking Phase 1)

These can be answered any time before the phase that needs them:

1. **Workspace = team in v2?** Schema separates `users` and `workspaces` so we *could* go multi-user-per-workspace later. Default: keep the runway. (Decision needed by Phase 4.)
2. **CRDT library.** Yjs (JS-first, proven) vs. Automerge (Rust-native, fits Tauri better). Default: **Yjs**. (Decision needed by Phase 4.)
3. **Local models on mobile timing.** Phase 4 is tight. If on-device models slip, we ship Phase 4 without them and follow up. (Decision needed late Phase 3.)

## 14. What I Still Need From You (small)

- An **annual Pro price** — suggest **$96/yr ≈ 20% off** vs monthly (kicks in after we validate monthly conversion)
- **Apple Developer Program enrollment** under "1Scratch LLC" — needs your D-U-N-S number (free from Dun & Bradstreet, ~1–2 weeks); submit in week 1
- **Google Play Console** registration ($25 one-time, organization account, ID verification ~3–5 days)
- **Paddle seller approval** — they vet every seller; submit website (placeholder OK), legal entity, business model. Approval typically 1–3 business days. Submit in week 1 so it's ready by Phase 2.

Phase 1 kickoff (unblocked, can start now): provision Vercel + Neon + Clerk + AWS KMS + Resend + Paddle (sandbox); write `vercel.ts`; Drizzle schema + RLS migrations; AI proxy with streaming + spend caps; SPF/DKIM/DMARC for `1scratch.ai`. Each phase ends with a demo and a decision-point review.

**Provisioning status (2026-04-18):** all vendor sign-up / Marketplace / env-var work is ✅. Clerk webhook live for unlocked templates (three stay Clerk-delivered on current plan — TODO). `DATABASE_URL_ADMIN` live on Prod+Preview+Dev — integration tests pass against live Neon. Paddle live credentials still block on seller approval at Phase 2 exit. SPF/DKIM/DMARC for `1scratch.ai` live via Resend + Cloudflare DNS. See [`docs/provisioning.md`](./docs/provisioning.md) for the full executable runbook with deviations.

---

# Appendix A — Local Tauri MVP (already shipped)

This is the original `Scratch` app — the foundation Phase 0 we're building on. Preserved verbatim so the team understands what's in place.

## Vision

A free-form, infinite canvas desktop app where every "note" is actually a prompt card that invokes an LLM. Prompt cards and response cards live side-by-side on the canvas, are freely draggable and resizable, and can overlap — like a thinking space where you converse with AI the way you'd scatter sticky notes on a desk.

The aesthetic is minimal and paper-like: white canvas, no visible card borders until hover, handwritten fonts, text floating freely on the page.

## Tech Stack (local app)

| Layer | Choice |
|---|---|
| Desktop shell | Tauri v2 |
| UI framework | React 19 + TypeScript |
| Canvas primitives | react-rnd |
| State | Zustand (with `persist`) |
| Styling | Tailwind CSS v4 |
| AI | Anthropic SDK (`dangerouslyAllowBrowser: true` — to be removed in Phase 1) |
| Markdown | react-markdown + remark-gfm |
| Persistence (local) | Browser File API |
| Build | Vite 7 |

**Linux/Wayland launch:** `GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 npm run tauri dev`

## Existing data model (will migrate to §3 schema in Phase 2)

```typescript
interface BaseCard { id, x, y, width, height, zIndex, createdAt }
interface PromptCard extends BaseCard { type:'prompt'; content; modelSlot; status; ... }
interface ResponseCard extends BaseCard { type:'response'; content; promptCardId; model; ... }
interface SettingsState { apiKey; fontFamily; modelSlots: Record<string,string> }
```

## Existing components

`Canvas` (click-to-create + pan/zoom), `CardShell` (react-rnd drag/resize), `PromptCard` (auto-grow textarea, Enter to submit), `ResponseCard` (markdown stream, token count), `Sidebar` (vertical pill tabs with color tints), `TabBar` (Chrome-style horizontal tabs), `SettingsPanel`, `ContextMenu` (right-click color picker).

## Interaction model

| Action | Gesture |
|---|---|
| Pan | Middle-click drag OR Space + left-click drag |
| Zoom | Ctrl + scroll |
| Create card | Left-click on empty canvas |
| Move card | Grab drag tab and drag |
| Resize card | Drag edge/corner handles (visible on hover) |
| Delete card | Hover → `×` control |
| Submit prompt | Enter |
| New line | Shift+Enter |
| Cancel stream | Escape |
| Section / tab color | Right-click → Change color |
| Section / tab rename | Double-click OR right-click → Rename |

---

# TODO — deferred follow-ups

Items that are known-needed but blocked on something external (plan upgrade, approval, volume trigger). Revisit before the phase that needs them.

- **Enable AI Gateway Zero Data Retention** *(blocked on Vercel Pro plan — required by §2 threat model)*
  - Vercel Hobby plan doesn't expose the ZDR toggle on AI Gateway. Once we move `1-scratch-llc` to Pro, go to AI Gateway → Settings → enable **Zero Data Retention**. Must be ON before any real user traffic hits the proxy (Phase 1 exit criteria / latest by Phase 4 public launch).
  - Trigger to upgrade: whichever comes first of (a) first real beta cohort needing ZDR per privacy policy, (b) needing BotID / Rolling Releases / team seats / advanced observability, (c) Phase 4 launch prep.
- **Paddle live seller approval + production credentials** *(blocks on Paddle 1–3 business day review; Phase 2 exit)* — submit production seller application, then create live API key + price + webhook in live Paddle dashboard; populate `PADDLE_*` Production env vars.
- **Neon EU read replica** *(Phase 4)* — add second region under same Neon project; route EU-resident users.
- **Second KEK `alias/1scratch-kek-eu` in `eu-central-1`** *(Phase 4)* — for EU data-residency routing.
- **Vercel env Preview-scope backfill** — CLI quirk `git_branch_required` blocks `vercel env add NAME preview` even with `--value/--yes`. Workaround: add Preview via dashboard (tick Prod + Preview when editing). Applies to: `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`, `PADDLE_*`, `AWS_REGION`, `AWS_KMS_KEY_ID`.
- **AI Gateway BYOK passthrough** *(deferred — likely won't happen)* — Phase 2 picked **Option A: direct SDK + Workflow DevKit fallback chain** (user-BYOK keys stay on provider SDKs, fallbacks handled by DevKit per-attempt). Gateway BYOK passthrough would duplicate the fallback capability for marginal observability win; revisit only if per-request Gateway routing becomes valuable (e.g. per-user rate limiting, tag-based spend reporting) once traffic justifies it.
- **Edge Config model registry** *(Phase 4)* — current registry is the static `src/lib/model-registry.ts`. Moving to Edge Config unblocks hot-swap of pricing / fallback chains without a deploy, but adds <10ms read latency to a code path that already tolerates 2-3s of LLM streaming. Low-urgency.
- **Clerk locked email templates** *(Phase 4 launch prep)* — three security-critical templates stay Clerk-delivered on current plan: **Verification code**, **Reset password code**, **Invitation**. Toggles are greyed out — Clerk gates "Remove Clerk branding" behind higher tier. Impact: email+password sign-up verification codes and password-reset codes arrive from Clerk's sender (users see "via clerk.com" badge in Gmail). Non-blocking for beta; revisit at launch alongside Vercel Pro bundle — either upgrade Clerk plan or drop email+password flow and keep only social + magic-link. `email.created` events for the remaining templates (magic link, welcome, etc.) route through Resend correctly.
- **`DATABASE_URL_ADMIN` env** *(Phase 1)* — Neon admin role was provisioned but the connection string isn't in `.env.development.local` / Vercel envs yet. Integration tests `rls.test.ts` and `spend-cap.test.ts` skip without it. Pull from Neon dashboard or mint via `neon connection-string --role admin_user`.

---

# Build Log — Amendments & Deviations

Running ledger of in-flight changes to the plan as we actually build. Each entry: date, section affected, what changed, why. Append newest at the top. When an amendment supersedes an original plan decision, note the old assumption so future-us doesn't get confused re-reading the earlier sections.

## 2026-04-18 (later) — Phase 2 step 2: sync v1 (desktop)

Scoped pass: PLAN §10 Phase 2 step 2. Design: `docs/superpowers/specs/2026-04-18-sync-v1-design.md`; plan: `docs/superpowers/plans/2026-04-18-sync-v1.md`.

**Shipped:**
- `apps/web/src/lib/sync/apply-push.ts` + `fetch-since.ts` + zod validators; idempotent via existing `(user_id, client_mutation_id)` unique index; server HLC extended with `observeRemoteHlc`.
- `POST /api/sync/push` + `GET /api/sync/pull` route handlers (Clerk-authed, RLS-wrapped).
- `packages/sync-engine` — pure TS: HLC re-export, `Store` interface, `DirtyTracker` (500ms debounce, streaming-response suppression), `Outbox`, `Reconciler` (echo filter + LWW), `HttpClient`, `SyncLoop`.
- `apps/client/src/sync/*` — `TauriSqliteStore` (`@tauri-apps/plugin-sql`), local schema, `hydrate`, `migrate-zustand` one-shot, `SyncProvider` context. Client entity ids switched from nanoid → `crypto.randomUUID()`; Zustand `persist` dropped (SQLite is source of truth).
- Sync Diagnostics panel in Settings (outbox depth, last error, manual sync).

**Design decisions locked (from brainstorming 2026-04-18):** see `docs/superpowers/specs/2026-04-18-sync-v1-design.md` §Locked design decisions. Notable:
- Final-mutation-only streaming persistence.
- Storage-agnostic `Store` seam (Tauri SQLite v1; mobile reuses Phase 3; IndexedDB deferred until web canvas exists).
- No single-active-device enforcement; LWW handles concurrent writes.
- No new migration required — `mutations.client_mutation_id` + idempotency index already in schema from Phase 1.

**Deferred from this scope:**
- Desktop Clerk session integration for `getAuthToken()` — currently reads `VITE_DEV_CLERK_TOKEN`; proper desktop auth coordinates with Phase 2 step 1 client swap on the Tauri side (web workbench already migrated).
- `deleted_at` on `canvases`/`sections` (hard-delete in v1); revisit with Phase 4 CRDT swap.
- WebSocket / SSE push-from-server (PLAN §4 notes Phase 2 item; single-active-device makes polling sufficient).
- Manual QA checklist (Task 21 step 1) — left to user (requires running Tauri app + Neon DB inspection).

**Plan deviations:**
- Task 2 LWW test: plan asserted older `clientVersion` loses, but server stores `serverVersion = nextHlc()` not `clientVersion`. Rewrote test to admin-bump `canvases.version` to bigint max simulating concurrent server instance (chosen with user as option b).
- Task 12 SyncLoop concurrency-guard test: plan's verbatim sync `expect(pushSpy).toHaveBeenCalledTimes(1)` runs before the awaited `peekOutbox` resolves. Wrapped in `vi.waitFor(...)` (one-line test-only deviation; production code is plan-verbatim).
- Task 15-19: minor type-safety fixups (removed unused imports, prefixed unused params with `void`, added `!` for `noUncheckedIndexedAccess`) where plan-verbatim code didn't satisfy strict tsconfig.

## 2026-04-18 (later) — Phase 2 steps 7, 9, 10: import, deletion, audit log

Scoped pass: picked the three leftover **unblocked** Phase 2 steps (step 5 sync-protocol still gated on `/brainstorming`; step 8 Paddle gated on live-seller approval).

**Schema (migration `0002_phase2_audit_and_deletion.sql`).** Two new tables, both with `FORCE ROW LEVEL SECURITY`:
- `auth_events` — `bigserial` PK, `user_id` → `users(id)` ON DELETE CASCADE, `kind` text, `ip inet`, `ua text`, `meta jsonb`, `ts timestamptz`. Separate RLS policies (`FOR SELECT` + `FOR INSERT`) rather than `FOR ALL` so the table is effectively append-only from the user's perspective. Index `(user_id, ts DESC)` for cheap recent-events listing.
- `account_deletion_requests` — `uuid` PK, `user_id` FK, `confirm_token_hash text` (sha256 hex — plaintext is emailed once via Resend and never stored), `status` (`pending|confirmed|cancelled|executed`), `requested_at`, `confirmed_at`, `executes_after`, `cancelled_at`, `executed_at`. **Partial unique index** on `(user_id) WHERE status IN ('pending','confirmed')` enforces one active request per user. Standard owner-scoped RLS policy covers both halves.

**Key design choices:**
- **24-hr clock starts on CONFIRM, not REQUEST.** The request row is written with `executes_after = now() + 24h`, but the confirm route **rewrites** it to `now() + 24h`. A user who never clicks the email link never loses data.
- **Token never stored in plaintext.** `hashToken()` computes sha256 hex; the confirm route hashes the incoming token and matches; FK cascades (`ON DELETE CASCADE` on `users.id`) mean `executeDeletion` only needs `DELETE FROM users WHERE id = ?` to wipe every owned row.
- **Audit write paths split.** Normal handlers use `record(userId, kind, opts)` inside the user's RLS-scoped transaction (so RLS verifies the write). Admin paths (confirm route, cron execute) use `recordAdmin(...)` against `sqlAdmin` because they act on behalf of a user whose session context isn't available. Both paths write to the same table.
- **Cron auth.** `/api/cron/purge-deletions` guards on `Authorization: Bearer ${CRON_SECRET}` (Vercel convention). Schedule hourly in `apps/web/vercel.ts`.
- **Workspace bootstrap is lazy.** Clerk webhook only seeds a `users` row; `ensureDefaultWorkspaceAndSection(userId, 'Imported')` materializes a workspace + named section on first write and is idempotent. Used by the importer; foundation for future "first-write" flows too.

**Files added:**
- `apps/web/src/db/migrations/0002_phase2_audit_and_deletion.sql`
- `apps/web/src/lib/audit-events.ts`, `account-deletion.ts`, `import-scratch.ts`, `workspace.ts`, `hlc.ts`
- Routes: `/api/import/scratch`, `/api/account/delete-request`, `/api/account/delete-confirm`, `/api/account/delete-cancel`, `/api/cron/purge-deletions`, `/api/audit-events`
- UI: `/app/account/delete-confirm` (public token-landing page), `/app/settings/page.tsx` + `SettingsPanel.tsx` (import / audit / danger zone, three sections)
- Tests: `tests/integration/import-scratch.test.ts` (2 cases), `tests/integration/account-deletion.test.ts` (4 cases). Full suite: **59 passed**.
- `apps/web/scripts/apply-0002.mjs` — one-shot runner left in place; see next bullet on why we didn't actually use it.

**Files edited:**
- `apps/web/src/db/schema.ts` — Drizzle types for both new tables.
- `apps/web/proxy.ts` — added `/api/import(.*)`, `/api/account/delete-request|cancel`, `/api/audit-events(.*)` to the Clerk-protected matcher. `/api/account/delete-confirm` stays public (the token IS the proof); `/api/cron/*` stays public (guarded by `CRON_SECRET`).
- `apps/web/src/app/app/layout.tsx` — added "settings" nav link.
- `apps/web/vercel.ts` — `crons: [{ path: '/api/cron/purge-deletions', schedule: '0 * * * *' }]`.
- Audit instrumentation: `api/providers/route.ts` + `api/providers/[id]/route.ts` + `oauth/callback/[provider]/route.ts` now emit `credential_add|remove|oauth_connected` events.

**Migration application (gotcha worth saving).** The handwritten SQL needed to land on the live Neon DB. Four consecutive failures:
1. `sql.query(raw)` → Neon HTTP rejects multi-statement prepared strings.
2. Split-and-loop over `DATABASE_URL_ADMIN` → `admin_user` lacks DDL privs (can't `CREATE TABLE` in `public`).
3. Switched to `DATABASE_URL` (connects as `neondb_owner`) → **still** `permission denied for schema public`. Reason: Neon HTTP driver is stateless per query, so a leading `RESET ROLE` in an earlier query doesn't persist. And `ALTER ROLE neondb_owner SET ROLE app_user` in the earlier provisioning pass means `RESET ROLE` actually resets *to* `app_user` (the login default), not off.
4. Bundle `[sql\`RESET ROLE\`, ...stmts]` into one `sql.transaction([...])` → same error — `RESET ROLE` was the wrong verb; needed explicit `SET ROLE neondb_owner`.

Resolution: ran the 17-statement transaction through the Neon MCP tool (`mcp__plugin_neon_neon__run_sql_transaction`) with `SET ROLE neondb_owner` as the first statement. Lesson for Phase 2 step 8+: **always prepend `SET ROLE neondb_owner` as the first statement of a DDL transaction** — `RESET ROLE` is unreliable when the login role has a default-role setting.

**Deferred / still open:**
- Step 5 (sync push/pull) — still blocked on `/brainstorming`.
- Step 8 (Paddle Checkout) — blocked on live-seller approval.
- Step 11 threat-model items (cert pinning, refresh-token rotation, RLS automated test) — step 10 lands the audit half; the other two remain.
- `scripts/apply-0002.mjs` now unused but left as a reference for future DDL script writers; remove when superseded by a proper `db:apply` pnpm target.

## 2026-04-18 (late) — Phase 2 step 4 + step 1 client swap + step 3 OAuth

Scoped pass: steps 4 (Model page §7), 1 (client swap onto slot-based streaming), 3 (OAuth callback, web path). Steps 5-10 deferred; step 5 still blocked on `/brainstorming` for sync protocol.

**Design decision (OAuth storage):** OpenRouter's PKCE flow mints a long-lived API key rather than an OAuth access/refresh pair. Storing it via the same envelope-encryption columns as BYOK keys (only `kind='oauth'` differs) avoided a schema migration and keeps `/api/ai/stream` provider code path unchanged. If a future provider returns real access+refresh pairs, seal a JSON blob `{access, refresh, expiresAt}` into the existing `secret_ciphertext` — no migration needed.

**Step 4 — Model page §7:**
- `src/app/app/models/page.tsx` + `ModelsPage.tsx` (client) — 10-pill grid, provider list, slot editor modal, connect modal
- Slot editor: provider dropdown (from user's connected providers) → model dropdown (intersected with `modelsByProvider(provider)` registry entries) → optional label; save via `PUT /api/model-slots`; clear via `DELETE /api/model-slots/[slot]`
- Connect modal: provider picker → BYOK form (api key, or `endpointUrl` for Ollama) OR "sign in instead" button (OpenRouter only) that sends the browser to `/oauth/start/openrouter`
- Provider row: status dot + test + remove. "Test" fires `POST /api/providers/[id]/verify`; "remove" fires `DELETE /api/providers/[id]` and optimistically nulls any slots pointing at the deleted connection (server already handles via `ON DELETE SET NULL`)
- Added `kind` to `ConnectionPublic` + `listConnections` SELECT so the client can badge oauth connections

**Step 1 — client swap:**
- `src/app/app/page.tsx` (server) now fetches `listSlots` + `listConnections` + `checkCap` + registry summary, passes populated slots to `Workbench`
- `src/app/app/Workbench.tsx` — removed inline key-paste `KeyBar` entirely; replaced with `SlotBar` (chip picker over populated slots). Prompt submission sends `{ slot, prompt }` to `/api/ai/stream` instead of hardcoded `{ connectionId, provider, model: 'claude-haiku-4.5' }`
- Empty-state: no populated slots → "go to models →" link rendered in place of the slot chips
- Layout nav: added `workbench` + `models` links in `layout.tsx` header

**Step 3 — OAuth callback (web path):**
- `src/lib/oauth/pkce.ts` — `generateCodeVerifier()` (32 random bytes → 43-char base64url) + `codeChallengeS256()` (SHA-256 → base64url). RFC 7636 vector verified
- `src/lib/oauth/openrouter.ts` — `buildAuthorizeUrl({ callbackUrl, codeChallenge })` + `exchangeCode({ code, codeVerifier })` → `{ key }`; 10s timeout via `AbortSignal.timeout`
- `src/lib/providers.ts` — extracted `saveConnection()` core used by both `saveApiKey` (unchanged callsite signature) and new `saveOauthConnection` (kind='oauth', status='connected' with `last_verified_at = now`)
- `src/app/oauth/start/[provider]/route.ts` (Node runtime) — authed; zod-validated `provider` enum (openrouter only today); writes HttpOnly + SameSite=Lax verifier cookie `oauth_pkce_<provider>` scoped to `/oauth` with 10-min TTL; redirects to provider authorize URL
- `src/app/oauth/callback/[provider]/route.ts` (Node runtime) — authed; reads cookie, validates `stored.userId === authedUserId` (CSRF guard beyond just having the cookie), exchanges code, seals secret, inserts connection, clears cookie, redirects to `/app/models?oauth=connected`. All error paths redirect with a diagnostic `oauth=<reason>` query param so the UI can surface them without exposing internals
- Proxy/middleware: `/oauth/*` is not in `isProtectedRoute`; handler-level `auth()` enforces login and redirects to `/sign-in` — correct because the browser's Clerk session cookies survive the external provider redirect back to our origin

**Tests:** `src/lib/oauth/pkce.test.ts` — RFC 7636 vector + verifier distinctness + charset assertion. 53/53 pass, typecheck clean.

**Deferred from this scope:**
- Desktop/mobile `1scratch://oauth/done?id=...` deep-link return path — lands with `tauri-plugin-deep-link` in Phase 3. Web path ships today.
- Live OpenRouter OAuth smoke test — requires registering the callback URL with OpenRouter (out-of-band config), plus a real user clicking through. Code path unit-tested; integration test requires a sandbox we don't have yet.
- Anthropic / Google / OpenAI OAuth — none currently expose a public PKCE consumer flow; revisit as providers ship.

## 2026-04-18 — Phase 2 steps 1-3: server CRUD, verifiers, Workflow DevKit wrap

Scoped pass: steps 1-3 of Phase 2 per user guardrail (steps 4-10 deferred; step 5 blocked on `/brainstorming` for sync protocol).

**Design decision (locks Phase 2 provider topology):** picked **Option A — direct SDK + Workflow DevKit fallback chain**. User-BYOK keys flow through provider SDKs (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`); DevKit's step-level retry substitutes fallback models on transient failures. AI Gateway BYOK passthrough is de-scoped (see TODO). Gateway stays available for server-managed calls if/when per-user rate limiting justifies it.

**Step 1 — model registry + slot CRUD:**
- `src/lib/model-registry.ts` — static canonical list (6 models: sonnet-4.6, haiku-4.5, opus-4.6, gpt-5.4, gemini-2.5-pro, gemini-2.5-flash) with price (micros/M tokens), context window, capabilities, same-provider fallback chains
- `src/lib/model-slots.ts` — slots 0-9 CRUD; `SlotValidationError` with codes `invalid_slot` / `unknown_model` / `unknown_connection` / `provider_mismatch`; `listSlots` returns dense 10-element array with nulls
- `src/lib/spend-cap.ts` — `estimateCostMicros` now registry-aware (per-model pricing, not flat default)
- `src/app/api/model-slots/route.ts` (GET/PUT) + `[slot]/route.ts` (DELETE) — zod-validated, 400 on `SlotValidationError`, Next 16 async params
- `tests/integration/model-slots.test.ts` — 10 cases (empty→nulls, upsert, idempotent, clear, slot range, unknown model, provider mismatch, cross-tenant RLS)

**Step 2 — provider verifiers:**
- `src/lib/verifiers/{anthropic,openai,google,openrouter,ollama}.ts` — pure `(plaintext, endpointUrl?) → VerifyResult` shapes with 5s `AbortSignal.timeout`; Ollama's `isServerVerifiable` blocks RFC1918 / link-local / CGNAT (`100.64.0.0/10`) / mDNS `.local` / IPv6 ULA (`fc00::/7`)
- `src/app/api/providers/[id]/verify/route.ts` (POST) — decrypts stored key, runs verifier, updates `status` + `last_verified_at`, returns available models intersected with registry
- `src/app/api/providers/[id]/route.ts` (DELETE) — remove connection
- `src/app/api/providers/route.ts` — widened provider enum; conditional refine (Ollama needs `endpointUrl`; others need `apiKey`)
- `src/lib/verifiers/verifiers.test.ts` — 29 tests with global `fetch` stub + 14-case SSRF block table

**Step 3 — Workflow DevKit wrap:**
- `next.config.ts` — `withWorkflow(config)` added; wrapper chain is `withSentryConfig(withBotId(withWorkflow(config)), …)`
- `proxy.ts` — matcher excludes `.well-known/workflow/` (required for DevKit internal paths)
- `src/workflows/ai-stream.ts` — three step functions + pure orchestrator:
  - `buildAttemptChain` resolves `slot | connectionId+modelId | provider+modelId` → ordered `Attempt[]`; off-registry models get a single-attempt chain (no fallback)
  - `runAttempt` decrypts key, picks SDK by provider, pipes `streamText().textStream` into `getWritable<string>()`, returns discriminated `AttemptResult` (`invalid`/`transient`/`no_key`/`unsupported_provider` or `ok` with tokens)
  - `writeUsageRow` calls `recordUsage` after a successful attempt
  - Orchestrator loops the chain, stops on `invalid`/`no_key`, returns `{ modelUsed, provider, inputTokens, outputTokens }` or `{ error }`
- `src/app/api/ai/stream/route.ts` — rewritten to just auth+cap gate, `start(aiStreamWorkflow, [input])`, return `run.getReadable()` with `Content-Type: text/plain; charset=utf-8` and `X-Workflow-Run-Id` header
- `tests/ai-stream.test.ts` — 3 orchestrator tests with `vi.mock`-ed step deps: fallback path (sonnet→haiku on transient), `no_connection_for_request` path, `no_key` short-circuit. Chose unit-test path over `@workflow/vitest` bundle setup per Karpathy §2 — directives are no-ops outside the SWC transform, so the workflow runs as plain JS and `vi.mock` works.

**Results:** 50/50 tests pass, typecheck clean. `@workflow/vitest` installed for future use; separate vitest config not created.

## 2026-04-18 — Phase 1 implementation: ship proof-of-life

Implementation pass on Phase 1 backend + proof-of-life web client.

- **§10 Phase 1 exit criteria amended:** now explicitly allows four documented deferrals (ZDR, Gateway BYOK passthrough, Workflow DevKit wrap, Clerk webhook dashboard registration) so Phase 1 can land without waiting on Vercel Pro plan approval. Exit criteria still hold: a user signs in, pastes a key, streams a response, sees it logged and capped.
- **New modules:**
  - `apps/web/src/lib/crypto/kms.ts` — `seal`/`open` envelope crypto with KMS-bound EncryptionContext
  - `apps/web/src/lib/providers.ts` — BYOK credential store (`saveApiKey`, `listConnections`, `loadDecryptedKey`, `findConnectionByProvider`)
  - `apps/web/src/lib/spend-cap.ts` — daily $ cap enforcer; token→cost model ships a sane default (Edge Config registry takes over in Phase 2)
  - `apps/web/src/db/rls.ts` — `withRls(userId, queries[])` wraps Neon HTTP transaction so `set_config('app.user_id')` + queries share a session (required because HTTP driver is stateless per request; also sidesteps the drizzle 0.36 `execute()` bug)
- **Routes:**
  - `POST /api/ai/stream` — Clerk-authed, BotID-gated, cap-checked, streams via AI SDK v6 `streamText` + `toTextStreamResponse()`
  - `GET/POST /api/providers` — list / save BYOK keys
  - `GET /api/cap` — today's cap usage
  - `POST /api/webhooks/clerk` — Svix-verified, user.created/deleted/email.created handlers
- **Proof-of-life client:** `/app` route (server-component auth + cap fetch; `Workbench.tsx` client with paste-key → prompt → streamed response → cap meter). Chose "real" over "throwaway" — shared design tokens and aesthetic continue into Phase 2's canvas port.
- **Observability:** Sentry via `instrumentation.ts` (server + edge) and `instrumentation-client.ts` (also hosts BotID `initBotId`). Source-map upload configured in `next.config.ts` via `withSentryConfig`.
- **Tests:** Vitest. `kms.test.ts` (KMS round-trip + ctx mismatch), `rls.test.ts` (4 isolation cases incl. fail-closed on unset GUC), `spend-cap.test.ts` (cap blocks after overflow). All integration tests gate on `DATABASE_URL_ADMIN` — CI without DB stays green.

### 2026-04-18 (same day) — Manual Phase 1 items + Clerk template limitation

Completed the dashboard-side work for Phase 1 exit:

- **`DATABASE_URL_ADMIN`** — admin-role connection string minted via Neon MCP (`admin_user@ep-jolly-brook-a4tcj7ay-pooler`), pushed to Vercel Prod+Dev; Preview scope added via dashboard (CLI `git_branch_required` bug). `apps/web/.env.development.local` refreshed via `vercel env pull`. Integration tests now run against live Neon: **7/7 pass** (RLS cross-tenant isolation confirmed end-to-end).
- **Paddle env scopes** — Prod+Preview paired, Dev separate; webhook secret scoped to all three.
- **Clerk webhook secret** — real `whsec_…` on Prod+Dev+Preview. Endpoint registered in Clerk dashboard, subscribed to `user.created`/`user.deleted`/`email.created`.
- **Clerk "Delivered by Clerk" toggles** — off for templates that expose it. Three templates (**Verification code**, **Reset password code**, **Invitation**) are greyed out on current Clerk plan — locked to Clerk-sender. Accepting for beta; TODO added for Phase 4 revisit (upgrade plan or drop email+password).
- **Live DB sanity check via Neon MCP** — all 10 §3 tables present, `rls_enabled=rls_forced=true` on each, 10 policies match `0001_rls.sql`, roles `app_user`/`app_admin`/`admin_user`/`neondb_owner` present with correct `BYPASSRLS` attrs.

Phase 1 exit criteria met (code-complete; deferrals documented). Blockers remaining are all Phase 2+ gated (Gateway BYOK passthrough, Workflow DevKit wrap) or plan-upgrade gated (Gateway ZDR, Clerk template lock).

### 2026-04-18 (same day) — Phase 1 closeout pass

Re-surveyed Phase 1 against the `clerk-webhooks`, `resend`, `ai-sdk`, and `vercel-functions` skills. Three small fixes:

- **`apps/web/src/app/api/webhooks/clerk/route.ts`** — `email.created` branch now destructures `{ error }` from `resend.emails.send` (SDK returns structured errors; it never throws) and passes `idempotencyKey: clerk-email/${svix-id}` so Svix retries don't double-send. `text` is only forwarded when Clerk actually ships a `body_plain`.
- **`apps/web/vercel.ts`** — dropped the `/api/cron/compact-mutations` cron. The sync route doesn't land until Phase 2; nightly 404s would have been misleading signal. Cron lands alongside the route it calls.
- **`apps/web/src/app/api/ai/stream/route.ts`** — removed the `void response` no-op in `onFinish`. Observability already flows via Sentry + AI SDK's built-in span on the stream.
- **§10 Phase 1 checklist** — `vercel.ts` and schema migrations bullets flipped from ☐ to ✅; they were complete but the plan hadn't caught up.

### 2026-04-18 (same day) — Clerk skills review pass

Re-aligned against `clerk-webhooks` + `clerk-nextjs-patterns` skills after load.

- **Webhook handler refactor:** `/api/webhooks/clerk/route.ts` swapped raw `svix.Webhook` + manual header parsing → `verifyWebhook(req)` from `@clerk/nextjs/webhooks`. Auto-reads `CLERK_WEBHOOK_SECRET`; handler now takes `NextRequest`. Dropped `svix` from deps.
- **Middleware → proxy:** `apps/web/middleware.ts` renamed to `apps/web/proxy.ts` per Next.js 16 convention. Same `clerkMiddleware` export + protected-route matcher; no behavior change. `/api/webhooks(.*)` remains implicitly public (not in `isProtectedRoute`).
- **Tests:** 9/9 pass; typecheck clean.

- **§10 Phase 1 checklist:** broken out per-vendor with status markers; status matches `docs/provisioning.md`. Original single-line "Provision: …" bullet preserved in spirit.
- **New file:** `docs/provisioning.md` is the executable runbook. PLAN.md remains architectural; provisioning.md remains operational.

## 2026-04-17 — Provisioning deviations (from `docs/provisioning.md`)

Captured here so the narrative doesn't disappear into runbook-only history:

### Auth & email delivery

- **Clerk Custom SMTP removed from Clerk dashboard** (vendor change). Plan originally said "Clerk dashboard → Emails → Custom SMTP → point at Resend." As of 2026 Clerk no longer exposes SMTP fields.
  - **New pattern:** per template, toggle "Delivered by Clerk" OFF → Clerk emits `email.created` webhook → our `/api/webhooks/clerk` handler sends via Resend SDK.
  - **Implication for §5 Auth Flow:** add a webhook path; `CLERK_WEBHOOK_SECRET` env var (Svix-signed); handler also processes `user.created`/`user.deleted` for Postgres sync + GDPR cascade.
- **Clerk JWT template — `sub` claim is reserved.** Plan §5's implied template `{ sub, email }` cannot override `sub`. Template emits `{ email }` only; middleware reads `sub = user.id` from Clerk's default claim set. Functionally identical.
- **Resend Marketplace integration failed** (`"user does not have an active session or is not authenticated"` — root cause not diagnosed). Worked around by direct resend.com signup. Not a plan change — just a provisioning-path change.

### Database

- **`DATABASE_URL_ADMIN` cannot be minted from Neon dashboard/SQL Editor.** Both run every session under `SET ROLE app_user` (default applied to `neondb_owner`), which silently blocks `CREATE ROLE`/`ALTER ROLE`. Fix: run role setup from a Node script that executes `SET ROLE neondb_owner` first inside a single transaction.
- **`BYPASSRLS` is a role attribute, not a privilege** — does NOT inherit through `GRANT`. The `ALTER ROLE admin_user SET ROLE app_admin` default is what makes BYPASSRLS effectively apply for `admin_user` sessions. Affects any future "privileged login role" work.
- **Drizzle `neon-http` execute path broken in drizzle-orm 0.36** — `db.execute(sql\`...\`)` throws `"This function can now be called only as a tagged-template function"`. `/api/health` uses `@neondatabase/serverless` tagged-template `neon()` client directly. Revisit on drizzle upgrade; migrations still use drizzle-kit fine.

### AI Gateway

- **Model slug format uses dots, not hyphens.** `anthropic/claude-haiku-4.5` (not `claude-haiku-4-5`). Provider resolves to dated snapshot `claude-haiku-4-5-20251001` internally. Affects any place we hard-code model IDs — prefer Edge Config model registry (§1) for the canonical list.
- **ZDR toggle not on Hobby plan** — see TODO above.

### AWS KMS

- **Correct provisioning order is IAM-user-first, then KEK** (plan originally implied reverse). KMS "Key users" picker needs the IAM user to exist; inline policy needs the KEK ARN.
- **KMS key admins left empty** — default key policy's `arn:aws:iam::<acct>:root` grants full account-root admin, which is sufficient. Only add dedicated admins later if we create a separate admin IAM user.
- **Region:** `us-east-1` (matches Neon). Initial key mistakenly created in `us-east-2` — scheduled for 7-day deletion (KMS minimum).

### Sentry

- **Org slug is `1scratch-llc`, not `1scratch`** — Sentry auto-appended the legal-entity suffix. JWT payload `"org":"1scratch-llc"` is authoritative.
- **Organization auth tokens have fixed scopes** — scope editing disabled in UI. Default scopes (`project:releases` + `org:read`) are what `@sentry/nextjs` source-map upload needs.

### Axiom

- **Vendor integration changed** — no more `AXIOM_TOKEN` + `AXIOM_DATASET` pair. New pattern: single signed ingest endpoint `NEXT_PUBLIC_AXIOM_INGEST_ENDPOINT` (with `configurationId` + `projectId` embedded), scoped `type=web-vitals`. Functions/Edge logs ship via auto-configured Log Drain (no env var). Dataset defaults to `vercel` (plan said `1scratch-web` — cosmetic-only).
- **Server-side Axiom queries** (not needed Phase 1) would require a separately-minted `AXIOM_TOKEN` in Axiom's own dashboard.

### Vercel CLI quirks (env vars)

- **`echo "..." | vercel env add` stores a trailing `\n`.** Caught after AWS SDK rejected `region="us-east-1\n"`. Always use `printf '%s' "value" | vercel env add …`. All previously-added `AI_GATEWAY_API_KEY` + `AWS_*` values were removed and re-added cleanly.
- **`vercel env add NAME preview` returns `git_branch_required` JSON** even with `--value ... --yes`. Workaround: add Preview via dashboard (tick Prod + Preview when editing). Tracked under TODO above.
- **Vercel rejects `--sensitive` on Development scope.** Vars like `RESEND_API_KEY`, `AWS_SECRET_ACCESS_KEY`, `SENTRY_AUTH_TOKEN` are Sensitive on Prod/Preview but non-Sensitive on Dev.
