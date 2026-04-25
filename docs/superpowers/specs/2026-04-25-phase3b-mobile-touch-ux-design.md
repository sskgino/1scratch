# Phase 3b — Mobile Touch UX + Design Framework (design spec)

**Date:** 2026-04-25
**Scope:** PLAN.md §10 Phase 3 — *touch UX slice*: mobile shell, Quick Capture composer (text + voice + camera + clipboard suggest), Library surface, You account/devices/sync surface, Canvas with Stack (default) and Spatial (touch-adapted) view modes, FTS5 offline search, offline/sync UX (banner + per-card pip + pull-to-refresh + persistent outbox).
**Out of scope (separate specs):** push notifications + store distribution + iOS device UX (3c), Vercel Blob image-byte upload + interactive conflict resolution + biometric unlock + on-device llama.cpp (Phase 4).
**Builds on:** 3a Mobile Foundation (`packages/ui` extracted, secure-store + device sessions + deep-link auth working on Android).

---

## 1. Locked decisions

| # | Decision | Notes |
|---|---|---|
| 1 | Spec scope | Phase 3b touch UX only; render-layer-only seam, zero existing-store fork |
| 2 | Viewport seam | `width < 600` → MobileShell; render-toggle via `hidden` on sibling shells under one provider tree; preserves canvas state across resize |
| 3 | Surfaces | 4 bottom-tab nav: Capture (default) / Canvas / Library / You |
| 4 | Canvas modes | per-tab `viewMode: 'stack' \| 'spatial'`; mobile default stack; desktop default spatial; user-toggleable in CanvasHeader |
| 5 | Drag/resize | replace `react-rnd` with in-house `PointerDraggable` + `PointerResizable` Pointer Events shim; desktop + mobile share one path |
| 6 | Voice | Web Speech API primary; `MediaRecorder` (webm/opus) → POST `/api/ai` with `transcribe: true` → OpenAI Whisper fallback when Web Speech absent or denied |
| 7 | Voice fallback cap | hard 60s auto-stop; countdown shown after 50s |
| 8 | Voice billing | counts against `daily_ai_cap_cents` like other AI calls; 402 surfaces "Daily AI cap reached" toast |
| 9 | Camera | Android `Intent.ACTION_IMAGE_CAPTURE` via Kotlin plugin; iOS stub error in 3b; pipeline strips EXIF, downscales full to 2048px long-edge + 320px thumb |
| 10 | Image cross-device sync | wire patches carry kind/dimensions/originDeviceId only; bytes local-only; second-device renders `🖼 Image · captured on <device>` placeholder until Phase 4 Blob lands |
| 11 | Clipboard suggest | foreground-only read via `tauri-plugin-clipboard-manager`; per-session de-dup; `settings.clipboardSuggestEnabled` toggle, default **on** |
| 12 | Search | SQLite FTS5 virtual table with `unicode61 remove_diacritics 2` tokenizer; triggers off `cards` table; populated by sync-engine writes via store actions |
| 13 | Sync pip | `synced` / `pending` / `conflict` visible per card; conflict tap = info popover only; interactive resolution deferred to Phase 4 |
| 14 | Outbox persistence | `persistOnEveryMutation: true` on mobile builds; desktop default unchanged (batched on exit). Reuses existing `outbox` table from `apps/client/src/sync/schema.sql` — no new migration |
| 15 | Card kinds | 3b introduces tagged-union `Card = PromptCard \| ImageCard`. PromptCard = existing shape (prompt/response/model/status). ImageCard = new (`kind: 'image'`, fullPath, thumbPath, width, height, capturedAt, originDeviceId). `Card.kind: 'prompt'` defaulted on migration of existing rows |
| 16 | Native commands | Rust: `mobile_camera`, `mobile_haptic`, `mobile_status_bar`, `mobile_network`; iOS stubs OK in 3b |
| 17 | Definition of Done | Real Pixel-class Android device runbook; iOS Simulator build-only |

---

## 2. Architecture

### 2.1 Render seam

`apps/client/src/App.tsx`:

```tsx
const { isMobile } = useViewport()
return (
  <Providers>
    <div hidden={isMobile}><DesktopShell /></div>
    <div hidden={!isMobile}><MobileShell /></div>
  </Providers>
)
```

Both shells mount as siblings. `hidden` toggle (not unmount) preserves Zustand store subscriptions, sync-engine listeners, and DOM-resident canvas state across resize. Same React tree, same providers, same stores.

### 2.2 packages/ui layout addition

```
packages/ui/src/
  components/
    Canvas/                       (existing — used by SpatialView)
    cards/                        (existing — CardShell switches to PointerDraggable)
    layout/                       (existing — desktop sidebar)
    ui/                           (existing primitives)
    SyncDiagnostics.tsx           (existing — reused by YouSurface in BottomSheet)
    mobile/                       NEW
      MobileShell.tsx
      BottomTabBar.tsx
      shared/
        SafeArea.tsx
        BottomSheet.tsx
        SwipeActions.tsx
        PullToRefresh.tsx
        SyncBanner.tsx
        PointerDraggable.tsx
        PointerResizable.tsx
        TabSwitcherSheet.tsx
      capture/
        QuickCapture.tsx
        Composer.tsx
        VoiceDictation.tsx
        RecentStack.tsx
        ClipboardSuggestChip.tsx
        CameraSheet.tsx
      canvas/
        MobileCanvas.tsx
        StackView.tsx
        SpatialView.tsx
        CanvasHeader.tsx
      library/
        Library.tsx
        ContinueRail.tsx
        SectionTree.tsx
        RecentCards.tsx
        SearchSheet.tsx
      you/
        YouSurface.tsx
        DeviceList.tsx
        SettingsRow.tsx
      auth/
        MobileSignIn.tsx
  hooks/                          NEW
    useViewport.ts
    useNetwork.ts
    useHaptics.ts
    useShareIntent.ts
  lib/                            existing dir, additions
    voice.ts
    clipboard-suggest.ts
    image-pipeline.ts
    fts.ts
  store/
    mobileNav.ts                  NEW
    cards.ts                      modified — image-card thumb fields, FTS hooks
    canvas.ts                     modified — per-tab viewMode
    workspace.ts                  modified — lastTouchedAt per tab
    settings.ts                   modified — reduceMotion, hapticsEnabled, spatialOnMobile, clipboardSuggestEnabled
```

### 2.3 Native additions

```
apps/client/src-tauri/
  src/
    commands/
      mobile_camera.rs            NEW
      mobile_haptic.rs            NEW
      mobile_status_bar.rs        NEW
      mobile_network.rs           NEW
    lib.rs                        modified — register new commands
  Cargo.toml                      modified — image crate (future-proof, see §7.6)
  capabilities/mobile.json        modified — camera, haptic, status-bar, network perms
  gen/android/.../
    MobileCameraPlugin.kt         NEW
    MobileHapticPlugin.kt         NEW
    AndroidManifest.xml           modified — camera permission, intent queries
apps/client/src/sync/
  schema.sql                      modified — append FTS5 virtual table + triggers (§6.1)
```

### 2.4 Store reuse rule

Every existing store is touched only via additive fields. No new write paths bypass existing actions. Sync engine + FTS hook into the same store mutations the desktop UI already triggers. Audit before PR 4: `grep` for direct `db.execute('INSERT INTO cards'…)` outside `store/` — must be empty.

### 2.5 Schema additions

**Wire (sync-proto):** `Mutation.patch: Record<string, unknown>` already accepts new fields. Image-card additions (`kind: 'image'`, `thumbPath?`, `width?`, `height?`, `originDeviceId?`) and the `kind` discriminator on existing prompt cards (defaults to `'prompt'`) are purely additive; older clients ignore unknown keys. No protocol version bump.

**Local SQLite** (`apps/client/src/sync/schema.sql`):
- Existing `cards.payload` (TEXT JSON) absorbs the new `kind` field and ImageCard fields without column changes.
- Existing `outbox` table reused (already has `id, entity_type, entity_id, op, patch, client_version, created_at, retry_count, last_error`); only the sync-engine config flag changes (§7.1) — no migration.

**New migration `0002_fts.sql`** — FTS5 virtual table + triggers (§6.1). Applied via `tauri-plugin-sql` migration runner on first open after upgrade.

---

## 3. Surfaces

### 3.1 Bottom-tab nav

4 tabs, 56pt + safe-area-bottom. Active indicator. Hides on scroll-down via IntersectionObserver sentinel; reappears on scroll-up. Light haptic on tab change. `mobileNav.tab` persisted to localStorage (key `1scratch:mobileNav.tab`). Initial value: `capture` if user signed in, else `MobileSignIn` shown regardless.

### 3.2 Capture (default)

```
┌──────────────────────────────┐
│ TabName ⊞   ⚙               │  header — long-press tab name → TabSwitcherSheet; ⚙ → settings disclosure
├──────────────────────────────┤
│ ┌─ card bubble ─────┐         │
│ │ content preview   │         │  RecentStack — last 10 in current tab,
│ │ 3-line + Show more│         │  newest at bottom; SwipeActions
│ └───────────────────┘         │  left=delete (5s undo toast),
│ ┌─ card bubble ─────┐         │  long-press=context sheet
│ │ ...               │         │
├──────────────────────────────┤
│ [Smart paste suggestion]   X │  ClipboardSuggestChip slot
├──────────────────────────────┤
│ ┌──────────────────────────┐ │  Composer — multiline autogrow 1–6 lines
│ │ Type or speak…           │ │  bottom-pinned, keyboard-tracked via
│ └──────────────────────────┘ │  visualViewport offset
│ [📷] [🎙]            [→]    │
└──────────────────────────────┘
[Capture] Canvas Library You    BottomTabBar
```

Send → `addCard({ kind, content, sourcePip })` against current tab's canvas. Card lands at top of stack; in spatial mode at canvas viewport center.

`useShareIntent` → on `{ kind: 'capture' }` payload, focus composer.

### 3.3 Canvas

`CanvasHeader` — back chevron, tab name (long-press → TabSwitcherSheet), segmented `[⊞ Stack | ⊡ Spatial]` toggle.

**StackView** — vertical `CardBubble` list ordered by `zIndex desc, updatedAt desc`. CardBubble wraps the existing prompt/response card body and the new `ImageCard` body via `kind` discriminator; hides x/y/resize chrome; renders flush-width. SwipeActions left=delete (5s undo toast), right=archive (existing op). Long-press → lift (translate + shadow + light haptic) → drag-to-reorder updates `zIndex`. PullToRefresh on the scroll container.

**SpatialView** — wraps existing `<Canvas />` with touch-friendly defaults: pinch-zoom 0.5–2.5×, two-finger pan, single-finger pan on background only (no marquee select on mobile), card drag = long-press to lift via `PointerDraggable longPressMs={350}`. Resize handle visible only on selected card. PullToRefresh disabled (would conflict with pan).

Mobile gesture priority (single source of truth for SpatialView):

| pointers | input | action |
|---|---|---|
| 1 | quick tap on card | select |
| 1 | long-press 350ms on card | drag |
| 1 | pan on background | canvas pan |
| 2 | pinch | zoom + pan |
| 2 | one on card + one on background | abort drag, treat as pinch |

Background `<div>` swallows single-pointer pan; card `pointerdown` `stopPropagation` after long-press fires. PointerDraggable observes `pointermove` of secondary pointer id → cancels drag.

### 3.4 Library

```
[Library  🔍  +]
─ Continue ────────
[Tab card 88pt] [Tab card] [Tab card]   horizontal rail, top-3 by lastTouchedAt
─ Sections ────────
▾ Section 1
   Tab a
   Tab b
─ Recent cards ────
breadcrumb · preview · 2m ago
breadcrumb · preview · 12m ago
... infinite scroll
```

`ContinueRail` — top-3 tabs by `lastTouchedAt`, 88pt cards, shows tab name + section + relative timestamp + thumbnail of newest card if available. Tap → switches active tab + `mobileNav.tab='canvas'`.

`SectionTree` — mirrors desktop sidebar data. Long-press section → rename/delete sheet (reuses existing `removeSection`/`renameSection`). Long-press tab → rename/delete/move-to-section sheet.

`RecentCards` — flat list of last 30 cards across all canvases ordered by `updatedAt`, infinite-scroll older. Each row: tab/section breadcrumb + content preview + timestamp. Tap → opens that tab + selects card.

Magnifier → SearchSheet (§6.3). `+` → new tab in selected section (or default section if none selected).

### 3.5 You

```
[Avatar Name email]
─ This Device ─────
[Pixel 8 · active now]
─ Other Devices ───
[MacBook Air · 2h ago      Sign out]
[iPhone 15 · 3d ago        Sign out]
─ Sync ────────────
Last pull 2m ago · Last push 30s ago
[Diagnostics ›]
─ Settings ────────
[Color labels         ⌃]
[Spatial canvas default  ●○]
[Reduce motion           ●○]
[Smart paste suggest     ●○]
[Haptics                 ●○]
[Theme  System]
─────────────────
About · Privacy · Terms · Sign out
```

`DeviceList` — fetches `/api/mobile/sessions` (existing 3a route), renders rows: device label, "active now" / relative timestamp, "Sign out" → `POST /api/mobile/revoke` with that session id. Current device row labeled "This device" (matched by local `device_id`).

`SettingsRow` — small primitive: label + control (toggle/select/disclosure). Composes existing `useSettingsStore`.

`SyncDiagnostics` — existing desktop component, opened in BottomSheet from "Diagnostics" disclosure.

About/Privacy/Terms — links open in system browser via `tauri-plugin-shell`.

---

## 4. Pointer Events shim

### 4.1 Why

`react-rnd` is mouse-only. Wrapping it for touch produced jank + double event paths. One shim, both inputs, less code than two paths. Touch-capable card interactions land on desktop *and* mobile in one swap.

### 4.2 `PointerDraggable`

```ts
interface PointerDraggableProps {
  position: { x: number; y: number }
  onPositionChange: (p: { x: number; y: number }) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  disabled?: boolean
  handle?: string                  // CSS selector; if set, only matching descendants start drag
  longPressMs?: number             // 0 (default) = instant; >0 = lift-to-drag pattern
  children: React.ReactNode
}
```

Implementation:
- `pointerdown` on handle → `setPointerCapture(pointerId)`, latch initial `(clientX, clientY)`.
- `longPressMs > 0`: arm timer; `pointermove` exceeding 8pt before timer cancels = pan, abort drag; timer fires = `onDragStart` + start tracking.
- `pointermove`: compute delta, call `onPositionChange`.
- `pointerup` / `pointercancel` / `lostpointercapture`: `onDragEnd`, clear state.
- `touch-action: none` on handle element via inline style.
- Multi-pointer: ignore secondary pointer ids while one is captured; cancel drag on secondary `pointerdown` to defer to pinch handler upstream.

### 4.3 `PointerResizable`

```ts
interface PointerResizableProps {
  size: { width: number; height: number }
  onSizeChange: (s: { width: number; height: number }) => void
  onResizeStart?: () => void
  onResizeEnd?: () => void
  minWidth?: number      // default 80
  minHeight?: number     // default 60
  selected: boolean
  children: React.ReactNode
}
```

Wraps child, exposes single 24×24 bottom-right handle visible only when `selected`. Same PointerEvents pattern. Aspect-ratio constraint omitted in 3b (image cards resize freely).

### 4.4 CardShell rewrite

```tsx
// before
<Rnd position={{ x, y }} size={{ width, height }} onDragStop={...} onResizeStop={...} dragHandleClassName="drag-tab">
  {children}
</Rnd>

// after
<PointerDraggable position={{ x, y }} onPositionChange={updatePos} handle=".drag-tab">
  <PointerResizable size={{ width, height }} onSizeChange={updateSize} selected={selectedId === id}>
    {children}
  </PointerResizable>
</PointerDraggable>
```

Public consumer API (`updateCard`, `bringToFront`) unchanged. `selectedCardId` added to `cards` store if not present (single-select; multi-select not in 3b).

### 4.5 Removal

`react-rnd` dropped from `packages/ui/package.json` after swap. `grep -r react-rnd packages apps` must return empty before PR 2 merge.

---

## 5. Voice + camera + clipboard

### 5.1 `voice.ts`

```ts
interface VoiceHandle { stop(): Promise<{ finalText: string }>; abort(): void }
interface StartOpts {
  onPartial?: (text: string) => void
  onFinal?:   (text: string) => void
  onError?:   (err: VoiceError) => void
}
type VoiceError =
  | { kind: 'permission_denied' }
  | { kind: 'no_speech' }
  | { kind: 'network' }
  | { kind: 'transcribe_failed'; status: number }
  | { kind: 'cap_exceeded' }            // server returned 402
  | { kind: 'unsupported' }

export async function startDictation(opts: StartOpts): Promise<VoiceHandle>
```

Provider selection:
1. Try `window.SpeechRecognition || webkitSpeechRecognition`.
2. If absent OR `error: 'not-allowed'` after permission attempt → fallback path.

**Web Speech path:** stream `result.isFinal` partials to `onPartial`/`onFinal`. `stop()` resolves with current cumulative final text.

**Fallback path (MediaRecorder → Whisper):**
- `getUserMedia({ audio: true })`. On denial → `onError({ kind: 'permission_denied' })`.
- `MediaRecorder({ mimeType: 'audio/webm;codecs=opus' })`, 250ms timeslice.
- Hard 60s cap: arm `setTimeout`, auto-`stop()`. UI countdown after 50s.
- `stop()`: blob → `FormData` with field `audio` → POST `${apiBase}/api/ai` with `transcribe: true` form field. Body: `{ finalText: string }`.
- On `402` (cap exceeded) → `onError({ kind: 'cap_exceeded' })` + composer surfaces "Daily AI cap reached" toast.

### 5.2 Whisper route addition

`apps/web/src/app/api/ai/route.ts` — accept `multipart/form-data` when Content-Type matches; if form has `transcribe=true` and `audio` blob:

1. Existing auth resolver (mobile bearer or Clerk session).
2. Existing `/api/cap` check; reject with 402 if exhausted.
3. AI Gateway `audio.transcriptions` → OpenAI `whisper-1` (model id pinned).
4. Account against cap: convert duration to cents at $0.006/min, round up.
5. Audit `ai_transcribe`.
6. Return `{ text }`.

Test: 4 cases — multipart parse + Whisper round-trip (mocked), cap exhausted → 402, mobile bearer auth, Clerk session auth.

### 5.3 `VoiceDictation` component

States: `idle` / `listening` / `committing`.

- Tap mic → `idle → listening`. Tap again → `listening → committing`.
- Long-press → push-to-talk; release → auto-stop + send.
- While listening: pulse animation 1.4s loop on mic; clamped to opacity-only when `reduceMotion`.
- Partial transcript streamed into Composer textarea via callback prop. Final replaces partial on commit.
- 50s warning: countdown badge appears next to mic.
- Errors surfaced as inline toast: `permission_denied` → "Allow microphone in system settings"; `cap_exceeded` → "Daily AI cap reached"; others → "Voice unavailable, type instead".

### 5.4 Camera

**Rust command** `mobile_camera`:
- Android: launch `Intent.ACTION_IMAGE_CAPTURE` via Kotlin plugin, capture file via `MediaStore`, return absolute file path of captured JPEG.
- iOS: returns `Err("not_implemented")` in 3b.
- Desktop: returns `Err("unsupported")`.

`AndroidManifest.xml` adds:
```xml
<uses-permission android:name="android.permission.CAMERA"/>
<queries>
  <intent>
    <action android:name="android.media.action.IMAGE_CAPTURE"/>
  </intent>
</queries>
```

Capability `mobile.json` grants `mobile-camera:default`.

### 5.5 `image-pipeline.ts`

```ts
export async function processCapturedImage(path: string): Promise<{
  fullPath: string
  thumbPath: string
  width: number
  height: number
}>
```

1. Read file via Tauri `fs.readFile` → `Uint8Array`.
2. Decode → `ImageBitmap` (native canvas decoder strips EXIF orientation as part of decode + re-encode).
3. Compute target: full max 2048px on long edge; thumb max 320px.
4. `OffscreenCanvas` → `convertToBlob({ type: 'image/jpeg', quality: 0.85 })` (full) and `0.8` (thumb).
5. Write both back via Tauri `fs.writeFile` to `${appDataDir}/images/`. Filenames: `${cardId}.jpg` and `${cardId}.thumb.jpg`.
6. Original temp file unlinked.

Test fixtures: landscape 4032×3024, portrait 3024×4032, oversize 8000×6000, EXIF rotated 90°, empty file (rejected).

### 5.6 `CameraSheet`

BottomSheet workflow:
- Open → invoke `mobile_camera` → loading state.
- On success → run `image-pipeline` → stage image-card draft above composer with thumbnail preview + `[Send]` `[Add note]` buttons.
- Cancel → unlink full + thumb files.
- Send → `addCard({ kind: 'image', fullPath, thumbPath, width, height, capturedAt: Date.now() })`.

### 5.7 Clipboard suggest

`clipboard-suggest.ts` — `evaluateClipboard(): SuggestionDescriptor | null`:
- Check `settings.clipboardSuggestEnabled`. If false → null.
- Read clipboard via `tauri-plugin-clipboard-manager` `readText()`.
- Reject if empty, ≤20 chars (unless URL-shaped via `URL` constructor probe), or hash already in `sessionStorage["1scratch:clipboardSeen"]`.
- Return `{ kind: 'url' | 'text', preview: string, hash: string }`.

Trigger: `document.visibilitychange` (web) + Tauri `app:focus` event (native). Never proactive read.

`ClipboardSuggestChip` — renders preview; tap → insert into composer + dismiss; X → dismiss + add hash to seen set. Settings toggle in You → Settings flips `clipboardSuggestEnabled`.

### 5.8 `MobileSignIn`

Placeholder when `loadSession()` returned null. Logo + tagline + single `Continue with browser` button → invokes existing 3a `signIn()`. Loading state during deep-link return; error surfaced inline: "Sign-in interrupted, try again." Reuses 3a session module unchanged.

---

## 6. Search (FTS5) + image card cross-device

### 6.1 SQLite schema append (FTS5)

Existing schema uses `cards`, `canvases`, `sections` tables (`apps/client/src/sync/schema.sql`). Migration appends:

```sql
create virtual table cards_fts using fts5(
  card_id UNINDEXED,
  content,
  canvas_name,
  section_name,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- Indexed text per kind:
--   prompt cards → prompt + response concatenated
--   image cards  → "" (image bytes not searchable in 3b)
create trigger cards_fts_ai after insert on cards begin
  insert into cards_fts(card_id, content, canvas_name, section_name)
  values (new.id,
          coalesce(json_extract(new.payload, '$.prompt'), '') || ' ' ||
          coalesce(json_extract(new.payload, '$.response'), ''),
          (select name from canvases where id = new.canvas_id),
          (select s.name from sections s
             join canvases c on c.section_id = s.id
             where c.id = new.canvas_id));
end;

create trigger cards_fts_au after update on cards begin
  delete from cards_fts where card_id = old.id;
  insert into cards_fts(card_id, content, canvas_name, section_name)
  values (new.id,
          coalesce(json_extract(new.payload, '$.prompt'), '') || ' ' ||
          coalesce(json_extract(new.payload, '$.response'), ''),
          (select name from canvases where id = new.canvas_id),
          (select s.name from sections s
             join canvases c on c.section_id = s.id
             where c.id = new.canvas_id));
end;

create trigger cards_fts_ad after delete on cards begin
  delete from cards_fts where card_id = old.id;
end;
```

Tokenizer `unicode61 remove_diacritics 2` — Unicode word splitting + diacritic-insensitive matching (`cafe` → `café`).

Triggers fire on the `cards` table directly. Sync engine writes go through `cards.ts` store actions which call SQLite mutations — triggers catch all paths. Audit before PR 4 merge: every sync-engine write must flow through `cards.ts` (no raw SQL bypass).

When canvas or section is renamed, the trigger does not refresh stale `canvas_name` / `section_name` snapshots in the FTS rows. 3b accepts this drift — search by canvas/section name shows yesterday's name briefly. PR 4 adds a one-shot "rebuild FTS" call on app cold-start to amortize the staleness.

### 6.2 `fts.ts`

```ts
interface CardHit {
  cardId: string
  canvasId: string
  canvasName: string
  sectionName: string | null
  snippet: string         // FTS5 snippet() output, ~64 chars around match
  rank: number            // FTS5 bm25
}

export async function searchCards(
  query: string,
  opts?: { sectionId?: string; limit?: number }
): Promise<CardHit[]>
```

Query rewrite: split on whitespace, append `*` for prefix to non-empty tokens, AND-join. `foo bar` → `foo* bar*`. FTS5-special chars (`"`, `(`, `)`, `:`) stripped. Empty → `[]`.

```sql
select c.id, c.canvas_id, cv.name, s.name,
       snippet(cards_fts, 1, '«', '»', '…', 32) as snippet,
       bm25(cards_fts) as rank
from cards_fts
join cards c on c.id = cards_fts.card_id
join canvases cv on cv.id = c.canvas_id
left join sections s on s.id = cv.section_id
where cards_fts match ?
  and ($sectionId is null or cv.section_id = $sectionId)
order by rank
limit ?;
```

### 6.3 `SearchSheet`

Full-height BottomSheet (snap=1.0) from Library magnifier. Debounced 150ms input. Results grouped by section. Empty input → "Search across canvases" placeholder + last 5 hits from session history. Offline → works against FTS index unchanged (no banner, no special UI). Tap result → switches active tab + selects card, dismisses sheet.

### 6.4 Image card cross-device

**Locally** (origin device):
- `cards.payload` for image cards: `{ kind: 'image', fullPath, thumbPath, width, height, capturedAt, originDeviceId }`.
- File paths reference Tauri app-data dir; persist across app restarts.

**Sync wire** (via `Mutation.patch`):
- `fullPath` and `thumbPath` **stripped** before push (paths meaningless cross-device).
- `kind`, `width`, `height`, `capturedAt`, `originDeviceId` synced.

**Second-device render** (`payload.fullPath` and `thumbPath` both undefined after pull):
- `ImageCard` component shows placeholder: `🖼 Image · captured on <device label> · <relative time>`.
- Device label resolved from `device_sessions` API by `originDeviceId`; fallback "another device" if unresolved.
- No retry, no fetch — Phase 4 introduces Vercel Blob upload + signed URLs to fill this gap.

**Origin device deletion:**
- Delete card → mutation propagates → second-device row removed (standard sync behavior).
- Local files unlinked on delete.

**Sign-out + sign-in edge case:**
- `signOut()` keeps SQLite intact (existing 3a behavior). Image files survive. On sign-in, same user's image cards re-render normally on origin device.

---

## 7. Sync resilience + native commands

### 7.1 Persistent outbox

The `outbox` table already exists in `apps/client/src/sync/schema.sql` (`id`, `entity_type`, `entity_id`, `op`, `patch`, `client_version`, `created_at`, `retry_count`, `last_error`). 3b reuses it — no migration.

Add `OutboundQueueConfig.persistOnEveryMutation: boolean` to `sync-engine`. Mobile entrypoint sets `true`; desktop default `false` (existing batched-on-exit behavior preserved).

When `true`:
- Every `enqueue(mutation)` writes the row within the same SQLite transaction as the local card mutation.
- Every successful push response acks → row deleted in same tx.
- Crash recovery: on cold start, `loadOutbox()` reads pending rows ordered by `created_at`, replays through the normal push pipeline. `retry_count` increments on each failed attempt; rows with `retry_count >= 5` surface in SyncDiagnostics for manual inspection (no auto-discard in 3b — diagnostic surface only).

### 7.2 Network-change kick

`useNetwork` hook subscribes to `network-change` Tauri event. Sync engine subscribes to same event independently: on `offline → online` transition, schedule sync cycle within 500ms (debounced — multiple flips within 500ms collapse to one cycle).

Test: mock event source, fire `offline` then `online` 100ms apart, assert exactly one sync cycle within 600ms window.

### 7.3 Per-card sync state

`cards.ts` exposes `syncState(cardId): 'synced' | 'pending' | 'conflict'`:
- `pending`: outbox has unacked mutation for this card.
- `conflict`: server returned `RejectedMutation { reason: 'stale' }` for a recent push (last 60s) on this card.
- `synced`: otherwise.

Render in CardBubble (Stack) and existing card chrome (Spatial) as 8pt amber/red pip in upper-right when not `synced`. Conflict tap → small popover: "This card was updated on another device — your changes were not applied. Reach out to support if data looks wrong." (No interactive resolution per Q1 decision; deferred to Phase 4.)

### 7.4 Tab-badge dot

`BottomTabBar` checks outbox length. Capture + Canvas tabs show 6pt amber dot when `outbox.length > 0`. Updates on outbox mutation events.

### 7.5 SyncBanner states

| state | trigger | text |
|---|---|---|
| hidden | online + outbox empty | — |
| offline-saved | `useNetwork().online === false` | "Offline — your changes are saved locally" |
| reconnecting | offline→online transition, ≤2s window | "Reconnecting…" |
| sync-failed | sync cycle errored ≥2 consecutive | "Sync paused — will retry. Tap for details." (tap → SyncDiagnostics sheet) |

220ms slide-in/out under header. Dismiss via swipe on `offline-saved` (returns next time offline).

### 7.6 Native Rust commands

**`mobile_haptic.rs`** — `light()`, `medium()`, `success()`, `warning()`:
- Android Kotlin plugin invokes `VibratorManager` w/ predefined effects (`EFFECT_TICK` for light, `EFFECT_CLICK` for medium, two-pulse pattern for success/warning).
- iOS: stub `Ok(())` (real `UIImpactFeedbackGenerator` deferred to 3c).
- Desktop: no-op.
- Capability `mobile-haptic:default` in `mobile.json`.

**`mobile_network.rs`** — emits `network-change` Tauri event:
- Android Kotlin: `ConnectivityManager.NetworkCallback` with `onAvailable` / `onLost` / `onCapabilitiesChanged` (extracts `TRANSPORT_WIFI` / `TRANSPORT_CELLULAR`).
- iOS: stub.
- Desktop: subscribes to OS network reachability via existing crate; falls back to `navigator.onLine` if Rust path unimplemented.
- Event payload: `{ online: boolean, type: 'wifi' | 'cellular' | 'unknown' | 'offline' }`.

**`mobile_status_bar.rs`** — `set(theme: 'light' | 'dark')`:
- Android Kotlin: `WindowInsetsControllerCompat.setAppearanceLightStatusBars(theme === 'light')`.
- iOS: stub.
- Desktop: no-op.
- Wired from MobileShell on `settings.theme` change.

**`mobile_camera.rs`** — covered in §5.4.

All four registered in `apps/client/src-tauri/src/lib.rs` alongside 3a plugins. Capabilities consolidated into `mobile.json`. Cargo dep `image = "0.24"` added for any future post-capture work in Rust (currently runs in JS — kept for Phase 4 readiness).

---

## 8. Hooks + foundational primitives

### 8.1 `useViewport`

```ts
interface Viewport {
  width: number; height: number
  safeAreaTop: number; safeAreaBottom: number
  safeAreaLeft: number; safeAreaRight: number
  isMobile: boolean             // width < 600
}
function useViewport(): Viewport
```

Source:
- `width`/`height` ← `window.visualViewport.width`/`.height`, fallback `window.innerWidth`/`.innerHeight`.
- Safe-area ← hidden probe `<div>` with `padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)`, read via `getComputedStyle().padding*`.
- Subscribes to `visualViewport.resize` + `window.resize` (debounced 100ms).
- SSR-safe: initial state `{ width: 0, height: 0, safeArea*: 0, isMobile: false }`; populates on mount.

### 8.2 `useNetwork`

```ts
interface NetworkState { online: boolean; type: 'wifi' | 'cellular' | 'unknown' | 'offline' }
function useNetwork(): NetworkState
```

Subscribes to Tauri `network-change` event when `__TAURI_INTERNALS__` present. Falls back to `navigator.onLine` + `online`/`offline` window events on web. Initial state from `navigator.onLine`.

### 8.3 `useHaptics`

```ts
interface Haptics {
  light(): void
  medium(): void
  success(): void
  warning(): void
}
function useHaptics(): Haptics
```

Reads `useSettingsStore({ hapticsEnabled, reduceMotion })`. If `hapticsEnabled === false || reduceMotion === true` → all methods no-op. Otherwise calls `mobile_haptic` command. Desktop: no-op.

### 8.4 `useShareIntent`

```ts
interface ShareIntent {
  pendingPayload: { kind: 'capture' } | { kind: 'share'; raw: string } | null
  consume(): void              // clears pendingPayload after handling
}
function useShareIntent(): ShareIntent
```

Listens for deep-link via `tauri-plugin-deep-link` (cold-start `getCurrent()` + runtime `onOpenUrl`). Parses URLs:
- `1scratch://capture` → `{ kind: 'capture' }`. QuickCapture focuses composer.
- `1scratch://share?text=...&url=...&title=...` → `{ kind: 'share', raw }`. Parsed but **routing deferred to 3c** — 3b only logs to console.

Reuses 3a `auth/deep-link.ts` listener wiring. Auth deep-links (`1scratch://auth/done`) handled by existing `signIn()` and not surfaced here.

### 8.5 Shared primitives

**`SafeArea`** — `{ edges?: ('top' | 'bottom' | 'left' | 'right')[] }`. Default all edges. Padding from `useViewport().safeArea*`.

**`BottomSheet`** — drag-to-dismiss, backdrop, focus trap, `inert` on background siblings. Snap points `[0, 0.5, 1]` configurable via prop. `open(): Promise<DismissReason>` API for imperative use. Close on backdrop tap or downward drag past 30% of sheet height.

**`SwipeActions`** — wraps a row, exposes `leftAction` and `rightAction` slots (icon + label + color + onTrigger). Pointer-down → translate row, threshold 64pt → reveal action; release < threshold → spring back; release ≥ threshold → fire onTrigger + auto-close.

**`PullToRefresh`** — wraps scroll container. Detects `scrollTop ≤ 0` + downward drag, shows spinner past 60pt threshold, calls `onRefresh: () => Promise<void>`, on resolve swaps to "Synced Ns ago" pill 1.5s. Light haptic on threshold cross. Disabled when parent has `viewMode === 'spatial'`.

**`SyncBanner`** — covered in §7.5.

**`TabSwitcherSheet`** — extracted shared component (header sheet for both Capture and Canvas). Lists tabs grouped by section, search input, tap → switches active tab + dismisses.

### 8.6 `mobileNav` store

```ts
interface SheetDescriptor {
  id: string
  kind: 'tab-switcher' | 'sync-diagnostics' | 'context-menu' | 'camera' | 'search' | 'settings'
  props?: Record<string, unknown>
}

interface MobileNavState {
  tab: 'capture' | 'canvas' | 'library' | 'you'
  sheetStack: SheetDescriptor[]
  setTab: (tab: MobileNavState['tab']) => void
  pushSheet: (s: SheetDescriptor) => void
  popSheet: () => void
}
```

`tab` persisted to localStorage. `sheetStack` in-memory only — back-button (Android hardware back) pops top sheet before navigating away from MobileShell.

---

## 9. Testing strategy + DoD

### 9.1 Unit (Vitest, runs in CI Linux)

| File | Cases | What |
|---|---|---|
| `hooks/useViewport.test.ts` | 4 | resize updates, safe-area parse, SSR initial, debounce |
| `hooks/useNetwork.test.ts` | 3 | Tauri event subscribe, web fallback, type mapping |
| `hooks/useHaptics.test.ts` | 3 | reduceMotion no-op, hapticsEnabled toggle, desktop no-op |
| `lib/voice.test.ts` | 6 | Web Speech success, fallback path, 60s cap auto-stop, 402 cap-exceeded surfaces, permission_denied, abort |
| `lib/clipboard-suggest.test.ts` | 4 | enabled toggle, foreground gating, session de-dup, URL detection |
| `lib/image-pipeline.test.ts` | 5 | landscape/portrait/oversize/EXIF-rotated/empty fixtures |
| `lib/fts.test.ts` | 5 | prefix rewrite, special-char strip, section filter, snippet output, empty query |
| `store/mobileNav.test.ts` | 4 | tab transitions, sheet stack push/pop, persistence, hydration |
| `components/mobile/shared/PointerDraggable.test.tsx` | 6 | drag start/move/end, release-outside, multi-pointer interrupt, longPress cancel via early move, disabled, custom handle selector |
| `components/mobile/shared/PointerResizable.test.tsx` | 4 | resize math, min constraints, selected-only handle, release-outside |
| `components/mobile/shared/BottomSheet.test.tsx` | 4 | open/close, drag dismiss, backdrop click, focus trap |
| `components/mobile/shared/SwipeActions.test.tsx` | 3 | threshold reveal, spring back, action fire |
| `components/mobile/shared/PullToRefresh.test.tsx` | 4 | threshold logic, async onRefresh, error state, success pill |
| `components/mobile/shared/SyncBanner.test.tsx` | 4 | 4 states, slide animation guard |

**Sync-engine additions:**
- `outbox.test.ts` (~5 cases): persistOnEveryMutation enqueue/ack flow, crash recovery from cold-start, retry_count increment + last_error capture, idempotent replay, desktop default unchanged.
- `network-kick.test.ts` (~2 cases): debounce within 500ms, single sync cycle on flap.

**Web route addition:**
- `apps/web/tests/integration/api-ai-transcribe.test.ts` (~4 cases): multipart parse + Whisper round-trip (mocked), cap exhausted → 402, mobile bearer auth, Clerk session auth.

All integration tests gate on existing `DATABASE_URL_ADMIN` convention. CI without DB stays green.

### 9.2 Playwright narrow-window

`apps/client/tests/e2e/mobile-shell.spec.ts` viewport 375×812:
1. Load app, assert `data-mobile-shell` present.
2. Tab nav cycles `Capture → Canvas → Library → You`.
3. Composer focus → type → Send → card appears in RecentStack.
4. Library magnifier → SearchSheet opens → type → result tapped → tab switched.
5. Resize window to 800×600 → DesktopShell visible, MobileShell hidden, no remount errors (assert no console errors, assert canvas store state preserved).

Runs in CI on every PR. Tauri WebView path NOT tested in CI — manual device runbook covers.

### 9.3 Manual Android device runbook

`docs/runbooks/phase3b-android-device-test.md`. Pixel-class device. Each step records pass/fail + notes. Attach completed checklist to PR 6 description.

1. **Cold launch + sign-in** — fresh install, deep-link auth round-trip per 3a runbook.
2. **Capture text** — type prompt, send, card appears in RecentStack + Canvas Stack.
3. **Capture voice (Web Speech)** — tap mic, speak, partial transcript visible, tap stop, send.
4. **Capture voice (fallback)** — disable Web Speech via WebView flag (or test on a device known to lack it), repeat — verify Whisper round-trip fills final text.
5. **Capture voice 60s cap** — start dictation, leave running 65s, verify auto-stop + send + countdown shown after 50s.
6. **Capture camera** — tap 📷, capture, thumbnail appears in CameraSheet, send, image card lands in stack with thumbnail.
7. **Capture clipboard** — copy URL in another app, return to 1scratch, verify suggest chip appears, tap inserts.
8. **Stack reorder** — long-press card, drag up 3 positions, release, verify zIndex order persisted across app restart.
9. **Stack swipe-actions** — swipe-left a card, verify delete + 5s undo toast; swipe-right verify archive.
10. **Spatial pinch-zoom** — toggle to spatial, two-finger pinch 2×, two-finger pan, single-finger pan on background, long-press card to drag.
11. **Library Continue rail** — switch through 3 tabs, return to Library, verify top-3 by lastTouchedAt.
12. **Library SectionTree** — long-press section, rename, verify persists.
13. **Search offline** — airplane mode, magnifier, type query, verify FTS results.
14. **You devices** — verify current device labeled, sign-out other device, verify revoke.
15. **Sign out + sign in** — sign out, verify MobileSignIn shown, sign in, verify cards reload.
16. **60s airplane + 5 cards** — airplane mode, write 5 cards, verify SyncBanner offline state + tab dot, re-enable, verify reconnecting → synced within 10s on second device.
17. **App kill mid-outbox** — write 3 cards offline, force-stop via task switcher, reopen, verify outbox replays.
18. **Theme + status bar** — toggle theme in You → Settings, verify status bar icons flip light/dark.
19. **Reduce-motion** — enable system pref, verify tab/lift/banner reduce to opacity fades.
20. **Dynamic-type 200%** — Android font-scale 2×, verify all surfaces scroll without clipping.
21. **A11y target audit** — script enumerating `getBoundingClientRect()` of interactive elements; assert ≥44×44 (mic ≥56×56).
22. **Narrow-window desktop** — `pnpm dev`, resize browser below 600pt, verify swap, canvas state preserved, no console errors.

### 9.4 iOS sub-DoD (skeleton-only)

- `pnpm ios:build` compiles in Xcode simulator.
- `MobileShell` renders.
- No UX validation (deferred to 3c per locked decision).

### 9.5 Definition of Done (gating PR 6 merge)

- All unit tests green.
- Playwright narrow-window spec green in CI.
- Manual Android runbook fully checked, attached to PR 6.
- iOS Simulator build compiles.
- `pnpm -w tsc -b` clean.
- `grep -r react-rnd packages apps` empty.
- Quick Capture round-trip on real Android — text, voice (Web Speech), camera, clipboard each create cards.
- Canvas Stack 50+ cards scrolls smoothly; reorder via long-press; swipe-actions undo within 5s.
- Spatial pinch-zoom + two-finger pan match desktop trackpad gestures.
- Library Continue rail surfaces last 3 canvases; recent cards paginate.
- You device list pulls from server; per-row sign-out revokes correctly.
- Offline 60s + 5 cards flushes + reconciles on second device within 10s.
- Keyboard never occludes composer; voice dictation streams while keyboard dismissed.
- Narrow-window desktop ≤ 600pt swaps with no remount errors and preserves canvas state.
- A11y targets ≥ 44×44 (mic ≥ 56×56), AA contrast, dynamic-type 200% works.

---

## 10. Risks + deferrals

### 10.1 Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | `react-rnd` removal regresses desktop card behavior | PR 2 reruns full existing cards test suite; visual regression on desktop drag/resize/multi-card before merge; rollback path = revert single PR (atomic) |
| 2 | Web Speech unreliable on Android Chrome WebView | Whisper fallback is load-bearing, not optional; runbook step 4 validates explicitly; `voice.ts` provider selection covered in tests |
| 3 | FTS5 trigger sync ordering | Audit before PR 4 merge: every `sync-engine` write path must flow through `cards.ts` actions; trigger fires on raw SQLite mutation regardless of caller, so risk reduces to "is there a write that bypasses the store entirely?" — grep for direct `db.execute` outside `store/` |
| 4 | Outbox per-mutation persistence cost on low-end Android | Benchmark before merging PR 6: 200-card outbox enqueue/ack on a Pixel 4a-class device, measure write latency p95; lock `persistOnEveryMutation: true` only if p95 < 20ms |
| 5 | iOS without device validation | UX bugs surface in 3c; called out in 3c spec opening; iOS Simulator build is the only 3b iOS guarantee |
| 6 | Pointer Events shim multi-pointer edge cases on Android Chrome WebView | Real-device runbook step 10 (pinch + drag) is non-negotiable; if pinch-during-drag doesn't cleanly cancel, ship Spatial mode behind a feature flag and default Stack on mobile until 3c |
| 7 | Whisper cap accounting drift | Whisper bills per second; conversion to cents must round up; reconciliation cron in Phase 4 cap audit catches drift; risk capped because Whisper rates trivial vs LLM rates |
| 8 | Image card placeholder confusion on second device | Placeholder text explicit ("captured on \<device\>") + Phase 4 timeline visible in You → About; if user pushback strong, fall back to base64-thumb option mid-3b without spec rewrite |
| 9 | `visualViewport` keyboard tracking inconsistent across Android keyboards | Runbook steps 2 + 3 cover Gboard; SwiftKey + Samsung Keyboard test added if a tester reports drift; no spec change needed |
| 10 | Cold-start deep-link race when share-intent fires before listener | 3a `getColdStartUrl()` pattern reused; `useShareIntent` checks `getCurrent()` synchronously on mount before subscribing |

### 10.2 Explicit deferrals

| Deferred to | Item |
|---|---|
| **3c** | `1scratch://share?…` payload routing (parsed in 3b, routed in 3c); push notifications (APNs + FCM); release signing keystore + `assetlinks.json`; Play Console Data Safety form; iOS device UX validation; Apple Sign-In wiring; Privacy Manifest |
| **Phase 4** | Vercel Blob upload for image bytes (cross-device image rendering depends on this); conflict resolution interactive UX (3b ships visual indicator only); biometric unlock; on-device llama.cpp models; Yjs CRDT for prompt/response cards |
| **3a-ios-finish** (Apple enrollment unblocks) | iOS device round-trip; iOS Keychain real verification; Universal Links Associated Domains entitlement |

### 10.3 Out of scope (this spec)

- Desktop UX changes beyond `CardShell` swap to PointerDraggable.
- Web canvas port.
- Local-only image attachment editor (crop, annotate) — capture-and-send only in 3b.
- Multi-canvas selection / bulk operations.
- Background sync via Android `WorkManager` / iOS `BGAppRefresh` — kicked only on `network-change` + foreground in 3b.

### 10.4 Cross-references

- 3a spec: `docs/superpowers/specs/2026-04-19-phase3a-mobile-foundation-design.md`
- 3a plan: `docs/superpowers/plans/2026-04-19-phase3a-mobile-foundation.md`
- 3b plan: `docs/superpowers/plans/phase3b_design_ux.md`
- Sync v1 spec: `docs/superpowers/specs/2026-04-18-sync-v1-design.md`
- PLAN.md §10 Phase 3
