# Phase 3a — Mobile Foundation (design spec)

**Date:** 2026-04-19
**Scope:** PLAN.md §10 Phase 3 — *foundation slice only*: Tauri Mobile project setup, shared `src/` extraction, secure storage, Clerk session over browser-handoff, deep-link plumbing.
**Out of scope (separate specs):** 3b touch UX + sync resilience, 3c push notifications + store distribution.

---

## 1. Locked decisions

| # | Decision | Notes |
|---|---|---|
| 1 | Spec scope | Phase 3a Mobile Foundation only |
| 2 | Platform order | **Android first**; iOS skeleton compiles in simulator; Apple cert work deferred (Apple Developer enrollment blocked on prior-account dispute) |
| 3 | Workspace layout | Extract `apps/client/src/{components,lib,store}` into new `packages/ui` workspace package; `apps/client` becomes a thin Tauri shell |
| 4 | Bundle / package ID | `ai.scratch.app` (replaces `com.gino.scratch`) |
| 5 | Auth shape | Tauri opens system browser → `https://app.1scratch.ai/sign-in?return=1scratch://auth/done` → after Clerk auth, `/mobile/handoff` calls `/api/mobile/exchange` → deep-link returns refresh + access |
| 6 | Token model | Own `device_sessions` table; **15-min HS256 access JWT** signed with `MOBILE_JWT_SIGNING_KEY`; **30-day refresh token** rotated on use; revocable per device |
| 7 | Secure storage | Custom thin Tauri plugin `tauri-plugin-1scratch-secure-store`; Android = `EncryptedSharedPreferences` (Keystore-backed); iOS = Keychain (Swift stub-OK in 3a); desktop = `keyring` crate fallback. Single JS API across platforms. |
| 8 | Deep-link plugin | Official `tauri-plugin-deep-link@2`; custom scheme `1scratch://auth/done` is the runtime path; Android App Links wired in config but `assetlinks.json` deferred to 3c |
| 9 | Definition of done | Real Android device (Pixel-class) round-trip: sign-in → exchange → sync push → server stores → pull echoes; iOS = Xcode simulator compiles + Workbench renders |

---

## 2. Workspace layout

```
apps/
  client/                        Tauri shell (desktop + mobile)
    src/                         shrinks → main.tsx + Tauri-specific bootstrap
    src-tauri/
      Cargo.toml                 + deep-link, shell, os, secure-store (path), keyring (desktop only)
      gen/apple/                 NEW (tauri ios init); checked in
      gen/android/               NEW (tauri android init); checked in
      capabilities/
        desktop.json             RENAMED from default.json; platforms: ["macOS","linux","windows"]
        mobile.json              NEW; platforms: ["iOS","android"]
      tauri.conf.json            identifier → ai.scratch.app; deep-link config added
  web/                           unchanged surface; new routes added (§4)
packages/
  ui/                            NEW workspace package (@1scratch/ui)
    package.json
    src/
      components/                moved from apps/client/src/components/*
      lib/                       moved (cardFactory, colors, persistence, runPrompt, ai)
      store/                     moved (canvas, cards, settings, workspace)
      auth/
        session.ts               NEW — loadSession/signIn/signOut/refresh
        deep-link.ts             NEW — listenForAuthCallback, getColdStartUrl
      hooks/
        usePlatform.ts           NEW — runtime detect (touch vs desktop)
      secure-store.ts            NEW — JS API over the plugin
      index.ts                   barrel
  sync-engine/                   unchanged
  sync-proto/                    unchanged
  types/                         unchanged
  tauri-plugin-secure-store/     NEW (Rust + Kotlin + Swift)
    Cargo.toml
    src/lib.rs                   plugin registration; commands: get/set/delete/has
    android/src/main/kotlin/app/scratch/securestore/SecureStorePlugin.kt
    ios/Sources/SecureStore/SecureStorePlugin.swift
    permissions/
      get.toml set.toml delete.toml has.toml
```

**Extraction PR mechanics (single PR, two commits max):**

1. `pnpm -w tsc -b` baseline green.
2. Commit 1 — package skeleton: create `packages/ui/{package.json,tsconfig.json,src/index.ts}`, `packages/tauri-plugin-secure-store/{Cargo.toml,src/lib.rs}`. (`pnpm-workspace.yaml` already has `packages/*` glob — no edit needed.)
3. Commit 2 — relocate + rewrite imports:
   - `git mv apps/client/src/{components,lib,store} packages/ui/src/`
   - `apps/client/src/main.tsx`, `App.tsx`, `sync/*.ts` updated import paths to `@1scratch/ui/*`.
   - No semantic changes to moved code.
4. `pnpm -w tsc -b` clean before mobile bootstrap.

---

## 3. Tauri mobile bootstrap

**One-time init (committed, not regenerated):**

```bash
cd apps/client/src-tauri
pnpm tauri android init    # creates gen/android/; needs ANDROID_HOME + NDK
pnpm tauri ios init         # creates gen/apple/; macOS+Xcode required (skip on Linux)
```

iOS init step documented as macOS-only. Linux dev machines run only `android init` and skip iOS until macOS is available; the spec accepts that `gen/apple` may be added in a follow-up commit from a macOS environment.

**`apps/client/src-tauri/Cargo.toml` additions:**

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
tauri-plugin-deep-link = "2"
tauri-plugin-shell = "2"
tauri-plugin-os = "2"
tauri-plugin-1scratch-secure-store = { path = "../../../packages/tauri-plugin-secure-store" }

[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
keyring = "3"
```

Pin Tauri minor version explicitly (the mobile-plugin Kotlin/Swift macro API has churned). Lock to whatever current `Cargo.lock` records at start of implementation; document the version in the implementation plan.

**`src-tauri/src/lib.rs`:**

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_1scratch_secure_store::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**`tauri.conf.json` additions:**

```json
{
  "identifier": "ai.scratch.app",
  "plugins": {
    "deep-link": {
      "mobile": [{ "host": "app.1scratch.ai", "pathPrefix": ["/m"] }],
      "desktop": { "schemes": ["1scratch"] }
    }
  }
}
```

The exact key shape for `plugins.deep-link` should be verified against the installed `tauri-plugin-deep-link@2` schema during the implementation plan write-up — Tauri 2 plugin config layouts have shifted across minor releases. Adjust to current schema if it differs; the *intent* (custom scheme `1scratch://` + Android App Links host `app.1scratch.ai`) is locked.

**`capabilities/mobile.json` (NEW):**

```json
{
  "$schema": "../gen/schemas/mobile-schema.json",
  "identifier": "mobile",
  "description": "Capabilities for iOS and Android",
  "platforms": ["iOS", "android"],
  "windows": ["main"],
  "permissions": [
    "core:default",
    "sql:default", "sql:allow-load", "sql:allow-execute", "sql:allow-select",
    "deep-link:default", "deep-link:allow-get-current",
    "shell:allow-open",
    "os:allow-platform", "os:allow-version",
    "secure-store:default"
  ]
}
```

**`capabilities/desktop.json` (RENAMED from default.json):** `platforms: ["macOS","linux","windows"]`; same desktop perms plus `shell:allow-open`, `deep-link:default`, `secure-store:default`.

**`apps/client/package.json` scripts:**

```json
"android:dev": "tauri android dev",
"android:build": "tauri android build",
"ios:dev":     "tauri ios dev",
"ios:build":   "tauri ios build"
```

---

## 4. Auth: device sessions + browser handoff

### 4.1 Migration `0003_device_sessions.sql`

```sql
create table device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  device_id text not null,
  device_label text,
  refresh_hash text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, device_id)
);
alter table device_sessions enable row level security;
alter table device_sessions force row level security;
create policy device_sessions_owner on device_sessions for all
  using (user_id = current_setting('app.user_id')::uuid);
create index on device_sessions (refresh_hash) where revoked_at is null;
```

Apply via Neon MCP `run_sql_transaction` with leading `SET ROLE neondb_owner` (per Phase 2 step 7-9-10 lesson in PLAN build log).

### 4.2 New env

| Var | Scope | Purpose |
|---|---|---|
| `MOBILE_JWT_SIGNING_KEY` | Vercel Prod+Preview+Dev + `.env.development.local` | 32-byte base64; HS256 access JWT signing |
| `MOBILE_JWT_ISS` | same | `https://app.1scratch.ai` |

### 4.3 New routes (apps/web)

| Route | Auth | Body / Query | Returns |
|---|---|---|---|
| `GET /sign-in` (existing) | none | `?return=<deep-link-url>` | Stashes `return` in HttpOnly cookie if it matches `^1scratch://auth/done(\?|$)`; otherwise discarded |
| `GET /mobile/handoff` | Clerk session | reads cookie | Renders page that POSTs to `/api/mobile/exchange`, then `window.location = ${return}?refresh=…&access=…&exp=…` |
| `POST /api/mobile/exchange` | Clerk session | `{ device_id, device_label }` | `{ access_jwt, access_exp, refresh_token, refresh_exp, user: { id } }`. Upserts `device_sessions` row keyed by `(user_id, device_id)`. Audit `mobile_session_created`. |
| `POST /api/mobile/refresh` | Bearer = refresh token | (no body) | New `{ access_jwt, refresh_token, ... }` pair. Hashes incoming, looks up unrevoked, rotates row + revokes old in same tx. Audit `mobile_session_refreshed`. 401 on missing/revoked/expired. |
| `POST /api/mobile/revoke` | Bearer = access OR refresh | (no body) | 204. Marks row revoked. Audit `mobile_session_revoked`. |

### 4.4 Access JWT shape (HS256)

```json
{ "iss": "https://app.1scratch.ai", "sub": "<user_id>", "sid": "<device_session_id>", "iat": ..., "exp": iat + 900 }
```

### 4.5 Backend gate

Add `verifyMobileBearer(req)` upstream of the existing Clerk-session resolver used by these protected routes:

- `/api/sync/push`, `/api/sync/pull`
- `/api/ai/stream`
- `/api/providers`, `/api/providers/[id]`, `/api/providers/[id]/verify`
- `/api/model-slots`, `/api/model-slots/[slot]`
- `/api/cap`
- `/api/audit-events`
- `/api/account/delete-request`, `/api/account/delete-cancel`
- `/api/import/scratch`

**NOT gated** (intentionally public per existing Phase 2 design): `/api/account/delete-confirm` (token in URL is the proof), `/api/webhooks/*` (Svix-verified), `/api/cron/*` (CRON_SECRET-gated). `/oauth/*` keeps current Clerk session handling.

If `Authorization: Bearer eyJ…` is present and the HS256 signature verifies against `MOBILE_JWT_SIGNING_KEY`, set `userId = sub`. Existing `withRls(userId, …)` works unchanged. Falls through to Clerk's `auth()` if no bearer.

### 4.6 Client flow (`packages/ui/src/auth/session.ts`)

`apiBase` and `webBase` resolve from the existing `apiBaseUrl()` helper in `apps/client/src/sync/auth-token.ts` (extends to `webBaseUrl()` reading `VITE_WEB_BASE_URL`, defaulting to `https://app.1scratch.ai`).

```ts
// Pseudocode shape — exact API per implementation plan.
export async function loadSession(): Promise<{ access: string; userId: string } | null> {
  const refresh = await secureStore.get('refresh')
  if (!refresh) return null
  const res = await fetch(`${apiBase}/api/mobile/refresh`, { method: 'POST', headers: { Authorization: `Bearer ${refresh}` } })
  if (res.status === 401) { await signOut(); return null }
  const body = await res.json()
  await secureStore.set('refresh', body.refresh_token)
  return { access: body.access_jwt, userId: body.user.id }
}

export async function signIn(): Promise<{ access: string; userId: string }> {
  const deviceId = await ensureDeviceId()  // secure-store get-or-create
  const url = `${webBase}/sign-in?return=1scratch://auth/done`
  const cold = await getColdStartUrl()  // synchronous-ish: must check before opening shell
  const result = cold ?? await new Promise<URL>((resolve) => {
    listenForAuthCallback(resolve)
    shell.open(url)
  })
  const access = result.searchParams.get('access')!
  const refresh = result.searchParams.get('refresh')!
  await secureStore.set('refresh', refresh)
  return { access, userId: jwtSub(access) }
}

export async function signOut(): Promise<void> {
  const refresh = await secureStore.get('refresh')
  if (refresh) await fetch(`${apiBase}/api/mobile/revoke`, { method: 'POST', headers: { Authorization: `Bearer ${refresh}` } }).catch(() => {})
  await secureStore.delete('refresh')
}
```

`apps/client/src/sync/auth-token.ts` rewrites: `getAuthToken()` calls `loadSession().access`. The dev `VITE_DEV_CLERK_TOKEN` shim is removed.

### 4.7 CSRF guard

`/sign-in?return=…` only honors `return` matching `^1scratch://auth/done(\?|$)`. Other schemes/hosts → discarded; user is redirected to `/app` after sign-in (existing behavior).

`/mobile/handoff` requires the cookie set by `/sign-in?return=…` AND a Clerk session — neither alone is enough.

---

## 5. Secure-storage plugin

### 5.1 `packages/tauri-plugin-secure-store/src/lib.rs`

```rust
use tauri::{plugin::{Builder, TauriPlugin}, Runtime};

#[cfg(mobile)] mod mobile;
#[cfg(desktop)] mod desktop;

#[tauri::command]
async fn get<R: Runtime>(app: tauri::AppHandle<R>, key: String) -> Result<Option<String>, String> {
  #[cfg(mobile)] return mobile::get(&app, &key).await.map_err(|e| e.to_string());
  #[cfg(desktop)] return desktop::get(&key).map_err(|e| e.to_string());
}
// + set, delete, has — same shape

pub fn init<R: Runtime>() -> TauriPlugin<R> {
  Builder::new("secure-store")
    .invoke_handler(tauri::generate_handler![get, set, delete, has])
    .setup(|_app, _api| {
      #[cfg(target_os = "android")] _api.register_android_plugin("app.scratch.securestore", "SecureStorePlugin")?;
      #[cfg(target_os = "ios")]      _api.register_ios_plugin(init_plugin_secure_store)?;
      Ok(())
    })
    .build()
}
```

### 5.2 Android — `SecureStorePlugin.kt`

```kotlin
@TauriPlugin
class SecureStorePlugin(private val activity: Activity) : Plugin(activity) {
  private val prefs by lazy {
    val mk = MasterKey.Builder(activity).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
    EncryptedSharedPreferences.create(
      activity, "scratch_secure", mk,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
  }
  @Command fun get(invoke: Invoke) {
    val a = invoke.parseArgs(GetArgs::class.java)
    val v = prefs.getString(a.key, null)
    invoke.resolve(JSObject().put("value", v))
  }
  @Command fun set(invoke: Invoke) {
    val a = invoke.parseArgs(SetArgs::class.java)
    prefs.edit().putString(a.key, a.value).apply()
    invoke.resolve()
  }
  @Command fun delete(invoke: Invoke) {
    val a = invoke.parseArgs(GetArgs::class.java)
    prefs.edit().remove(a.key).apply()
    invoke.resolve()
  }
  @Command fun has(invoke: Invoke) {
    val a = invoke.parseArgs(GetArgs::class.java)
    invoke.resolve(JSObject().put("value", prefs.contains(a.key)))
  }
}

@InvokeArg class GetArgs { lateinit var key: String }
@InvokeArg class SetArgs { lateinit var key: String; lateinit var value: String }
```

`build.gradle.kts` adds `androidx.security:security-crypto:1.1.0-alpha06` (or current stable).

### 5.3 iOS — `SecureStorePlugin.swift`

Keychain via `Security.framework` `SecItemAdd`/`SecItemCopyMatching`/`SecItemDelete` keyed by `kSecAttrAccount = key`, `kSecAttrService = "ai.scratch.app.secure-store"`, `kSecAttrAccessible = kSecAttrAccessibleAfterFirstUnlock`. **Stub-OK in 3a** — must compile in simulator; real-device verification deferred to 3a-ios-finish.

### 5.4 Desktop — `desktop.rs`

Wraps `keyring::Entry::new("ai.scratch.app", &key)` with `set_password / get_password / delete_password`. Same JS API surface.

### 5.5 JS API (`packages/ui/src/secure-store.ts`)

```ts
import { invoke } from '@tauri-apps/api/core'
export const secureStore = {
  get:    (key: string)               => invoke<string | null>('plugin:secure-store|get',    { key }),
  set:    (key: string, value: string) => invoke<void>('plugin:secure-store|set',            { key, value }),
  delete: (key: string)               => invoke<void>('plugin:secure-store|delete',          { key }),
  has:    (key: string)               => invoke<boolean>('plugin:secure-store|has',           { key }),
}
```

**Keys stored in 3a:** `refresh`, `device_id`. (`device_id` survives signout to keep `(user_id, device_id)` continuity in `device_sessions`.)

---

## 6. Deep-link plumbing

**Plugin:** `tauri-plugin-deep-link@2` (official).

**Runtime path:** custom scheme `1scratch://auth/done`. Works on day one with no web infra.

**Forward-compatible:** Android App Links wired in `tauri.conf.json` (`host: app.1scratch.ai`, `pathPrefix: /m`); `assetlinks.json` hosting + `autoVerify="true"` deferred to 3c when release signing keystore exists (need its SHA-256 fingerprint).

**`packages/ui/src/auth/deep-link.ts`:**

```ts
import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link'

export async function getColdStartUrl(): Promise<URL | null> {
  const urls = await getCurrent()  // returns the URL the app was launched with, if any
  for (const raw of urls ?? []) {
    const u = new URL(raw)
    if (u.protocol === '1scratch:' && u.pathname === '/auth/done') return u
  }
  return null
}

export function listenForAuthCallback(handler: (url: URL) => void): () => void {
  return onOpenUrl((urls) => {
    for (const raw of urls) {
      const u = new URL(raw)
      if (u.protocol === '1scratch:' && u.pathname === '/auth/done') handler(u)
    }
  })
}
```

**Cold-start race:** `signIn()` checks `getColdStartUrl()` *before* opening the system browser, so a fast browser-handoff that fires before `onOpenUrl` registers isn't lost.

**Verifying generated manifests after `tauri android init`:**

`gen/android/app/src/main/AndroidManifest.xml` should contain:

```xml
<intent-filter android:autoVerify="false">
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="1scratch" android:host="auth"/>
</intent-filter>
```

`gen/apple/scratch_iOS/Info.plist` should contain `CFBundleURLSchemes = ["1scratch"]`. Universal-Links `Associated Domains` entitlement deferred until Apple cert available.

---

## 7. Testing strategy

### 7.1 Unit (Vitest, runs in CI Linux)

- `apps/web/tests/integration/mobile-auth.test.ts` (~6 cases):
  - `/api/mobile/exchange` issues HS256 + refresh; row inserted with hashed refresh.
  - `/api/mobile/refresh` rotates row and revokes old in single tx; old refresh fails on re-use.
  - Expired access fails verification on `/api/sync/push`.
  - Revoked refresh → 401.
  - Cross-tenant: device_session for user A is invisible to user B (RLS).
  - Access JWT signed with wrong key → 401.

- `packages/ui/src/auth/session.test.ts` (~4 cases): mocked `secureStore` + `fetch`; `loadSession()` calls refresh on stale, persists rotated refresh, returns null on missing, returns null + clears store on 401.

- `packages/tauri-plugin-secure-store/` Rust tests cover arg parsing + dispatch; Kotlin/Swift unit tests skipped (verified through device pass).

All integration tests gate on `DATABASE_URL_ADMIN` (existing convention). CI without DB stays green.

### 7.2 Manual device pass — **3a Definition of Done**

1. `pnpm android:dev` on a physical Pixel-class device (or Pixel emulator API 34 — note that StrongBox path is device-only).
2. App launches → "Sign in" button → system browser opens `https://app.1scratch.ai/sign-in?return=1scratch://auth/done`.
3. Sign in via Google in the browser. Browser hits `/mobile/handoff`, posts to `/api/mobile/exchange`, then redirects to `1scratch://auth/done?refresh=…&access=…&exp=…`. App receives the deep-link.
4. Refresh + access are stored in `EncryptedSharedPreferences` (verify via `adb shell run-as ai.scratch.app cat shared_prefs/scratch_secure.xml` → only ciphertext visible).
5. Workbench renders. Type prompt → submit → response streams. Card persists locally (existing SQLite via `tauri-plugin-sql`).
6. Sync push fires within 500ms of stream end. Verify in Neon: `select * from cards where user_id = '<id>' order by updated_at desc limit 1` shows the card.
7. Force-quit app, reopen. Session is restored from secure-store via `/api/mobile/refresh`; sync pull replays card.
8. Manual "Sign out" → secure-store cleared, server `device_sessions.revoked_at` set; calling refresh with old token returns 401.

### 7.3 iOS sub-DoD (skeleton bar only)

- `pnpm ios:dev` opens Xcode simulator, app launches, Workbench renders.
- Sign-In does NOT have to round-trip (Apple Sign-In + signing deferred). Browser-handoff path can be exercised but the deep-link return into the simulator is best-effort.
- Plugin Swift code compiles. That is sufficient for 3a iOS bar.

### 7.4 CI

- Existing GitHub Actions: add `pnpm tsc -b` over `packages/ui` + `packages/tauri-plugin-secure-store`.
- Mobile build matrix (signed APK + iOS archive) deferred to 3c (needs signing keystore + Apple cert in CI secrets).

---

## 8. Explicit deferrals

| Deferred to | Item |
|---|---|
| **3a-ios-finish** (Apple Developer enrollment unblocks) | Apple Sign-In wiring in Clerk dashboard; iOS device build + TestFlight; Universal Links Associated Domains entitlement; Privacy Manifest |
| **3b** (touch UX + sync resilience) | Touch UX adaptation (long-press menus, sidebar tab gestures, Workbench gestures); foreground/connectivity sync triggers; offline-write QA matrix; `usePlatform` consumers |
| **3c** (push + distribution) | APNs + FCM push infra; Play Console Data Safety form; release signing keystore + `assetlinks.json`; Play Internal track upload; bundle-size budget; Privacy Manifest (iOS) |
| **Phase 4** | Local on-device models (llama.cpp Rust binding); biometric unlock |

---

## 9. Risks

- **Tauri Mobile maturity.** Less battle-tested than React Native. Mitigation: official plugins (deep-link, sql, shell, os) are stable; secure-store custom plugin is the highest-novelty surface, and its blast radius is single-key storage (refresh token loss = re-sign-in, not data loss).
- **Tauri 2 mobile-plugin macro API churn.** Pin Tauri to current minor; lock the version in the implementation plan; do not bump mid-phase.
- **iOS `tauri ios init` requires macOS.** Linux dev workflow accepts that `gen/apple` may land in a follow-up commit from a macOS run; spec does not block on it.
- **Browser handoff `return` cookie persistence.** The cookie set by `/sign-in?return=…` must survive Clerk's redirect chain back to `/mobile/handoff`. If Clerk strips Set-Cookie on its hosted UI hop, fall back to encoding `return` in Clerk's `redirect_url` query param.
- **Cold-start deep-link race.** Mitigated by checking `getCurrent()` in `signIn()` before browser open. If `tauri-plugin-deep-link` doesn't actually populate `getCurrent()` on Android cold-launch (untested at spec time), implementation must verify with a real device round-trip and fall back to a one-shot promise resolved by `onOpenUrl` *before* the browser intent fires — but only if Android queues the launch URL until a listener exists, which it does for `BROWSABLE` intents.
- **EncryptedSharedPreferences StrongBox availability.** Pixel devices use StrongBox; emulators and older devices fall back to TEE. `MasterKey.Builder` already handles fallback transparently. No spec impact.

---

## 10. Out of scope (this spec only)

This spec covers Phase 3a Mobile Foundation. The following are explicitly NOT addressed:

- Touch-friendly UX (sidebar gestures, long-press, hit-target sizing) — 3b.
- Foreground-resume sync triggers, connectivity listener — 3b.
- Push notifications (APNs/FCM) — 3c.
- Play Console Data Safety form, Privacy Manifest, store metadata — 3c.
- Beta cohort distribution (TestFlight, Play Internal upload) — 3c.
- App Store review submission — 3c.
- Biometric unlock — Phase 4.
- llama.cpp on-device models — Phase 4.
