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

- [ ] Provision: Vercel project, Neon DB (us-east + EU read replica), Clerk, Resend, Paddle (sandbox), AI Gateway, Sentry, Axiom
- [ ] `vercel.ts` config (TypeScript-typed)
- [ ] Schema migrations (Drizzle ORM) for §3, RLS policies, seed test data
- [ ] Clerk wired in Next.js, session middleware sets `app.user_id` Postgres GUC
- [ ] Envelope encryption helper (`@aws-crypto/client-node` against AWS KMS or Vercel-side using `crypto.subtle` + a KMS-held KEK)
- [ ] `POST /ai/stream` endpoint: Workflow-wrapped, proxies through AI Gateway, streams SSE, writes `ai_usage` + `auth_events`
- [ ] Per-user spend cap enforcer (read `users.daily_ai_cap_cents`, sum today's `ai_usage`)
- [ ] BotID on `/auth/*` and `/ai/*`
- [ ] Throwaway web client at `app.1scratch.ai` to drive proof-of-life: log in, paste API key, run a prompt
- [ ] Sentry, Axiom, Web Vitals dashboards live

**Exit criteria:** A logged-in user with a verified Anthropic key can stream a response end-to-end, with usage logged and capped.

### Phase 2 — Desktop Client + Sync v1 (W3 → W6)

**Goal:** The existing Tauri desktop app authenticates against the backend, replaces local-only state with backend-synced state, model page ships.

- [ ] Replace `localStorage` settings with Clerk-authenticated session + server-stored `model_slots` and `provider_connections`
- [ ] Local SQLite mutation queue + sync push/pull (§4) — single device, no conflict-resolver-beyond-LWW
- [ ] OAuth callback flow (`1scratch://` deep link via `tauri-plugin-deep-link`)
- [ ] Model page (§7) — full UX
- [ ] Provider verifiers for Anthropic, OpenAI, Google, OpenRouter, Ollama
- [ ] Migration utility: import existing `.scratch` files into the cloud
- [ ] Paddle Checkout (overlay or hosted) for Pro upgrade; webhook handler for `subscription.created/updated/canceled` writes `users.tier`; Customer Portal for billing self-serve. Sandbox → live at end of phase.
- [ ] Account deletion flow with 24-hr cool-off
- [ ] Audit log viewable in Settings → Security
- [ ] Threat-model items: cert-pinning the API hostname, refresh-token rotation, RLS verified by automated test

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
