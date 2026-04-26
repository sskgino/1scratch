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

**Mobile auth gotchas (learned the hard way during the Phase 3a Pixel DoD — see Build Log 2026-04-19→23 for full traces):**
- **Tauri Android WebView origin = `http://tauri.localhost`** (not file://, not the asset domain). API routes the app fetches cross-origin MUST send `Access-Control-Allow-Origin` for that exact value or the WebView blocks the preflight silently. macOS/iOS desktop is `tauri://localhost`; Windows is `{http|https}://tauri.localhost` per `useHttpsScheme`.
- **Android App Link `pathPrefix` is a string-prefix match, not a path-segment match.** `/m` matches `/mobile/handoff`, `/manage`, `/m123`, etc. Always include the trailing slash (`/m/`) so the intent filter doesn't yank the user out of mid-flow OAuth handshake URLs.
- **`android:allowBackup` defaults to true.** Auto Backup will restore old `EncryptedSharedPreferences` ciphertext onto a freshly-generated MasterKey after reinstall, surfacing as `javax.crypto.AEADBadTagException`. Set `allowBackup="false"` for any app that uses keystore-encrypted prefs, AND defensively wrap reads in a try/catch that wipes-and-retries.
- **Vercel CLI displays sensitive env values as `••••…` (U+2022 bullets).** Don't paste that masked string back as the actual value — Vercel will store the bullets as the literal secret. The Clerk handshake error `TypeError: Cannot convert argument to a ByteString because the character at index 7 has a value of 8226` is the canonical symptom.
- **Clerk webhooks aren't a hard dependency.** The `device_sessions_user_id_fkey` will fire if a user signed up before the webhook was wired (or if Svix dropped the delivery). Lazy-provision the `users` row in any handler that's the first authed touch-point — `currentUser()` from Clerk + `INSERT … ON CONFLICT (id) DO NOTHING`.
- **Deep-link callbacks fire multiple times across React strict-mode/Vite-HMR remounts.** A naive `consume(url)` will re-save the URL's refresh token AFTER the server has rotated it, overwriting the fresh token with a now-revoked one. Single-writer the keystore: only the App boot listener consumes; `signIn()` only opens the browser. Add module-level dedupe (`coldStartConsumed` flag + per-URL set) and serialize concurrent `loadSession` calls via an in-flight promise so the boot effect and sync loop share one rotation instead of racing.
- **Chrome Custom Tab same-origin navigation does NOT trigger Android App Link intents.** A `window.location.replace('https://app.example.com/...')` from a page already on `app.example.com` stays in the Custom Tab. Cross-origin redirects work fine. We bridge through a separate `/m/auth/done` page that's NOT same-origin from the prior step in our flow, so this hasn't bitten us — but it'll matter for any future "exchange and bounce within the app domain" pattern.
- **Dev Clerk instances (`*.accounts.dev`) work for prod but with caveats:** session cookies on `.accounts.dev` (third-party for our app domain), Clerk-sender email visible to users (we can't override on dev tier), no custom branding on hosted forms. Promote to a prod instance under `clerk.<own-domain>` before public sign-ups.

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

### Phase 3 — Mobile Launch (W6 → W9.5)

Phase 3 splits into three sub-phases. **3a** lays the cross-platform Tauri Mobile foundation; **3b** lands the touch-native UX + design framework on top; **3c** ships the launch surface (push, store metadata, prod Clerk, iOS device validation, beta cohort, App Store review).

#### Phase 3a — Mobile Foundation (W6, shipped)

**Goal:** Android build that passes the Pixel 9 Pro XL DoD: cold launch, sign-in via deep-link, refresh rotation, secure storage, sign-out.

- [x] Tauri Mobile project setup, shared `apps/client/src/` across desktop + Android (`packages/ui` extracted from `apps/client/src/{components,lib,store}`)
- [x] Android Keystore wrapper plugin (`packages/tauri-plugin-secure-store`) — AES-GCM ciphertext only on disk
- [x] Deep-link auth callback (`tauri-plugin-deep-link` + `1scratch://oauth/done`) with single-writer keystore + module-level cold-start dedupe
- [x] CORS allow-list for the three Tauri WebView origins (`apps/web/src/lib/cors-mobile.ts`) + `POST /api/mobile/refresh` route
- [x] Cert-pinning the API hostname — landed in 3a alongside Android networking (was originally Phase 2 deferred)

Spec: `docs/superpowers/specs/2026-04-19-phase3a-mobile-foundation-design.md`. Plan: `docs/superpowers/plans/2026-04-19-phase3a-mobile-foundation.md`. Real-device DoD trace in Build Log entries dated 2026-04-19→23.

**Deferred to 3a-ios-finish (Apple Developer enrollment unblocks):** iOS init from macOS, Apple Sign-In wiring, iOS Keychain wrapper, Privacy Manifest, TestFlight cert.

#### Phase 3b — Mobile Touch UX + Design Framework (W7 → W8.5)

**Goal:** Touch-native mobile shell with Quick Capture, Library, You, Stack/Spatial canvas, FTS search, and offline/sync UX. Engages below 600pt viewport on any platform; reuses existing stores unchanged. Render-layer-only seam (`apps/client/src/App.tsx` swaps to `<MobileShell />` below 600pt).

- [x] **PR 1 — Foundations:** viewport seam (`useViewport`), `MobileShell`, bottom-tab nav, `mobileNav` store, shared primitives (`SafeArea`, `BottomSheet`, `SwipeActions`, `PullToRefresh`, `SyncBanner`), hooks (`useNetwork`, `useHaptics`, `useShareIntent`) *(merged 2026-04-26)*
- [x] **PR 2 — Pointer Events shim:** `PointerDraggable` + `PointerResizable` replace `react-rnd` in `CardShell`; touch + mouse share one code path *(merged 2026-04-26 as #2 — see build log)*
- [x] **PR 3 — Quick Capture:** Composer (text + voice + camera + clipboard suggest), `RecentStack`, `MobileSignIn`. Voice = Web Speech API with Whisper fallback through `/api/ai`. Camera = Android `Intent.ACTION_IMAGE_CAPTURE` + EXIF-strip + thumbnail pipeline *(merged 2026-04-26 as #3 — see build log)*
- [x] **PR 4 — Library + You + Search:** Continue rail, `SectionTree`, `RecentCards`, FTS5 virtual table populated by sync engine writes, `SearchSheet` (offline), `DeviceList` against `/api/mobile/sessions`, `YouSurface` *(committed 2026-04-26 — see build log)*
- [x] **PR 5 — Canvas Stack + Spatial:** per-tab `viewMode`, `StackView` (vertical reorderable list), `SpatialView` (touch-friendly `<Canvas />`), image-card full + thumbnail storage *(committed 2026-04-26 — see build log)*
- [ ] **PR 6 — Sync resilience + native polish:** persistent outbox (per-mutation), `network-change` kick within 500ms, per-card sync pip, tab-badge dot, status-bar theming, haptics wiring, reduce-motion compliance, A11y sweep, manual Android device DoD runbook

Spec: `docs/superpowers/specs/2026-04-25-phase3b-mobile-touch-ux-design.md` *(spec file pending — plan landed first)*. Plan: `docs/superpowers/plans/phase3b_design_ux.md`.

**Exit criteria (gating PR 6):** Quick Capture round-trip on real Android (text + voice + camera + clipboard each create cards); Stack mode 50+ cards scroll smoothly; Spatial pinch-zoom matches desktop trackpad; offline 60s + 5 cards reconciles on second device within 10s; narrow-window desktop ≤ 600pt swaps to MobileShell with no remount errors; iOS Simulator build compiles (UX validation deferred to 3c per locked decision).

#### Phase 3c — Push, Store, Beta, Submission (W8.5 → W9.5)

**Goal:** Public-track readiness on both stores.

- [ ] iOS device finish: Apple Sign-In integration, iOS Keychain wrapper, Privacy Manifest, real-device UX validation (deferred from 3a + 3b)
- [ ] Android: Data Safety form, biometric unlock optional, App Links `assetlinks.json` hash for prod release keystore (3a only verified the AGP debug keystore SHA256)
- [ ] Push notification infra (APNs + FCM) — opt-in, used for daily-cap alerts and Pro feature events
- [ ] Production Clerk instance under `clerk.1scratch.ai` — promote off the dev `*.accounts.dev` instance before public sign-ups (cookies, sender email, branding)
- [ ] OS share-intent + shortcut routing (`useShareIntent` consumes `1scratch://share?…` payloads — parsed in 3b, routed in 3c)
- [ ] Beta cohort: 50 invitees via TestFlight + Play Internal
- [ ] App Store review submission **week 8.5** (buffer: review can take 1-2 wk)

**Exit criteria:** Signed builds on both stores in beta tracks; users can prompt → sync → see results on desktop; push notifications deliver to opted-in devices; prod Clerk handshake green from cold-start.

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

## 2026-04-26 — Phase 3b PR 5: Canvas Stack + Spatial

Scoped pass: PLAN §10 Phase 3b PR 5. Plan: `docs/superpowers/plans/2026-04-25-phase3b-mobile-touch-ux.md` §5 (Tasks 5.1–5.8). 8 commits on `main` (no feature branch — same direct-landing pattern as PR 4).

**Shipped (Tasks 5.1–5.8):**
- `canvas` store: added `viewModes: Record<canvasId, 'stack' | 'spatial'>` + `setViewMode(canvasId, mode)`. New exported `useEffectiveViewMode(canvasId)` hook resolves explicit per-tab override, else falls back to `isMobile && !settings.spatialOnMobile ? 'stack' : 'spatial'`.
- Mobile canvas surfaces under `packages/ui/src/components/mobile/canvas/`: `CanvasHeader` (back, tab-name button → `TabSwitcherSheet`, view-mode segmented toggle), `ImageCard` (renders `asset://localhost/${thumbPath}` when local, second-device placeholder when not), `CardBubble` (unified prompt/image renderer), `StackView` (vertical card list, swipe-Delete + swipe-Archive via `SwipeActions`, `PullToRefresh` wrapper), `SpatialView` (`touchAction:'none'` wrap of existing desktop `<Canvas />`), `MobileCanvas` (assembly).
- `Canvas.tsx`: added Pointer Events two-finger pinch-zoom + pan. New handlers (`onPointerDown/Move/Up`) tracked via `useRef<Map<pointerId, {x,y}>>`. Two-pointer state reads `useCanvasStore.getState()`, applies `panX/Y += centroid delta` and `zoom *= d / lastD` clamped 0.5–2.5×, then atomically `useCanvasStore.setState({...})`.
- `MobileShell.tsx`: replaces the `Canvas (PR 5)` placeholder with `<MobileCanvas />`.

**Plan deviations (production-driven):**
- Plan §5.1 step-1 comment said "alongside the existing per-tab viewport map", but the existing `canvas` store is flat (single `panX/Y/zoom`), not per-tab. Added `viewModes` as a flat `Record<canvasId, mode>`; left desktop pan/zoom alone. Per-tab viewport persistence stays out of scope until a future PR explicitly needs it.
- Plan §5.7 skeleton was untyped (`React.PointerEvent` only). Gated all new pointer handlers on `e.pointerType === 'touch'` so desktop mouse-emulation can't double-fire alongside the existing `onMouseDown` (which still owns desktop pan/wheel-zoom + click-to-create-card). Plan's atomic `setViewport((v) => …)` replaced with `useCanvasStore.setState({...})` since the store exposes `setPan` + `setZoom` separately and the plan wanted one update.
- Plan §5.7 skeleton imported `setViewport` directly. Real store has `setPan` and `setZoom` (origin-aware, MIN_ZOOM=0.25 / MAX_ZOOM=4) but the mobile pinch path wants flat 0.5–2.5× clamp without origin reflow. Bypassed the helpers, called `setState` directly with computed `{zoom, panX, panY}` — matches plan's intent.

**Verification:**
- Repo tests: `pnpm -r test` — 165 pass total (56 ui / 91 web / 18 sync-engine).
- `pnpm -w turbo run typecheck` — 5/5 packages green.
- Pre-existing jest-dom matcher type errors in `packages/ui/test-setup.ts`, `BottomSheet.test.tsx`, `SyncBanner.test.tsx` survive direct `tsc --noEmit` from older commits (`24a7079`, `6836f9c`, `16d18b5`); CI's `pnpm typecheck` is unaffected. Worth a follow-up to fix `expect.extend(matchers)` typing — out of scope for PR 5.
- Pixel device manual smoke (50+ card stack scroll, pinch-zoom 0.5–2.5×, two-finger pan, single-finger long-press card in spatial mode): not yet attempted — PR 6 device runbook. Scheduled follow-up agent for ~2 weeks.

**Deferred to PR 6 of Phase 3b:**
- PR 6: Sync resilience (persistent outbox per-mutation, `network-change` 500ms kick), per-card sync pip + tab-badge dot, status-bar theming, haptics wiring across the new pinch path, reduce-motion compliance, A11y sweep, manual Android device DoD runbook + real `SyncDiagnostics` wiring (replace YouSurface + `MobileCanvas.onRefresh` no-op placeholders with the SyncProvider exposure).

## 2026-04-26 — Phase 3b PR 4: Library + You + FTS5 search

Scoped pass: PLAN §10 Phase 3b PR 4. Plan: `docs/superpowers/plans/2026-04-25-phase3b-mobile-touch-ux.md` §4 (Tasks 4.1–4.9). 9 commits on `main` (no feature branch this round — direct landing pending PR/push by user).

**Shipped (Tasks 4.1–4.9):**
- `workspace` store: `Tab.lastTouchedAt?: number`. `setActiveTab` + `addTab` stamp `Date.now()` so `ContinueRail` can rank by recency. Missing on legacy rows is the documented null state.
- `apps/client/src/sync/schema.sql`: appended `cards_fts` virtual table (`tokenize = 'unicode61 remove_diacritics 2'`) + 3 sync triggers (`AFTER INSERT/UPDATE/DELETE ON cards`). Triggers project `prompt + ' ' + response` from the JSON `payload` plus `canvas.name` and `section.name` lookups. Schema is run once via `splitStatements` on cold start.
- `packages/ui/src/lib/fts.ts` + tests: `rewriteQuery` strips FTS5 special chars, appends `*` for prefix match, returns empty for whitespace. `searchCards(db, query, opts)` runs the bm25-ordered query. `snippetSegments(snippet)` parses `«…»` markers into `{text, hit}[]` so the React layer can render `<mark>` segments via plain text — no raw-HTML escape hatch.
- Library surfaces under `packages/ui/src/components/mobile/library/`: `ContinueRail` (top-3 tabs by `lastTouchedAt`), `SectionTree` (section/tab navigation mirroring desktop sidebar), `RecentCards` (paginated by 30, breadcrumb + 80-char preview), `SearchSheet` (debounced 150ms FTS5 input, results grouped by section), `Library` (assembly).
- You surfaces under `packages/ui/src/components/mobile/you/`: `SettingsRow` (label + control row primitive), `DeviceList` (`/api/mobile/sessions` GET + `/api/mobile/revoke` POST), `YouSurface` (Devices, Sync diagnostics, 4 toggles, sign-out).
- `MobileShell.tsx`: replaces `Library (PR 4)` and `You (PR 4)` placeholders with `<Library />` and `<YouSurface signOut={signOut} />`. `MobileShell` now takes a `signOut: () => Promise<void>` prop. `App.tsx`'s `ResponsiveShell` threads the existing `signOut({ apiBase: apiBaseUrl() })` wrapper through.

**Plan deviations (production-driven):**
- Plan Task 4.7 had `Database.load('sqlite:scratch.db')`. Real sync DB is `sqlite:sync.db` per `apps/client/src/sync/tauri-sqlite-store.ts`. Fixed.
- Plan Task 4.3 SQL used named binds (`$sectionId`, `$limit`). Tauri's `@tauri-apps/plugin-sql` uses numbered placeholders (`$1, $2, …`) per the sync store precedent. Rewrote to numbered binds (`[q, sectionId, sectionId, limit]` so the `($2 IS NULL OR cv.section_id = $3)` form keeps working).
- Plan Task 4.9 imported `signOut` directly from `auth/session` and called bare. Real `signOut()` requires `{apiBase}` (Vite-only resolution lives in `apps/client/src/sync/auth-token.ts`). Made `YouSurface` and `MobileShell` accept `signOut` as a prop so `@1scratch/ui` stays Vite-free — same pattern PR 3 used for `MobileSignIn`'s `signIn` prop.
- Plan Task 4.9's `DeviceList` used `(globalThis as any).API_BASE_URL`. Used the typed cast pattern from `voice.ts` instead: `(globalThis as unknown as { API_BASE_URL?: string }).API_BASE_URL ?? ''`.
- Plan Task 4.9's `SyncDiagnostics` was treated as a propless component (default-style import + `<SyncDiagnostics />` no props). Real `SyncDiagnostics` is a named export requiring `{outboxDepth, lastError, triggerNow}`. Wired with placeholders (`0/null/no-op`) so the build stays green; **real wiring needs the `SyncProvider` to expose those values, slated for PR 6**.

**Verification:**
- Repo tests: `pnpm -r test` — 165 pass total (56 ui — 3 new in `fts.test.ts` / 91 web / 18 sync-engine).
- `pnpm -w turbo run typecheck` — 5/5 packages green.
- Pixel device manual smoke (airplane-mode FTS hits + DeviceList revoke): not yet attempted — PR 6 device runbook.

**Deferred to PR 5-6 of Phase 3b:**
- PR 5: Canvas Stack + Spatial views + `MobileCanvas`.
- PR 6: Sync resilience + auth gate in `MobileShell` (real `loadSession`/`MobileSignIn` wiring) + `SyncDiagnostics` real wiring (replace YouSurface placeholders with `SyncProvider`-exposed `outboxDepth/lastError/triggerNow`) + Pixel device runbook.

## 2026-04-26 — Phase 3b PR 3: Quick Capture (composer, voice, camera, clipboard, ImageCard kind)

Scoped pass: PLAN §10 Phase 3b PR 3. Plan: `docs/superpowers/plans/2026-04-25-phase3b-mobile-touch-ux.md` §3 (Tasks 3.1–3.15). Branch: `phase3b-pr3-quick-capture`, stacked on PR 2; 14 commits. Merged 2026-04-26 as PR #3.

**Shipped (Tasks 3.1–3.15):**
- `cards` store (`packages/ui/src/store/cards.ts`): tagged-union `Card = PromptCard | ImageCard`. `BaseCard` now requires `canvasId` + `updatedAt` (Plan §3.1 had `canvasId` already; spec §15 mandated tagged-union). `loadCards` normalizes legacy rows (`kind: 'prompt'` default, `updatedAt` falls back to `createdAt`). `updateCard` stamps `updatedAt`.
- `voice.ts` + tests: `startDictation()` chooses Web Speech API when available, else falls back to `MediaRecorder` → `POST /api/ai` (multipart `transcribe=true`). 60s recording cap. Typed `VoiceError` union (`permission_denied | no_speech | network | transcribe_failed | cap_exceeded | unsupported`). 402 response surfaced as `cap_exceeded`.
- `/api/ai/route.ts`: multipart transcribe branch — auth → cap check → `experimental_transcribe` via plain `'openai/whisper-1'` slug (AI Gateway routes it). Charges per-second at $0.006/min via direct `ai_usage` insert. New file (existing `/api/ai/stream/route.ts` unchanged).
- `clipboard-suggest.ts` + tests: `evaluateClipboard()` reads via `@tauri-apps/plugin-clipboard-manager` (newly installed), gated by `settings.clipboardSuggestEnabled`, rejects empty/short-non-URL/already-seen-this-session via `sessionStorage` hash list.
- `image-pipeline.ts` + tests: `processCapturedImage(rawPath, cardId)` reads file (`@tauri-apps/plugin-fs`, newly installed), decodes via `createImageBitmap`, re-encodes via `OffscreenCanvas` at 2048px (full, q=0.85) and 320px (thumb, q=0.8) — strips EXIF as a side effect. Writes to `appDataDir/images/`, deletes raw.
- `mobile_camera` Rust command + Kotlin `MobileCameraPlugin`: cfg-gated Android shim (`#[cfg(target_os = "android")]`) following the haptic-plugin pattern. Plugin uses `MediaStore.insert` + `ACTION_IMAGE_CAPTURE` + `ActivityCallback`, resolves `content://` to filesystem path on legacy < Q. `AndroidManifest.xml` gets `CAMERA` permission + `IMAGE_CAPTURE` intent query. `MainActivity.onCreate` registers the plugin.
- React surfaces under `packages/ui/src/components/mobile/capture/`: `Composer` (autogrow + `visualViewport` keyboard tracking), `useVoiceDictation` hook (state machine + 60s countdown after 50s elapsed), `ClipboardSuggestChip`, `CameraSheet` (BottomSheet + invoke `mobile_camera` + pipeline), `RecentStack` (last 10 cards, swipe-to-delete via `SwipeActions`), `QuickCapture` (assembly).
- `MobileSignIn` (`packages/ui/src/components/mobile/auth/`): placeholder with `signIn` + `onSignedIn` callback props (deviates from plan — plan called bare `signIn()`, real `auth/session.signIn` requires `{webBase, returnUrl, shellOpen, deviceLabel}` opts).
- `MobileShell.tsx`: replaces capture-tab placeholder with `<QuickCapture />`. Other tabs still placeholders (PR 4/5).

**Plan deviations (production-driven):**
- Plan Task 3.1 only edited `cards.ts`. The tagged-union forced narrowing in 4 callers (TS errors): `runPrompt.ts`, `sync-provider.tsx`, `hydrate.ts`, plus rendering layer (`CardLayer.tsx` filters `kind === 'prompt'` for `NoteCard`; `NoteCard.tsx` + `CardControls.tsx` typed `card: PromptCard`). All narrowed via discriminator checks — bundled into the same commit.
- `cardFactory.ts.makeCard` previously took `(x, y, overrides)`. After `canvasId` became required on `BaseCard`, signature became `(canvasId, x, y, overrides)` and `Canvas.tsx` resolves `activeCanvasId` from `useWorkspaceStore`.
- `addCard` payloads: type system rejects mixed-shape literals. Used `Omit<PromptCard, ...> | Omit<ImageCard, ...>` and let the call site disambiguate via the shape it constructs.
- Plan Task 3.4 expected an existing `apps/web/src/app/api/ai/route.ts`. Repo has `/api/ai/stream/route.ts` only — created the route fresh. Plan referenced `getAIGatewayClient()` and `chargeCap()` placeholders; mapped to actual codebase: `resolveAuthedUserId`, `checkCap`, and a direct `INSERT INTO ai_usage` (whisper-1 isn't in `model-registry`, so `recordUsage` won't price it).
- Plan code used `createOpenAI({ apiKey: process.env.OPENAI_API_KEY })` (direct provider). Vercel hook `posttooluse-validate` flagged as ERROR ("provider keys bypass gateway"). Switched to AI Gateway via plain `'openai/whisper-1'` string with `providerOptions.gateway.{user, tags}` — matches `vercel-plugin:ai-gateway` skill guidance ("default to AI Gateway with provider/model strings"). No `OPENAI_API_KEY` needed; OIDC token does the auth on Vercel; falls back to `AI_GATEWAY_API_KEY` for local/CI.
- `image-pipeline.test.ts`: jsdom's `Blob` has no `arrayBuffer()`. Mock returns `{ arrayBuffer: async () => new ArrayBuffer(1), type: 'image/jpeg' }` cast to `Blob` instead of a real `Blob`.
- `clipboard-suggest.test.ts`: vite import-analyzer fails on `vi.mock('@tauri-apps/plugin-clipboard-manager', …)` if the package isn't installed (vite resolves the literal). Added `@tauri-apps/plugin-clipboard-manager@^2` to `packages/ui` deps. Same for `@tauri-apps/plugin-fs@^2` for `image-pipeline`.
- `voice.test.ts`: plan's mock put `isFinal` on the inner alternative array element, but Web Speech API spec puts it on the outer `SpeechRecognitionResult`. Test mock uses `Object.assign([{ transcript }], { isFinal })` to attach `isFinal` on the array itself — matches the impl's `e.results[i].isFinal` read.
- `api-ai-transcribe.test.ts`: clerk's `auth()` imports `server-only` and explodes outside Next.js context. `vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }) }))` then dynamic-import the route. Two of three tests gated by `hasDb && hasGateway` env, third runs without env (no-auth → 401 path).
- Plan Task 3.14 had `MobileSignIn` calling `signIn()` bare. Real `signIn()` requires `{webBase, returnUrl, shellOpen, deviceLabel}`. Made `MobileSignIn` accept `signIn: () => Promise<void>` + `onSignedIn` props so the parent (PR 6's full shell) wires the env-aware values.
- Plan Task 3.15 wired `loadSession()` + `MobileSignIn` gate. `loadSession()` requires `{apiBase}` opt; the auth gate needs full session machinery that lives in PR 6's scope. Deferred — `MobileShell` renders `<QuickCapture />` unconditionally for now.

**Verification:**
- Repo tests: `pnpm -r test` — 162 pass total (53 ui / 91 web / 18 sync-engine).
- `npx tsc --noEmit` clean across `packages/ui`, `apps/web`, `apps/client`.
- `cargo check` clean for `apps/client/src-tauri` (host build; Android command is `cfg`-gated and only typechecks under the Android target).
- AI Gateway integration test (`api-ai-transcribe.test.ts`) requires `DATABASE_URL` + `DATABASE_URL_ADMIN` + `AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN` — describe-skip otherwise. Auth-401 path always runs.
- Pixel device manual smoke (text/voice/camera/clipboard each create cards; 60s voice cap auto-stops): not yet attempted — PR 6 device runbook.

**Stacked-PR flow:**
- PR 3 was opened with `base = phase3b-pr2-pointer-shim` because PR 2 hadn't merged yet (Plan rule: "Each PR ships independently. Do not start PR N+1 until PR N is merged"). After PR 2 merged, retargeted PR 3 base → main via `gh pr edit 3 --base main` (GitHub kept the diff clean since PR 2 commits were already in main). Merged minutes after PR 2.
- Vercel preview check on PR 2 head showed a stale failure (status updated 2026-04-26T19:26Z, after the actual deploy succeeded at 19:12Z). Independent re-deploy dropped a docs-page redirect; left it alone since (a) the same `vercel.json` keeps shipping production deploys green, (b) PR 3's deploy on the stacked branch came up `Ready`. Branch protection isn't enforced, so the stale check didn't block merge.

**Deferred to PR 4-6 of Phase 3b:**
- PR 4: Library + You + FTS5 search.
- PR 5: Canvas Stack + Spatial views + `MobileCanvas` (lights up `selectedCardId` on touch + ImageCard render path).
- PR 6: Sync resilience + auth gate in `MobileShell` (real `loadSession`/`MobileSignIn` wiring) + Pixel device runbook.

**Pre-existing config to clean up:**
- `apps/web/.vercel/vercel.json` references `/api/cron/compact-mutations` (route doesn't exist — only `purge-deletions`). Pre-dates Phase 3b; production deploys still green with it. Note for Phase 4 backend cleanup or M1a polish.

## 2026-04-26 — Phase 3b PR 2: Pointer Events shim, replaces `react-rnd`

Scoped pass: PLAN §10 Phase 3b PR 2. Plan: `docs/superpowers/plans/2026-04-25-phase3b-mobile-touch-ux.md` §2 (Tasks 2.1–2.6). Branch: `phase3b-pr2-pointer-shim` (6 commits on top of `main`).

**Shipped (Tasks 2.1–2.5):**
- `PointerDraggable` (`packages/ui/src/components/mobile/shared/PointerDraggable.tsx` + tests): pointer-down/move/up with `setPointerCapture`, `longPressMs` gate (default 0 = instant; non-zero starts inert and arms a timer; 8px move before timer fires cancels), `disabled`, `handle` selector for drag-zone scoping, multi-pointer guard via `pointerId`.
- `PointerResizable` (sibling file + tests): bottom-right 24×24 handle, only rendered when `selected`, `minWidth=80`/`minHeight=60` clamps.
- `cards` store: `selectedCardId: string | null` + `setSelectedCard`. `removeCard` clears matching selection. `clearAll` resets it. Drives resize-handle visibility — handle hidden until card is tapped/clicked.
- `CardShell` rewritten on top of the shim. Public `{ card, children }` prop signature kept (plan's snippet flattened to `{id,x,y,…}` but `NoteCard` is the sole caller and the flatten is gratuitous). Drag-tab UI, `scratch-card` class, and `zIndex` stacking preserved per plan note line 2129. `pointerDownCapture` on the outer wrapper fires `bringToFront(card.id)` + `setSelectedCard(card.id)` on every interaction (replaces react-rnd's `onMouseDown` + `onDragStart`/`onResizeStart`).
- `react-rnd` removed from `packages/ui/package.json` (sole importer) and `apps/client/package.json` (carried but unused). Lockfile pruned.

**Plan deviations (production-driven):**
- Test infra: `@testing-library/jest-dom/vitest` side-effect import did not register matchers under vitest 2.1 + jest-dom 6.9.1 (chai's proxy reported "Invalid Chai property: toBeInTheDocument"). Fixed by switching `packages/ui/src/test-setup.ts` to explicit `import * as matchers from '@testing-library/jest-dom/matchers'; expect.extend(matchers)`. Pre-existing failures from PR 1 (`SyncBanner`, `BottomSheet`) green after fix. Bundled into PR 2 as a one-line commit (`24a7079`) since PR 1 had merged with these tests broken.
- jsdom 25 does not implement `Element.setPointerCapture`/`releasePointerCapture`/`hasPointerCapture`. Plan's verbatim shim impl calls `setPointerCapture` so all shim tests crashed with `TypeError`. Added a no-op stub on `Element.prototype` in `test-setup.ts` (guarded by `typeof === 'function'` check). Plan's Task 1.0 should have anticipated this — note for the PR 1 retrospective.
- Plan's `CardShell` snippet drops `zIndex`, the drag-tab UI, and the `scratch-card` wrapper. Kept all three to preserve desktop CSS contract (the plan note at line 2129 says "Keep any pre-existing class names / data attributes that desktop CSS depends on" — I read that as covering the inline-styled drag-tab affordance too).
- `onPositionChange` / `onSizeChange` fire on every pointermove (plan-prescribed). With current cards store + sync engine that is one `updateCard` per move = many outbox writes per drag. Tolerable now; PR 6's `persistOnEveryMutation` flag plus the network-change kick will swallow the cost. Flag for revisit if drag latency shows up before then.

**Verification:**
- `pnpm --filter @1scratch/ui test` — 45 / 45 pass (was 36 / 39 before PR 1's matcher-extend fix).
- `pnpm -w typecheck` clean.
- Desktop manual drag/resize + Pixel device long-press in spatial mode: not yet attempted — PR 2 ships scaffolding for `CardShell`; spatial mode lights up in PR 5. Both checkboxes left open in the PR description.

**Deferred to PR 3-6 of Phase 3b:**
- PR 3: Quick Capture (composer + voice + camera + clipboard + ImageCard kind + MobileSignIn).
- PR 4: Library + You + FTS5 search.
- PR 5: Canvas Stack + Spatial views + `MobileCanvas` (lights up `selectedCardId` on touch).
- PR 6: Sync resilience (`persistOnEveryMutation`, `network-change` kick, per-card sync state) + Pixel device runbook (DoD).

## 2026-04-25 → 2026-04-26 — Phase 3b PR 1: mobile foundations (viewport seam, primitives, hooks, haptics)

Scoped pass: PLAN §10 Phase 3 step 2 — touch-UX foundations. Spec: `docs/superpowers/specs/2026-04-25-phase3b-mobile-touch-ux-design.md`. Plan: `docs/superpowers/plans/2026-04-25-phase3b-mobile-touch-ux.md` (PR 1 of 6).

**Shipped (Tasks 1.0–1.17):**
- Test infra: jsdom + `@testing-library/react` + `PointerEvent` polyfill + `ResizeObserver`/`IntersectionObserver` stubs in `packages/ui/src/test-setup.ts`. 39 tests across 13 files green.
- Hooks: `useViewport` (visualViewport + safe-area probe + `isMobile` < 600pt), `useNetwork` (Tauri `network-change` + web `online`/`offline` fallback), `useHaptics` (gated by `hapticsEnabled` + `reduceMotion`), `useShareIntent` (cold-start + runtime parse for `1scratch://capture` and `1scratch://share`).
- Stores: new `mobileNav` (tab + sheet stack + localStorage tab persistence). `settings` extended with `hapticsEnabled` (default true), `reduceMotion`, `spatialOnMobile`, `clipboardSuggestEnabled`.
- Shared primitives under `packages/ui/src/components/mobile/shared/`: `SafeArea`, `BottomSheet` (open/close + backdrop dismiss + drag-to-dismiss with 30% threshold + focus trap), `SwipeActions` (64pt threshold), `PullToRefresh`, `SyncBanner` (4 states; final wiring deferred to PR 6), `TabSwitcherSheet`.
- Layout: `BottomTabBar` (4-tab nav with light haptic on switch + safe-area-bottom), `MobileShell` skeleton (header + tab-routed main + tab bar). Barrel exports added to `packages/ui/src/index.ts`.
- Render seam in `apps/client/src/App.tsx`: new `ResponsiveShell` toggles via `hidden` between desktop `Shell` and `MobileShell` based on `useViewport().isMobile`. `SyncProvider` hoisted out of `Shell` so it mounts once around `ResponsiveShell` and survives the toggle (preserves sync loop + zustand subscriptions across resize).
- Rust mobile commands: `mobile_haptic`, `mobile_status_bar`, `mobile_network_probe` (in `apps/client/src-tauri/src/commands/`); `core:event:default/allow-emit/allow-listen` capabilities added to `mobile.json`.
- Android Kotlin: `MobileHapticPlugin` registered via `MainActivity.registerPlugin()`; three-tier SDK guard (`minSdk = 24`): API 24-25 falls back to deprecated `vibrate(durationMs)`, API 26-28 uses `createOneShot/createWaveform`, API 29+ uses `createPredefined(EFFECT_TICK/EFFECT_CLICK)`.

**Plan deviations (production-driven):**
- `useShareIntent` listens via new `lib/share-intent-link.ts` instead of importing `auth/deep-link.ts` — the existing `matches()` filter only surfaces auth URLs, so re-import would silently drop capture/share intents at runtime (mocked tests would still have passed). Both modules co-subscribe via Tauri's `listen()` which supports independent subscribers.
- `mobile_haptic.rs` Android branch uses `PluginApi::register_android_plugin` + managed `PluginHandle` state (Tauri 2.10.3 actual API) instead of the plan's `app.android_plugin_handle()` (does not exist in this version).
- `MobileHapticPlugin.kt` adds three-tier SDK guard so the plugin works on `minSdk = 24` rather than crashing on API <29.
- `useViewport` test wraps the resize assertion in `waitFor` because the rAF batch does not flush synchronously inside `act` in this jsdom/vitest combo. Plan's task 1.1 anticipated this.
- Race-guard pattern (mounted/cancelled flag on dynamic-import resolution) applied to `useNetwork` and `useShareIntent` — without it, an unmount-before-import-resolves leaks the Tauri listener.

**Deferred to PR 2-6 of Phase 3b:**
- PR 2: `PointerDraggable`/`PointerResizable` shim + `react-rnd` removal in `CardShell`.
- PR 3: Quick Capture (composer + voice + camera + clipboard + ImageCard kind + MobileSignIn).
- PR 4: Library + You + FTS5 search (SQLite migration `0002_fts.sql`).
- PR 5: Canvas Stack + Spatial views + `MobileCanvas`.
- PR 6: Sync resilience (`persistOnEveryMutation`, `network-change` kick, per-card sync state, tab-badge dot, status-bar theming) + Pixel device runbook (DoD).

**Real-device DoD: not yet attempted in PR 1.** Foundations are scaffolding only — UI is placeholder `<h1>` per tab. Pixel runbook lands in PR 6.

## 2026-04-25 — §10 Phase 3 split into 3a/3b/3c; Claude Design framework adopted as 3b

§10 Phase 3 was a single eight-bullet block. Restructured into three sub-phases:

- **3a — Mobile Foundation** (already shipped, see entry below dated 2026-04-19→23). Items moved up: Tauri Mobile setup, Android Keystore wrapper, deep-link auth, CORS for Tauri WebView, cert-pinning (cert-pinning was originally Phase 2 deferred-to-3 — landed in 3a).
- **3b — Mobile Touch UX + Design Framework** (new, expanded). Original 3b touch-UX bullets ("Adapt sidebar / tab UX for touch", "Offline-first writes / sync on foreground") are absorbed into a much fatter mobile-native shell delivered by Claude Design: viewport seam below 600pt swapping to `<MobileShell />`, bottom-tab nav (Capture / Canvas / Library / You), `PointerDraggable` shim replacing `react-rnd`, Quick Capture composer (text + voice + camera + clipboard suggest), Library (Continue rail + section tree + recent), You (devices + settings), Stack vs Spatial canvas views, FTS5 offline search, persistent outbox + network-change kick. Six PRs.
- **3c — Push, Store, Beta, Submission** (new). Receives all launch-track items deferred from the original 3b: push infra (APNs + FCM), Play Console / store metadata + Data Safety form, App Links assetlinks for prod release keystore, prod Clerk instance promotion off `*.accounts.dev`, iOS Apple Sign-In + Privacy Manifest + real-device UX (also deferred from 3a-ios-finish), OS share-intent routing, beta cohort, App Store review submission.

Why now: Claude Design produced a full 3b plan (`docs/superpowers/plans/phase3b_design_ux.md`) covering the touch UX layer plus mobile-native surfaces (Quick Capture / Library / You / Stack/Spatial / FTS) that the original PLAN didn't enumerate. Merging it under "3b" preserves the W6→W9 schedule but makes the launch surface (3c) explicit instead of implicit.

**Old assumption superseded:** previously "Phase 3" was a single mobile-launch block; future-us re-reading line 525-538 should look to the three sub-phases instead.

**Spec gap flagged:** the Claude Design plan references `docs/superpowers/specs/2026-04-25-phase3b-mobile-touch-ux-design.md`, which is not yet in `docs/superpowers/specs/`. Plan landed first; spec to follow.

## 2026-04-19 → 2026-04-23 — Phase 3a: mobile foundation (Android-first)

Scoped pass: PLAN §10 Phase 3 step 1 (Tauri Mobile project setup, shared `src/`)
plus the mobile-side prerequisites: secure storage, deep-link OAuth callback,
and own-token auth so `/api/sync/*` can be reached over a refreshable bearer.
Apple Developer enrollment blocked → iOS slice is skeleton-only.

Spec: `docs/superpowers/specs/2026-04-19-phase3a-mobile-foundation-design.md`
Plan: `docs/superpowers/plans/2026-04-19-phase3a-mobile-foundation.md`

**Shipped (Tasks 1-29 + DoD-driven fixes):**
- `packages/ui/` — extracted from `apps/client/src/{components,lib,store}` so future mobile/web consumers reuse the canvas + cards + auth helpers without duplication.
- `packages/tauri-plugin-secure-store/` — Android `EncryptedSharedPreferences` (AES-256-GCM via Jetpack Security MasterKey), iOS Keychain (Swift, skeleton — Apple gate), desktop keyring fallback, single JS API (`secureStore.{get,set,delete,has}`).
- Migration `0003_device_sessions.sql` + Drizzle types + RLS. Composite unique on `(user_id, device_id)` so re-sign-in rotates in place.
- `MOBILE_JWT_SIGNING_KEY` HS256 access JWT (15 min) + 30-day refresh token rotated on use; `device_sessions` table; `/api/mobile/{init,exchange,refresh,revoke}`.
- `resolveAuthedUserId()` swap across all self-gating routes; `proxy.ts` matcher relaxed to `/app(.*)` + `/mobile(.*)` so API routes self-gate via bearer-or-Clerk.
- `/sign-in?return=…` cookie flow + `/mobile/handoff` browser-handoff page that exchanges via Clerk session and bridges to `/m/auth/done?access=…&refresh=…`.
- Tauri Android init committed (`src-tauri/gen/android`); deep-link, opener, shell plugins wired; `tauri.conf.json` identifier → `ai.scratch.app`.

**Real-device DoD on Pixel 9 Pro XL — passed steps 1-4, 6, 7. Step 5 sync-via-UI deferred (see below).**

**DoD-driven bug fixes — each one was a real failure on the device, found via adb logcat or Vercel runtime logs while attempting Task 30 steps 3-7:**
- `apps/web/src/proxy.ts` + `apps/web/src/lib/cors-mobile.ts`: Tauri Android WebView origin is `http://tauri.localhost`; CORS preflight on `POST /api/mobile/refresh` (and `/api/sync/*`) returned 204 with no `Access-Control-Allow-Origin`, so the WebView blocked the rotation fetch and `consume()` swallowed the failure into a sign-in loop. Middleware now whitelists the three Tauri origins and short-circuits OPTIONS.
- `apps/client/src-tauri/gen/android/app/src/main/AndroidManifest.xml`: deep-link `pathPrefix="/m"` was a string-prefix match — it also matched `/mobile/handoff?__clerk_handshake=…` and yanked the user out of Chrome mid-Clerk-handshake into the app with an unfinished URL. Tightened to `/m/`. Same fix in `tauri.conf.json` so future regeneration preserves it.
- `AndroidManifest.xml`: added `android:allowBackup="false"` after Auto Backup restored stale `EncryptedSharedPreferences` ciphertext onto a freshly-generated MasterKey, surfacing as `javax.crypto.AEADBadTagException` on first read after reinstall. `SecureStorePlugin.kt` also wraps prefs init/read in a try/catch that wipes the file and retries with a fresh key — defense in depth for keystore resets.
- `apps/web/src/app/api/mobile/exchange/route.ts`: `device_sessions_user_id_fkey` violated when the Clerk webhook hadn't fired for an existing user (signed up pre-webhook configuration). Lazy-provision the `users` row via Clerk `currentUser()` before `createSession` — idempotent on conflict.
- **Vercel `CLERK_SECRET_KEY`** was literally the masked-display string `••••…` (50 × U+2022 bullets). Server logs surfaced it as `unable to resolve handshake: TypeError: Cannot convert argument to a ByteString because the character at index 7 has a value of 8226`. User rotated to the real `sk_test_…` from the Clerk dashboard.
- `packages/ui/src/auth/session.ts` + `apps/client/src/App.tsx`: refresh-token race. Previously, the App boot listener and `signIn()` itself BOTH consumed the deep-link URL — App rotated `r1→r2` server-side, then `signIn()` overwrote `r2` in the keystore with the now-revoked `r1`. Plus React strict-mode/Vite-HMR remount replayed the cold-start consume across mounts. Fixes: (a) `signIn()` only opens the system browser, never touches the keystore; the App listener is the sole writer; (b) module-level `coldStartConsumed` flag + per-URL dedupe set on the App side; (c) `loadSession` body wrapped in a module-level in-flight promise so concurrent callers (sync loop + App boot) share the single rotation instead of racing 3 POSTs and self-poisoning the keystore on the second 401.

**DoD results:**
- ✅ Step 1: `adb devices` — Pixel 9 Pro XL.
- ✅ Step 2: `pnpm android:dev` — Gradle build + streamed install via `adb install`.
- ✅ Step 3: Sign-in: tap → Chrome Custom Tab → `/api/mobile/init` → Clerk Google OAuth → `/mobile/handoff` → `/api/mobile/exchange` → `/m/auth/done` → App Link intent → workbench renders.
- ✅ Step 4: `adb shell run-as ai.scratch.app cat shared_prefs/scratch_secure.xml` — only ciphertext (base64 AES-GCM blobs); no readable refresh.
- ⏸️ Step 5: sync round-trip from the workbench. The auth/CORS path was verified end-to-end via `/api/mobile/refresh` POSTs visible in Vercel logs, but card creation requires touch UX that hasn't been wired (Phase 3b scope). Deferring the prompt-typed-shows-in-Neon assertion to Phase 3b after touch interactions land.
- ✅ Step 6: swipe-from-recents + relaunch → no sign-in prompt; workbench renders directly via `loadSession` → rotated refresh.
- ✅ Step 7: red Sign-out button revokes server-side; `device_sessions.revoked_at` populated; client returns to sign-in screen.

**Deferred to 3a-ios-finish (Apple unblocks):**
- iOS init from macOS, Apple Sign-In wiring, TestFlight, Privacy Manifest.

**Deferred to 3b/3c:**
- Touch UX (3b) — workbench layout overflows status bar; cards aren't creatable on touch; sign-out button kept on top-right with `safe-area-inset-top` for now.
- Foreground sync triggers + sync-via-touch verification (3b).
- Push infra (3c), Play Console / store metadata (3c), App Links assetlinks.json hash for the prod release keystore (currently only the AGP debug keystore SHA256 is verified; release-channel metadata pending Play Console enrollment).
- Production Clerk instance: prod still uses the `optimum-roughy-33.clerk.accounts.dev` dev FAPI. The handshake works through Custom Tab on the dev instance; promote to a prod instance under `clerk.1scratch.ai` before public sign-ups.

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
