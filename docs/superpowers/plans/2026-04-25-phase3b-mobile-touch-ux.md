# Phase 3b Mobile Touch UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land touch-native mobile shell on top of the 3a foundation — Quick Capture (text/voice/camera/clipboard), Library, You, Stack/Spatial canvas, FTS5 offline search, and offline/sync UX. Mobile shell engages below 600pt viewport on any platform; reuses existing stores unchanged.

**Architecture:** Render-layer-only seam in `apps/client/src/App.tsx` (sibling shells under one provider tree, `hidden` toggle). New code under `packages/ui/src/components/mobile/` plus four hooks and one new store. `react-rnd` replaced by an in-house Pointer Events shim. Voice = Web Speech with `MediaRecorder` → Whisper fallback. Image cards introduce a tagged-union card type — bytes stay local until Phase 4 Vercel Blob ships. FTS5 virtual table populated by triggers on the existing `cards` table. Outbox already exists in `apps/client/src/sync/schema.sql`; 3b only adds a per-mutation persistence config flag.

**Tech Stack:** React 19, Zustand 5, Tauri 2 mobile, `tauri-plugin-sql` SQLite + FTS5, Web Speech API, OpenAI Whisper through `/api/ai`, Rust commands for camera + haptics + status-bar + network, Vitest + jsdom + `@testing-library/react`, Playwright (narrow-window desktop only).

**Spec:** `docs/superpowers/specs/2026-04-25-phase3b-mobile-touch-ux-design.md`
**Builds on:** `docs/superpowers/plans/2026-04-19-phase3a-mobile-foundation.md` (assumes shipped)

---

## Pre-flight

Run from `/home/gino/programming/dev/scratch`:

```bash
git checkout main
git pull --ff-only
pnpm install
pnpm -w tsc -b           # must be clean
pnpm -w test             # must be clean
git checkout -b phase3b-mobile-touch-ux
```

If anything fails, stop and fix on `main` first. Do not start PR work on a dirty baseline.

---

## PR Plan (six PRs, one feature branch)

| PR | Theme | Sections |
|---|---|---|
| 1 | Foundations: viewport seam + MobileShell + tab nav + shared primitives + hooks + Rust haptic/network/status-bar | §1 |
| 2 | Pointer Events shim, replace react-rnd | §2 |
| 3 | Quick Capture: composer + voice + camera + clipboard + ImageCard kind + MobileSignIn | §3 |
| 4 | Library + You + FTS5 search | §4 |
| 5 | Canvas Stack + Spatial + MobileCanvas | §5 |
| 6 | Sync resilience + polish + Android device DoD | §6 |

Each PR ships independently and leaves the app in a working state. Do not start PR N+1 until PR N is merged and CI is green.

---

## File structure (created/modified across all PRs)

**Created (`packages/ui`):**

```
src/components/mobile/
  MobileShell.tsx
  BottomTabBar.tsx
  shared/{SafeArea,BottomSheet,SwipeActions,PullToRefresh,SyncBanner,
          PointerDraggable,PointerResizable,TabSwitcherSheet}.tsx
  capture/{QuickCapture,Composer,VoiceDictation,RecentStack,
           ClipboardSuggestChip,CameraSheet}.tsx
  canvas/{MobileCanvas,StackView,SpatialView,CanvasHeader,CardBubble,ImageCard}.tsx
  library/{Library,ContinueRail,SectionTree,RecentCards,SearchSheet}.tsx
  you/{YouSurface,DeviceList,SettingsRow}.tsx
  auth/MobileSignIn.tsx
src/hooks/{useViewport,useNetwork,useHaptics,useShareIntent}.ts (+ tests)
src/lib/{voice,clipboard-suggest,image-pipeline,fts}.ts (+ tests)
src/store/mobileNav.ts (+ test)
```

**Modified (`packages/ui`):**

- `src/index.ts` — export new mobile entrypoints
- `src/components/cards/CardShell.tsx` — replace `react-rnd` with shim
- `src/store/cards.ts` — `kind` discriminator, `ImageCard` variant, FTS hook on mutation, `syncState`, `selectedCardId`
- `src/store/canvas.ts` — per-tab `viewMode: 'stack' | 'spatial'`
- `src/store/workspace.ts` — `lastTouchedAt` per tab
- `src/store/settings.ts` — `reduceMotion`, `hapticsEnabled`, `spatialOnMobile`, `clipboardSuggestEnabled`
- `package.json` — drop `react-rnd`, add `@testing-library/react`, `jsdom`, `@testing-library/dom`
- `vitest.config.ts` — `environment: 'jsdom'`

**Created (`apps/client` + Rust):**

- `apps/client/src-tauri/src/commands/mobile_camera.rs`
- `apps/client/src-tauri/src/commands/mobile_haptic.rs`
- `apps/client/src-tauri/src/commands/mobile_status_bar.rs`
- `apps/client/src-tauri/src/commands/mobile_network.rs`
- `apps/client/src-tauri/gen/android/app/src/main/java/.../MobileCameraPlugin.kt`
- `apps/client/src-tauri/gen/android/app/src/main/java/.../MobileHapticPlugin.kt`
- `apps/client/tests/e2e/mobile-shell.spec.ts`
- `docs/runbooks/phase3b-android-device-test.md`

**Modified (`apps/client` + Rust + web):**

- `apps/client/src/App.tsx` — viewport seam → MobileShell vs DesktopShell
- `apps/client/src/sync/schema.sql` — append FTS5 virtual table + triggers
- `apps/client/src-tauri/src/lib.rs` — register new commands
- `apps/client/src-tauri/Cargo.toml` — `image = "0.24"` (future-proof)
- `apps/client/src-tauri/capabilities/mobile.json` — camera, haptic, status-bar, network perms
- `apps/client/src-tauri/gen/android/app/src/main/AndroidManifest.xml` — camera permission + intent queries
- `apps/web/src/app/api/ai/route.ts` — `transcribe: true` Whisper branch
- `packages/sync-engine/src/*` — `persistOnEveryMutation` flag, `network-change` subscription

---

## PR 1 — Foundations

### Task 1.0: Test infra — jsdom + Testing Library

**Files:**
- Modify: `packages/ui/package.json`
- Modify: `packages/ui/vitest.config.ts`
- Create: `packages/ui/src/test-setup.ts`

- [ ] **Step 1: Add devDeps**

```bash
pnpm --filter @1scratch/ui add -D jsdom@^25 @testing-library/react@^16 @testing-library/dom@^10 @testing-library/jest-dom@^6 @testing-library/user-event@^14
```

- [ ] **Step 2: Update vitest config**

Replace `packages/ui/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    globals: false,
  },
})
```

- [ ] **Step 3: Create test setup**

`packages/ui/src/test-setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => { cleanup() })

if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (q: string) => ({
    matches: false, media: q, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  } as unknown as MediaQueryList)
}
```

- [ ] **Step 4: Verify existing tests still green**

```bash
pnpm --filter @1scratch/ui test
```

Expected: existing `secure-store.test.ts` passes under jsdom.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/package.json packages/ui/vitest.config.ts packages/ui/src/test-setup.ts pnpm-lock.yaml
git commit -m "test(ui): add jsdom + testing-library for mobile component tests"
```

---

### Task 1.1: `useViewport` hook

**Files:**
- Create: `packages/ui/src/hooks/useViewport.ts`
- Create: `packages/ui/src/hooks/useViewport.test.tsx`

- [ ] **Step 1: Write failing test**

`packages/ui/src/hooks/useViewport.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useViewport } from './useViewport'

describe('useViewport', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth',  { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
  })

  it('returns initial dimensions and isMobile flag', () => {
    const { result } = renderHook(() => useViewport())
    expect(result.current.width).toBe(800)
    expect(result.current.height).toBe(600)
    expect(result.current.isMobile).toBe(false)
  })

  it('flips isMobile when width drops below 600', () => {
    const { result, rerender } = renderHook(() => useViewport())
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
      window.dispatchEvent(new Event('resize'))
    })
    rerender()
    expect(result.current.isMobile).toBe(true)
    expect(result.current.width).toBe(375)
  })

  it('parses safe-area insets from a probe', () => {
    const { result } = renderHook(() => useViewport())
    expect(result.current.safeAreaTop).toBeGreaterThanOrEqual(0)
    expect(result.current.safeAreaBottom).toBeGreaterThanOrEqual(0)
  })
})
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm --filter @1scratch/ui test useViewport
```

Expected: FAIL with module not found.

- [ ] **Step 3: Implement hook**

`packages/ui/src/hooks/useViewport.ts`:

```ts
import { useEffect, useState } from 'react'

export interface Viewport {
  width: number
  height: number
  safeAreaTop: number
  safeAreaBottom: number
  safeAreaLeft: number
  safeAreaRight: number
  isMobile: boolean
}

const SSR: Viewport = {
  width: 0, height: 0,
  safeAreaTop: 0, safeAreaBottom: 0, safeAreaLeft: 0, safeAreaRight: 0,
  isMobile: false,
}

function readSafeArea(): { top: number; bottom: number; left: number; right: number } {
  if (typeof document === 'undefined') return { top: 0, bottom: 0, left: 0, right: 0 }
  const probe = document.createElement('div')
  probe.style.cssText =
    'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;' +
    'padding:env(safe-area-inset-top) env(safe-area-inset-right) ' +
    'env(safe-area-inset-bottom) env(safe-area-inset-left);'
  document.body.appendChild(probe)
  const cs = getComputedStyle(probe)
  const out = {
    top:    parseFloat(cs.paddingTop)    || 0,
    right:  parseFloat(cs.paddingRight)  || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left:   parseFloat(cs.paddingLeft)   || 0,
  }
  probe.remove()
  return out
}

function readViewport(): Viewport {
  if (typeof window === 'undefined') return SSR
  const vv = window.visualViewport
  const width  = vv?.width  ?? window.innerWidth
  const height = vv?.height ?? window.innerHeight
  const sa = readSafeArea()
  return {
    width, height,
    safeAreaTop: sa.top,
    safeAreaBottom: sa.bottom,
    safeAreaLeft: sa.left,
    safeAreaRight: sa.right,
    isMobile: width < 600,
  }
}

export function useViewport(): Viewport {
  const [vp, setVp] = useState<Viewport>(() => readViewport())
  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setVp(readViewport()))
    }
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('resize', update)
    }
  }, [])
  return vp
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter @1scratch/ui test useViewport
```

Expected: PASS 3/3.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/hooks/useViewport.ts packages/ui/src/hooks/useViewport.test.tsx
git commit -m "feat(ui): useViewport hook with safe-area + isMobile gate"
```

---

### Task 1.2: `useNetwork` hook

**Files:**
- Create: `packages/ui/src/hooks/useNetwork.ts`
- Create: `packages/ui/src/hooks/useNetwork.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNetwork } from './useNetwork'

describe('useNetwork', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  })

  it('reports online from navigator.onLine when no Tauri runtime', () => {
    const { result } = renderHook(() => useNetwork())
    expect(result.current.online).toBe(true)
  })

  it('flips on offline event', () => {
    const { result } = renderHook(() => useNetwork())
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current.online).toBe(false)
    expect(result.current.type).toBe('offline')
  })
})
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm --filter @1scratch/ui test useNetwork
```

- [ ] **Step 3: Implement**

`packages/ui/src/hooks/useNetwork.ts`:

```ts
import { useEffect, useState } from 'react'

export interface NetworkState {
  online: boolean
  type: 'wifi' | 'cellular' | 'unknown' | 'offline'
}

function tauriEvent(): typeof import('@tauri-apps/api/event') | null {
  if (typeof window === 'undefined') return null
  if (!(window as any).__TAURI_INTERNALS__) return null
  // dynamic require deferred — avoid SSR cost
  return require('@tauri-apps/api/event')
}

export function useNetwork(): NetworkState {
  const [state, setState] = useState<NetworkState>(() => ({
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    type:   typeof navigator === 'undefined' || navigator.onLine ? 'unknown' : 'offline',
  }))

  useEffect(() => {
    const onLine  = () => setState({ online: true,  type: 'unknown' })
    const offLine = () => setState({ online: false, type: 'offline' })
    window.addEventListener('online',  onLine)
    window.addEventListener('offline', offLine)

    let unlisten: undefined | (() => void)
    const ev = tauriEvent()
    if (ev) {
      ev.listen<NetworkState>('network-change', (e) => setState(e.payload)).then((fn) => {
        unlisten = fn
      })
    }
    return () => {
      window.removeEventListener('online',  onLine)
      window.removeEventListener('offline', offLine)
      unlisten?.()
    }
  }, [])

  return state
}
```

- [ ] **Step 4: Run test, expect pass**

```bash
pnpm --filter @1scratch/ui test useNetwork
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/hooks/useNetwork.ts packages/ui/src/hooks/useNetwork.test.tsx
git commit -m "feat(ui): useNetwork hook subscribing to Tauri network-change event"
```

---

### Task 1.3: `useHaptics` hook

**Files:**
- Create: `packages/ui/src/hooks/useHaptics.ts`
- Create: `packages/ui/src/hooks/useHaptics.test.tsx`
- Modify: `packages/ui/src/store/settings.ts`

- [ ] **Step 1: Add settings fields**

In `packages/ui/src/store/settings.ts`, add to the state shape and default:

```ts
hapticsEnabled: boolean        // default true
reduceMotion: boolean          // default false
spatialOnMobile: boolean       // default false
clipboardSuggestEnabled: boolean // default true
```

Plus setters `setHapticsEnabled`, `setReduceMotion`, `setSpatialOnMobile`, `setClipboardSuggestEnabled`. Persist with the existing settings persistence path.

- [ ] **Step 2: Write failing test for useHaptics**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useHaptics } from './useHaptics'
import { useSettingsStore } from '../store/settings'

describe('useHaptics', () => {
  it('no-ops when reduceMotion is true', () => {
    useSettingsStore.setState({ hapticsEnabled: true, reduceMotion: true })
    const invoke = vi.fn()
    vi.stubGlobal('__TAURI_INVOKE__', invoke)
    const { result } = renderHook(() => useHaptics())
    result.current.light()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('no-ops when hapticsEnabled is false', () => {
    useSettingsStore.setState({ hapticsEnabled: false, reduceMotion: false })
    const invoke = vi.fn()
    vi.stubGlobal('__TAURI_INVOKE__', invoke)
    const { result } = renderHook(() => useHaptics())
    result.current.medium()
    expect(invoke).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test, expect fail**

- [ ] **Step 4: Implement hook**

`packages/ui/src/hooks/useHaptics.ts`:

```ts
import { useMemo } from 'react'
import { useSettingsStore } from '../store/settings'

export interface Haptics {
  light:   () => void
  medium:  () => void
  success: () => void
  warning: () => void
}

const NOOP: Haptics = { light: () => {}, medium: () => {}, success: () => {}, warning: () => {} }

async function invokeHaptic(kind: 'light' | 'medium' | 'success' | 'warning'): Promise<void> {
  if (typeof window === 'undefined') return
  if (!(window as any).__TAURI_INTERNALS__) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('mobile_haptic', { kind }).catch(() => {})
}

export function useHaptics(): Haptics {
  const hapticsEnabled = useSettingsStore((s) => s.hapticsEnabled)
  const reduceMotion   = useSettingsStore((s) => s.reduceMotion)
  return useMemo<Haptics>(() => {
    if (!hapticsEnabled || reduceMotion) return NOOP
    return {
      light:   () => { void invokeHaptic('light') },
      medium:  () => { void invokeHaptic('medium') },
      success: () => { void invokeHaptic('success') },
      warning: () => { void invokeHaptic('warning') },
    }
  }, [hapticsEnabled, reduceMotion])
}
```

- [ ] **Step 5: Run test, expect pass**

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/hooks/useHaptics.ts packages/ui/src/hooks/useHaptics.test.tsx packages/ui/src/store/settings.ts
git commit -m "feat(ui): useHaptics hook + settings additions (haptics/reduceMotion/spatialOnMobile/clipboardSuggest)"
```

---

### Task 1.4: `useShareIntent` hook

**Files:**
- Create: `packages/ui/src/hooks/useShareIntent.ts`
- Create: `packages/ui/src/hooks/useShareIntent.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useShareIntent } from './useShareIntent'

vi.mock('../auth/deep-link', () => ({
  getColdStartUrl: vi.fn(async () => null),
  listenForAuthCallback: vi.fn(() => () => {}),
}))

describe('useShareIntent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts with null pendingPayload', () => {
    const { result } = renderHook(() => useShareIntent())
    expect(result.current.pendingPayload).toBeNull()
  })

  it('parses 1scratch://capture as capture payload', async () => {
    const dl = await import('../auth/deep-link')
    ;(dl.getColdStartUrl as any).mockResolvedValueOnce(new URL('1scratch://capture'))
    const { result } = renderHook(() => useShareIntent())
    await act(async () => { await Promise.resolve() })
    expect(result.current.pendingPayload).toEqual({ kind: 'capture' })
  })
})
```

- [ ] **Step 2: Run test, expect fail**

- [ ] **Step 3: Implement**

`packages/ui/src/hooks/useShareIntent.ts`:

```ts
import { useEffect, useState } from 'react'
import { getColdStartUrl, listenForAuthCallback } from '../auth/deep-link'

export type SharePayload =
  | { kind: 'capture' }
  | { kind: 'share'; raw: string }

export interface ShareIntent {
  pendingPayload: SharePayload | null
  consume: () => void
}

function parse(url: URL): SharePayload | null {
  if (url.protocol !== '1scratch:') return null
  const path = url.pathname.replace(/^\/+/, '') || url.host
  if (path === 'capture') return { kind: 'capture' }
  if (path === 'share') return { kind: 'share', raw: url.toString() }
  return null
}

export function useShareIntent(): ShareIntent {
  const [pending, setPending] = useState<SharePayload | null>(null)

  useEffect(() => {
    let cancelled = false
    getColdStartUrl().then((u) => {
      if (cancelled || !u) return
      const p = parse(u)
      if (p) setPending(p)
    })
    const unlisten = listenForAuthCallback((u) => {
      const p = parse(u)
      if (p) setPending(p)
    })
    return () => { cancelled = true; unlisten() }
  }, [])

  return { pendingPayload: pending, consume: () => setPending(null) }
}
```

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/hooks/useShareIntent.ts packages/ui/src/hooks/useShareIntent.test.tsx
git commit -m "feat(ui): useShareIntent hook for 1scratch://capture and ://share deep links"
```

---

### Task 1.5: `mobileNav` store

**Files:**
- Create: `packages/ui/src/store/mobileNav.ts`
- Create: `packages/ui/src/store/mobileNav.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useMobileNav } from './mobileNav'

describe('mobileNav store', () => {
  beforeEach(() => {
    localStorage.clear()
    useMobileNav.setState({ tab: 'capture', sheetStack: [] })
  })

  it('switches tabs', () => {
    useMobileNav.getState().setTab('library')
    expect(useMobileNav.getState().tab).toBe('library')
  })

  it('persists tab to localStorage', () => {
    useMobileNav.getState().setTab('you')
    expect(localStorage.getItem('1scratch:mobileNav.tab')).toBe('you')
  })

  it('pushes and pops sheets', () => {
    useMobileNav.getState().pushSheet({ id: 'a', kind: 'tab-switcher' })
    useMobileNav.getState().pushSheet({ id: 'b', kind: 'context-menu' })
    expect(useMobileNav.getState().sheetStack).toHaveLength(2)
    useMobileNav.getState().popSheet()
    expect(useMobileNav.getState().sheetStack).toHaveLength(1)
    expect(useMobileNav.getState().sheetStack[0]!.id).toBe('a')
  })
})
```

- [ ] **Step 2: Run test, expect fail**

- [ ] **Step 3: Implement**

`packages/ui/src/store/mobileNav.ts`:

```ts
import { create } from 'zustand'

export type MobileTab = 'capture' | 'canvas' | 'library' | 'you'
export type SheetKind = 'tab-switcher' | 'sync-diagnostics' | 'context-menu' | 'camera' | 'search' | 'settings'

export interface SheetDescriptor {
  id: string
  kind: SheetKind
  props?: Record<string, unknown>
}

interface MobileNavState {
  tab: MobileTab
  sheetStack: SheetDescriptor[]
  setTab: (tab: MobileTab) => void
  pushSheet: (s: SheetDescriptor) => void
  popSheet: () => void
}

const STORAGE_KEY = '1scratch:mobileNav.tab'

function readInitialTab(): MobileTab {
  if (typeof localStorage === 'undefined') return 'capture'
  const v = localStorage.getItem(STORAGE_KEY)
  if (v === 'capture' || v === 'canvas' || v === 'library' || v === 'you') return v
  return 'capture'
}

export const useMobileNav = create<MobileNavState>((set) => ({
  tab: readInitialTab(),
  sheetStack: [],
  setTab: (tab) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, tab)
    set({ tab })
  },
  pushSheet: (s) => set((st) => ({ sheetStack: [...st.sheetStack, s] })),
  popSheet:  () => set((st) => ({ sheetStack: st.sheetStack.slice(0, -1) })),
}))
```

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/store/mobileNav.ts packages/ui/src/store/mobileNav.test.ts
git commit -m "feat(ui): mobileNav store with tab persistence + sheet stack"
```

---

### Task 1.6: `SafeArea` primitive

**Files:**
- Create: `packages/ui/src/components/mobile/shared/SafeArea.tsx`

- [ ] **Step 1: Implement (no separate test — covered by snapshot under MobileShell test)**

```tsx
import type { ReactNode } from 'react'
import { useViewport } from '../../../hooks/useViewport'

type Edge = 'top' | 'bottom' | 'left' | 'right'

export interface SafeAreaProps {
  children: ReactNode
  edges?: Edge[]
  style?: React.CSSProperties
}

const ALL: Edge[] = ['top', 'bottom', 'left', 'right']

export function SafeArea({ children, edges = ALL, style }: SafeAreaProps) {
  const vp = useViewport()
  const padding = {
    paddingTop:    edges.includes('top')    ? vp.safeAreaTop    : 0,
    paddingBottom: edges.includes('bottom') ? vp.safeAreaBottom : 0,
    paddingLeft:   edges.includes('left')   ? vp.safeAreaLeft   : 0,
    paddingRight:  edges.includes('right')  ? vp.safeAreaRight  : 0,
  }
  return <div style={{ ...padding, ...style }}>{children}</div>
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/shared/SafeArea.tsx
git commit -m "feat(ui): SafeArea primitive driven by useViewport"
```

---

### Task 1.7: `BottomSheet` primitive

**Files:**
- Create: `packages/ui/src/components/mobile/shared/BottomSheet.tsx`
- Create: `packages/ui/src/components/mobile/shared/BottomSheet.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BottomSheet } from './BottomSheet'

describe('BottomSheet', () => {
  it('renders children when open', () => {
    render(<BottomSheet open onDismiss={() => {}}><p>hello</p></BottomSheet>)
    expect(screen.getByText('hello')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    render(<BottomSheet open={false} onDismiss={() => {}}><p>hello</p></BottomSheet>)
    expect(screen.queryByText('hello')).toBeNull()
  })

  it('calls onDismiss on backdrop click', () => {
    const onDismiss = vi.fn()
    render(<BottomSheet open onDismiss={onDismiss}><p>x</p></BottomSheet>)
    fireEvent.click(screen.getByTestId('bottom-sheet-backdrop'))
    expect(onDismiss).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test, expect fail**

- [ ] **Step 3: Implement**

```tsx
import { useEffect, useRef, type ReactNode } from 'react'

export interface BottomSheetProps {
  open: boolean
  onDismiss: () => void
  children: ReactNode
  snap?: 0.5 | 1
}

export function BottomSheet({ open, onDismiss, children, snap = 0.5 }: BottomSheetProps) {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onDismiss() }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open, onDismiss])

  if (!open) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000 }} role="dialog" aria-modal="true">
      <div
        data-testid="bottom-sheet-backdrop"
        onClick={onDismiss}
        style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.4)' }}
      />
      <div
        ref={ref}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0,
          height: snap === 1 ? '100%' : '50%',
          background: 'var(--surface, #fff)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          boxShadow: '0 -8px 32px rgba(0,0,0,0.16)',
          overflowY: 'auto',
        }}
      >
        <div style={{ height: 4, width: 36, background: '#ccc', borderRadius: 2, margin: '8px auto' }} />
        {children}
      </div>
    </div>
  )
}
```

(Drag-to-dismiss + focus trap added in Task 1.7b after baseline passes — keep this commit small.)

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/mobile/shared/BottomSheet.tsx packages/ui/src/components/mobile/shared/BottomSheet.test.tsx
git commit -m "feat(ui): BottomSheet primitive (open/close + backdrop dismiss)"
```

### Task 1.7b: BottomSheet drag-to-dismiss + focus trap

- [ ] **Step 1: Add failing test for drag dismiss**

Append to `BottomSheet.test.tsx`:

```tsx
it('dismisses when dragged down past threshold', () => {
  const onDismiss = vi.fn()
  render(<BottomSheet open onDismiss={onDismiss}><p>x</p></BottomSheet>)
  const handle = screen.getByTestId('bottom-sheet-handle')
  fireEvent.pointerDown(handle, { clientY: 0, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientY: 250, pointerId: 1 })
  fireEvent.pointerUp(handle,   { clientY: 250, pointerId: 1 })
  expect(onDismiss).toHaveBeenCalled()
})
```

- [ ] **Step 2: Add handle + drag logic**

Replace the grab-bar `<div>` in `BottomSheet.tsx`:

```tsx
const drag = useRef<{ id: number; startY: number; sheetH: number } | null>(null)
const [translateY, setTranslateY] = useState(0)

const onPointerDown = (e: React.PointerEvent) => {
  drag.current = { id: e.pointerId, startY: e.clientY, sheetH: ref.current?.clientHeight ?? 1 }
  ;(e.target as Element).setPointerCapture?.(e.pointerId)
}
const onPointerMove = (e: React.PointerEvent) => {
  if (!drag.current || drag.current.id !== e.pointerId) return
  const dy = Math.max(0, e.clientY - drag.current.startY)
  setTranslateY(dy)
}
const onPointerUp = (e: React.PointerEvent) => {
  if (!drag.current) return
  const dy = e.clientY - drag.current.startY
  const threshold = drag.current.sheetH * 0.3
  drag.current = null
  setTranslateY(0)
  if (dy >= threshold) onDismiss()
}

// in JSX, on the grab-bar:
<div
  data-testid="bottom-sheet-handle"
  onPointerDown={onPointerDown}
  onPointerMove={onPointerMove}
  onPointerUp={onPointerUp}
  style={{ height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}
>
  <div style={{ height: 4, width: 36, background: '#ccc', borderRadius: 2 }} />
</div>
```

Apply `transform: translateY(${translateY}px)` to the inner sheet div.

- [ ] **Step 3: Focus trap — focus first element on open**

```tsx
useEffect(() => {
  if (!open) return
  const node = ref.current
  if (!node) return
  const focusable = node.querySelector<HTMLElement>(
    'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
  )
  focusable?.focus()
}, [open])
```

- [ ] **Step 4: Run tests, expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/mobile/shared/BottomSheet.tsx packages/ui/src/components/mobile/shared/BottomSheet.test.tsx
git commit -m "feat(ui): BottomSheet drag-to-dismiss + focus trap"
```

---

### Task 1.8: `SwipeActions` primitive

**Files:**
- Create: `packages/ui/src/components/mobile/shared/SwipeActions.tsx`
- Create: `packages/ui/src/components/mobile/shared/SwipeActions.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SwipeActions } from './SwipeActions'

describe('SwipeActions', () => {
  it('fires left action onTrigger when swiped past threshold', () => {
    const onTrigger = vi.fn()
    render(
      <SwipeActions leftAction={{ label: 'Delete', color: '#f00', onTrigger }}>
        <div data-testid="row">row</div>
      </SwipeActions>,
    )
    const row = screen.getByTestId('row').parentElement!
    fireEvent.pointerDown(row, { clientX: 0,  pointerId: 1 })
    fireEvent.pointerMove(row, { clientX: 80, pointerId: 1 })
    fireEvent.pointerUp(row,   { clientX: 80, pointerId: 1 })
    expect(onTrigger).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test, expect fail**

- [ ] **Step 3: Implement**

```tsx
import { useRef, useState, type ReactNode } from 'react'

interface ActionDescriptor {
  label: string
  color: string
  onTrigger: () => void
}

export interface SwipeActionsProps {
  children: ReactNode
  leftAction?: ActionDescriptor
  rightAction?: ActionDescriptor
  threshold?: number
}

export function SwipeActions({ children, leftAction, rightAction, threshold = 64 }: SwipeActionsProps) {
  const [dx, setDx] = useState(0)
  const drag = useRef<{ id: number; startX: number } | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { id: e.pointerId, startX: e.clientX }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return
    setDx(e.clientX - drag.current.startX)
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!drag.current) return
    const finalDx = e.clientX - drag.current.startX
    drag.current = null
    if      (finalDx >=  threshold && leftAction)  leftAction.onTrigger()
    else if (finalDx <= -threshold && rightAction) rightAction.onTrigger()
    setDx(0)
  }

  return (
    <div
      style={{ position: 'relative', overflow: 'hidden', touchAction: 'pan-y' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {leftAction && dx > 0 && (
        <div style={{ position: 'absolute', inset: 0, background: leftAction.color, display: 'flex', alignItems: 'center', paddingLeft: 16 }}>
          <span style={{ color: '#fff', fontWeight: 600 }}>{leftAction.label}</span>
        </div>
      )}
      {rightAction && dx < 0 && (
        <div style={{ position: 'absolute', inset: 0, background: rightAction.color, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 16 }}>
          <span style={{ color: '#fff', fontWeight: 600 }}>{rightAction.label}</span>
        </div>
      )}
      <div style={{ transform: `translateX(${dx}px)`, transition: drag.current ? 'none' : 'transform 200ms' }}>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/mobile/shared/SwipeActions.tsx packages/ui/src/components/mobile/shared/SwipeActions.test.tsx
git commit -m "feat(ui): SwipeActions primitive (pointer events, 64pt threshold)"
```

---

### Task 1.9: `PullToRefresh` primitive

**Files:**
- Create: `packages/ui/src/components/mobile/shared/PullToRefresh.tsx`
- Create: `packages/ui/src/components/mobile/shared/PullToRefresh.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PullToRefresh } from './PullToRefresh'

describe('PullToRefresh', () => {
  it('calls onRefresh when pulled past threshold', async () => {
    const onRefresh = vi.fn(async () => {})
    render(
      <PullToRefresh onRefresh={onRefresh}>
        <div data-testid="content" style={{ height: 400 }}>scroll</div>
      </PullToRefresh>,
    )
    const wrap = screen.getByTestId('content').parentElement!.parentElement!
    Object.defineProperty(wrap, 'scrollTop', { configurable: true, value: 0 })
    fireEvent.pointerDown(wrap, { clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(wrap, { clientY: 100, pointerId: 1 })
    fireEvent.pointerUp(wrap,   { clientY: 100, pointerId: 1 })
    await waitFor(() => expect(onRefresh).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run test, expect fail**

- [ ] **Step 3: Implement**

```tsx
import { useRef, useState, type ReactNode } from 'react'

export interface PullToRefreshProps {
  children: ReactNode
  onRefresh: () => Promise<void>
  threshold?: number
}

export function PullToRefresh({ children, onRefresh, threshold = 60 }: PullToRefreshProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const drag = useRef<{ id: number; startY: number } | null>(null)
  const [dy, setDy] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [pill, setPill] = useState<string | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    if ((wrapRef.current?.scrollTop ?? 0) > 0) return
    drag.current = { id: e.pointerId, startY: e.clientY }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || drag.current.id !== e.pointerId) return
    const v = e.clientY - drag.current.startY
    if (v < 0) return
    setDy(v)
  }
  const onPointerUp = async (e: React.PointerEvent) => {
    if (!drag.current) return
    const finalDy = e.clientY - drag.current.startY
    drag.current = null
    if (finalDy >= threshold && !refreshing) {
      setRefreshing(true)
      try {
        await onRefresh()
        setPill(`Synced just now`)
        setTimeout(() => setPill(null), 1500)
      } finally {
        setRefreshing(false)
        setDy(0)
      }
    } else {
      setDy(0)
    }
  }

  return (
    <div
      ref={wrapRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{ position: 'relative', overflowY: 'auto', height: '100%' }}
    >
      <div style={{ height: dy, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888' }}>
        {refreshing ? '⟳ Syncing…' : dy >= threshold ? 'Release to sync' : dy > 0 ? 'Pull to sync' : ''}
      </div>
      {pill && (
        <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', background: '#222', color: '#fff', borderRadius: 12, padding: '4px 12px', fontSize: 13 }}>
          {pill}
        </div>
      )}
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/mobile/shared/PullToRefresh.tsx packages/ui/src/components/mobile/shared/PullToRefresh.test.tsx
git commit -m "feat(ui): PullToRefresh primitive"
```

---

### Task 1.10: `SyncBanner` primitive (skeleton — final wiring in PR 6)

**Files:**
- Create: `packages/ui/src/components/mobile/shared/SyncBanner.tsx`
- Create: `packages/ui/src/components/mobile/shared/SyncBanner.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SyncBanner } from './SyncBanner'

describe('SyncBanner', () => {
  it('hides when state is hidden', () => {
    render(<SyncBanner state="hidden" />)
    expect(screen.queryByRole('status')).toBeNull()
  })
  it('shows offline copy when offline-saved', () => {
    render(<SyncBanner state="offline-saved" />)
    expect(screen.getByRole('status')).toHaveTextContent(/Offline/i)
  })
  it('shows reconnecting copy', () => {
    render(<SyncBanner state="reconnecting" />)
    expect(screen.getByRole('status')).toHaveTextContent(/Reconnecting/i)
  })
})
```

- [ ] **Step 2: Implement**

```tsx
export type SyncBannerState = 'hidden' | 'offline-saved' | 'reconnecting' | 'sync-failed'

export interface SyncBannerProps {
  state: SyncBannerState
  onTap?: () => void
}

const COPY: Record<Exclude<SyncBannerState, 'hidden'>, { text: string; bg: string }> = {
  'offline-saved': { text: 'Offline — your changes are saved locally', bg: '#444' },
  'reconnecting':  { text: 'Reconnecting…',                            bg: '#246' },
  'sync-failed':   { text: 'Sync paused — will retry. Tap for details.', bg: '#a33' },
}

export function SyncBanner({ state, onTap }: SyncBannerProps) {
  if (state === 'hidden') return null
  const { text, bg } = COPY[state]
  return (
    <div role="status" onClick={onTap} style={{
      background: bg, color: '#fff', padding: '8px 12px',
      fontSize: 13, textAlign: 'center', cursor: onTap ? 'pointer' : 'default',
    }}>
      {text}
    </div>
  )
}
```

- [ ] **Step 3: Run test, expect pass**

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/mobile/shared/SyncBanner.tsx packages/ui/src/components/mobile/shared/SyncBanner.test.tsx
git commit -m "feat(ui): SyncBanner primitive (4 states)"
```

---

### Task 1.11: `TabSwitcherSheet`

**Files:**
- Create: `packages/ui/src/components/mobile/shared/TabSwitcherSheet.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState } from 'react'
import { BottomSheet } from './BottomSheet'
import { useWorkspaceStore } from '../../../store/workspace'

export interface TabSwitcherSheetProps {
  open: boolean
  onDismiss: () => void
}

export function TabSwitcherSheet({ open, onDismiss }: TabSwitcherSheetProps) {
  const sections = useWorkspaceStore((s) => s.sections)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const [q, setQ] = useState('')

  const matches = (s: string) => s.toLowerCase().includes(q.toLowerCase())

  return (
    <BottomSheet open={open} onDismiss={onDismiss} snap={1}>
      <div style={{ padding: 16 }}>
        <input
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search canvases…"
          style={{ width: '100%', padding: 12, fontSize: 16, border: '1px solid #ddd', borderRadius: 8 }}
        />
        <div style={{ marginTop: 16 }}>
          {sections.map((sec) => (
            <div key={sec.id}>
              <div style={{ fontSize: 12, color: '#888', textTransform: 'uppercase', margin: '8px 0' }}>{sec.name}</div>
              {sec.tabs.filter((t) => !q || matches(t.name) || matches(sec.name)).map((t) => (
                <button key={t.id}
                  onClick={() => { setActiveTab(sec.id, t.id); onDismiss() }}
                  style={{ display: 'block', width: '100%', padding: 12, textAlign: 'left', background: 'transparent', border: 0, fontSize: 15 }}>
                  {t.name}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </BottomSheet>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/shared/TabSwitcherSheet.tsx
git commit -m "feat(ui): TabSwitcherSheet shared header sheet"
```

---

### Task 1.12: `BottomTabBar`

**Files:**
- Create: `packages/ui/src/components/mobile/BottomTabBar.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useMobileNav, type MobileTab } from '../../store/mobileNav'
import { useHaptics } from '../../hooks/useHaptics'
import { SafeArea } from './shared/SafeArea'

const TABS: { id: MobileTab; label: string; icon: string }[] = [
  { id: 'capture', label: 'Capture', icon: '✎' },
  { id: 'canvas',  label: 'Canvas',  icon: '⊡' },
  { id: 'library', label: 'Library', icon: '☰' },
  { id: 'you',     label: 'You',     icon: '◉' },
]

export function BottomTabBar() {
  const tab = useMobileNav((s) => s.tab)
  const setTab = useMobileNav((s) => s.setTab)
  const haptics = useHaptics()
  return (
    <SafeArea edges={['bottom', 'left', 'right']} style={{ borderTop: '1px solid #eee', background: '#fff' }}>
      <div role="tablist" style={{ display: 'flex', height: 56 }}>
        {TABS.map((t) => {
          const active = t.id === tab
          return (
            <button
              key={t.id}
              role="tab"
              aria-selected={active}
              aria-label={t.label}
              onClick={() => { if (!active) { haptics.light(); setTab(t.id) } }}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
                justifyContent: 'center', background: 'transparent', border: 0, gap: 2,
                color: active ? '#000' : '#888', fontSize: 12,
              }}
            >
              <span style={{ fontSize: 20 }}>{t.icon}</span>
              <span>{t.label}</span>
            </button>
          )
        })}
      </div>
    </SafeArea>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/BottomTabBar.tsx
git commit -m "feat(ui): BottomTabBar with mobileNav + light haptic on switch"
```

---

### Task 1.13: `MobileShell` skeleton

**Files:**
- Create: `packages/ui/src/components/mobile/MobileShell.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Implement skeleton**

```tsx
import { useMobileNav } from '../../store/mobileNav'
import { BottomTabBar } from './BottomTabBar'
import { SafeArea } from './shared/SafeArea'

export function MobileShell() {
  const tab = useMobileNav((s) => s.tab)
  return (
    <div data-mobile-shell style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <SafeArea edges={['top']}>
        <header style={{ padding: '8px 16px', fontSize: 14, color: '#666' }}>1Scratch</header>
      </SafeArea>
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'capture' && <h1 style={{ padding: 16 }}>Capture</h1>}
        {tab === 'canvas'  && <h1 style={{ padding: 16 }}>Canvas</h1>}
        {tab === 'library' && <h1 style={{ padding: 16 }}>Library</h1>}
        {tab === 'you'     && <h1 style={{ padding: 16 }}>You</h1>}
      </main>
      <BottomTabBar />
    </div>
  )
}
```

- [ ] **Step 2: Export from index**

Append to `packages/ui/src/index.ts`:

```ts
export { MobileShell } from './components/mobile/MobileShell'
export { useViewport } from './hooks/useViewport'
export { useNetwork } from './hooks/useNetwork'
export { useHaptics } from './hooks/useHaptics'
export { useShareIntent } from './hooks/useShareIntent'
export { useMobileNav } from './store/mobileNav'
```

- [ ] **Step 3: Verify tsc**

```bash
pnpm -w tsc -b
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/mobile/MobileShell.tsx packages/ui/src/index.ts
git commit -m "feat(ui): MobileShell skeleton + barrel exports"
```

---

### Task 1.14: `App.tsx` render seam

**Files:**
- Modify: `apps/client/src/App.tsx`

- [ ] **Step 1: Read current App.tsx** to locate the existing `Shell` component.

- [ ] **Step 2: Modify App.tsx** — wrap existing Shell + new MobileShell as siblings under the same provider tree:

In `apps/client/src/App.tsx`, replace the rendered `<Shell />` (after `signedIn` checks, inside the existing return) so both shells mount as siblings, hidden via the viewport flag:

```tsx
import { MobileShell, useViewport } from '@1scratch/ui'

// inside the signed-in render path, instead of just <Shell />:
function ResponsiveShell() {
  const { isMobile } = useViewport()
  return (
    <>
      <div hidden={isMobile} style={{ height: '100%' }}><Shell /></div>
      <div hidden={!isMobile} style={{ height: '100%' }}><MobileShell /></div>
    </>
  )
}

// then render <ResponsiveShell /> wherever <Shell /> was rendered.
```

Keep `SyncProvider` mounted exactly once around `ResponsiveShell` so stores survive resize.

- [ ] **Step 3: Manual verify**

```bash
pnpm -w dev
```

Resize browser to <600pt and verify MobileShell renders; resize back, verify desktop renders, console clean.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/App.tsx
git commit -m "feat(client): viewport seam swaps to MobileShell below 600pt"
```

---

### Task 1.15: Rust commands `mobile_haptic`, `mobile_network`, `mobile_status_bar`

**Files:**
- Create: `apps/client/src-tauri/src/commands/mod.rs`
- Create: `apps/client/src-tauri/src/commands/mobile_haptic.rs`
- Create: `apps/client/src-tauri/src/commands/mobile_network.rs`
- Create: `apps/client/src-tauri/src/commands/mobile_status_bar.rs`
- Modify: `apps/client/src-tauri/src/lib.rs`
- Modify: `apps/client/src-tauri/capabilities/mobile.json`

- [ ] **Step 1: Implement Rust shims**

`apps/client/src-tauri/src/commands/mod.rs`:

```rust
pub mod mobile_haptic;
pub mod mobile_network;
pub mod mobile_status_bar;
```

`mobile_haptic.rs`:

```rust
#[tauri::command]
pub async fn mobile_haptic(kind: String) -> Result<(), String> {
    #[cfg(target_os = "android")] {
        // Kotlin plugin invocation goes through Tauri plugin bridge added in Task 1.16.
        // For now, accept the call and no-op; the Kotlin path lands in 1.16.
        let _ = kind;
        Ok(())
    }
    #[cfg(not(target_os = "android"))] { let _ = kind; Ok(()) }
}
```

`mobile_status_bar.rs`:

```rust
#[tauri::command]
pub async fn mobile_status_bar(theme: String) -> Result<(), String> {
    let _ = theme;
    Ok(())
}
```

`mobile_network.rs`:

```rust
use tauri::{AppHandle, Emitter, Manager, Runtime};
use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct NetworkPayload {
    pub online: bool,
    pub r#type: String,
}

#[tauri::command]
pub async fn mobile_network_probe<R: Runtime>(app: AppHandle<R>) -> Result<NetworkPayload, String> {
    // Best-effort: emit current state so JS can subscribe + reconcile.
    let payload = NetworkPayload { online: true, r#type: "unknown".into() };
    app.emit("network-change", payload.clone()).map_err(|e| e.to_string())?;
    Ok(payload)
}
```

- [ ] **Step 2: Register in lib.rs**

In `apps/client/src-tauri/src/lib.rs`, inside `tauri::Builder::default()` chain, add:

```rust
mod commands;
// inside the builder chain:
.invoke_handler(tauri::generate_handler![
    commands::mobile_haptic::mobile_haptic,
    commands::mobile_status_bar::mobile_status_bar,
    commands::mobile_network::mobile_network_probe,
])
```

If an existing `invoke_handler!` block exists, merge the new handlers into it.

- [ ] **Step 3: Update mobile capability**

Append to `permissions` in `apps/client/src-tauri/capabilities/mobile.json`:

```json
"core:event:default",
"core:event:allow-emit",
"core:event:allow-listen"
```

(Existing 3a perms remain unchanged.)

- [ ] **Step 4: Verify build**

```bash
pnpm --filter ./apps/client tauri android build --debug --no-bundle
```

Expected: compiles. (If Android SDK absent, fall back to `pnpm --filter ./apps/client run tauri build --debug --no-bundle` to compile desktop only — Rust changes still validate.)

- [ ] **Step 5: Commit**

```bash
git add apps/client/src-tauri/src/commands apps/client/src-tauri/src/lib.rs apps/client/src-tauri/capabilities/mobile.json
git commit -m "feat(tauri): mobile_haptic, mobile_status_bar, mobile_network_probe Rust commands"
```

---

### Task 1.16: Android Kotlin plugin for haptics

**Files:**
- Create: `apps/client/src-tauri/gen/android/app/src/main/java/ai/scratch/app/MobileHapticPlugin.kt`
- Modify: `apps/client/src-tauri/gen/android/app/src/main/java/ai/scratch/app/MainActivity.kt`

- [ ] **Step 1: Plugin source**

```kotlin
package ai.scratch.app

import android.app.Activity
import android.os.Build
import android.os.VibrationEffect
import android.os.VibratorManager
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg class HapticArgs { lateinit var kind: String }

@TauriPlugin
class MobileHapticPlugin(private val activity: Activity) : Plugin(activity) {
    private val vibrator by lazy {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            (activity.getSystemService(Activity.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            activity.getSystemService(Activity.VIBRATOR_SERVICE) as android.os.Vibrator
        }
    }

    @Command
    fun trigger(invoke: Invoke) {
        val a = invoke.parseArgs(HapticArgs::class.java)
        val effect = when (a.kind) {
            "light"   -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)
            "medium"  -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)
            "success" -> VibrationEffect.createWaveform(longArrayOf(0, 30, 50, 30), -1)
            "warning" -> VibrationEffect.createWaveform(longArrayOf(0, 50, 80, 50), -1)
            else -> { invoke.reject("unknown kind"); return }
        }
        vibrator.vibrate(effect)
        invoke.resolve()
    }
}
```

- [ ] **Step 2: Register in MainActivity**

In `MainActivity.kt`, inside `onCreate` (after `super.onCreate`), add:

```kotlin
registerPlugin(MobileHapticPlugin::class.java)
```

- [ ] **Step 3: Update Rust haptic to invoke the plugin**

Replace `mobile_haptic.rs` Android branch:

```rust
#[cfg(target_os = "android")]
pub async fn mobile_haptic<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    kind: String,
) -> Result<(), String> {
    let plugin = app.android_plugin_handle("MobileHapticPlugin").map_err(|e| e.to_string())?;
    plugin.run_mobile_plugin::<()>("trigger", serde_json::json!({ "kind": kind })).map_err(|e| e.to_string())?;
    Ok(())
}
```

(Adjust signature in `lib.rs` invoke_handler so that `mobile_haptic` takes `AppHandle` on Android; on non-Android the previous no-op stays.)

- [ ] **Step 4: Verify Android build**

```bash
pnpm --filter ./apps/client run android:dev
```

Manual: tap a tab in the UI on a real Pixel, feel the tick.

- [ ] **Step 5: Commit**

```bash
git add apps/client/src-tauri/gen/android/app/src/main/java/ai/scratch/app/MobileHapticPlugin.kt apps/client/src-tauri/gen/android/app/src/main/java/ai/scratch/app/MainActivity.kt apps/client/src-tauri/src/commands/mobile_haptic.rs
git commit -m "feat(android): MobileHapticPlugin (VibratorManager predefined effects)"
```

---

### Task 1.17: PR 1 acceptance + open

- [ ] **Step 1: All clean**

```bash
pnpm -w tsc -b
pnpm -w test
```

Both green.

- [ ] **Step 2: Push + open PR**

```bash
git push -u origin phase3b-mobile-touch-ux
gh pr create --title "Phase 3b PR 1: foundations (mobile shell, tab nav, primitives, hooks, haptics)" \
  --body "$(cat <<'EOF'
## Summary
- Viewport seam swaps to MobileShell below 600pt
- Bottom-tab nav (capture/canvas/library/you) with mobileNav store
- Shared primitives: SafeArea, BottomSheet, SwipeActions, PullToRefresh, SyncBanner, TabSwitcherSheet
- Hooks: useViewport, useNetwork, useHaptics, useShareIntent
- Rust commands: mobile_haptic (Android Kotlin VibratorManager), mobile_status_bar, mobile_network_probe
- Settings additions: hapticsEnabled, reduceMotion, spatialOnMobile, clipboardSuggestEnabled

Spec: docs/superpowers/specs/2026-04-25-phase3b-mobile-touch-ux-design.md §1 §8

## Test plan
- [x] Vitest green (jsdom + RTL)
- [x] tsc clean
- [ ] Browser narrow-window manual smoke
- [ ] Pixel device tap-tab → light haptic
EOF
)"
```

PR 1 ships when CI green.

---

## PR 2 — Pointer Events shim, replace `react-rnd`

### Task 2.1: `PointerDraggable`

**Files:**
- Create: `packages/ui/src/components/mobile/shared/PointerDraggable.tsx`
- Create: `packages/ui/src/components/mobile/shared/PointerDraggable.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PointerDraggable } from './PointerDraggable'

describe('PointerDraggable', () => {
  it('reports position deltas via onPositionChange', () => {
    const onPositionChange = vi.fn()
    render(
      <PointerDraggable position={{ x: 0, y: 0 }} onPositionChange={onPositionChange}>
        <div data-testid="t" style={{ width: 100, height: 100 }} />
      </PointerDraggable>,
    )
    const t = screen.getByTestId('t').parentElement!
    fireEvent.pointerDown(t, { clientX: 0,  clientY: 0,  pointerId: 1 })
    fireEvent.pointerMove(t, { clientX: 30, clientY: 40, pointerId: 1 })
    fireEvent.pointerUp(t,   { clientX: 30, clientY: 40, pointerId: 1 })
    expect(onPositionChange).toHaveBeenLastCalledWith({ x: 30, y: 40 })
  })

  it('respects longPressMs — moving before timer cancels drag', () => {
    vi.useFakeTimers()
    const onDragStart = vi.fn()
    render(
      <PointerDraggable position={{ x: 0, y: 0 }} onPositionChange={() => {}} onDragStart={onDragStart} longPressMs={300}>
        <div data-testid="t" />
      </PointerDraggable>,
    )
    const t = screen.getByTestId('t').parentElement!
    fireEvent.pointerDown(t, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(t, { clientX: 20, clientY: 0, pointerId: 1 })
    vi.advanceTimersByTime(400)
    expect(onDragStart).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not start when disabled', () => {
    const onPositionChange = vi.fn()
    render(
      <PointerDraggable position={{ x: 0, y: 0 }} onPositionChange={onPositionChange} disabled>
        <div data-testid="t" />
      </PointerDraggable>,
    )
    const t = screen.getByTestId('t').parentElement!
    fireEvent.pointerDown(t, { clientX: 0, clientY: 0, pointerId: 1 })
    fireEvent.pointerMove(t, { clientX: 30, clientY: 40, pointerId: 1 })
    expect(onPositionChange).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test, expect fail**

```bash
pnpm --filter @1scratch/ui test PointerDraggable
```

- [ ] **Step 3: Implement**

```tsx
import { useRef, type ReactNode } from 'react'

export interface PointerDraggableProps {
  position: { x: number; y: number }
  onPositionChange: (p: { x: number; y: number }) => void
  onDragStart?: () => void
  onDragEnd?: () => void
  disabled?: boolean
  handle?: string
  longPressMs?: number
  children: ReactNode
}

interface DragState {
  pointerId: number
  startX: number; startY: number
  origX: number;  origY: number
  active: boolean
  longPressTimer: number | null
}

const MOVE_CANCEL_THRESHOLD = 8

export function PointerDraggable(props: PointerDraggableProps) {
  const { position, onPositionChange, onDragStart, onDragEnd, disabled, handle, longPressMs = 0, children } = props
  const stateRef = useRef<DragState | null>(null)

  const matchesHandle = (target: EventTarget | null): boolean => {
    if (!handle) return true
    if (!(target instanceof Element)) return false
    return !!target.closest(handle)
  }

  const cancel = () => {
    const s = stateRef.current
    if (!s) return
    if (s.longPressTimer != null) clearTimeout(s.longPressTimer)
    stateRef.current = null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    if (!matchesHandle(e.target)) return
    if (stateRef.current) return
    e.currentTarget.setPointerCapture(e.pointerId)
    const s: DragState = {
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      origX: position.x,  origY: position.y,
      active: longPressMs === 0,
      longPressTimer: null,
    }
    if (longPressMs > 0) {
      s.longPressTimer = window.setTimeout(() => {
        s.active = true
        onDragStart?.()
      }, longPressMs)
    } else {
      onDragStart?.()
    }
    stateRef.current = s
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const s = stateRef.current
    if (!s || s.pointerId !== e.pointerId) return
    const dx = e.clientX - s.startX
    const dy = e.clientY - s.startY
    if (!s.active) {
      if (Math.abs(dx) > MOVE_CANCEL_THRESHOLD || Math.abs(dy) > MOVE_CANCEL_THRESHOLD) cancel()
      return
    }
    onPositionChange({ x: s.origX + dx, y: s.origY + dy })
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const s = stateRef.current
    if (!s || s.pointerId !== e.pointerId) return
    const wasActive = s.active
    cancel()
    if (wasActive) onDragEnd?.()
  }

  return (
    <div
      style={{ touchAction: handle ? 'auto' : 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/mobile/shared/PointerDraggable.tsx packages/ui/src/components/mobile/shared/PointerDraggable.test.tsx
git commit -m "feat(ui): PointerDraggable shim (PointerEvents, longPress, multi-pointer cancel)"
```

---

### Task 2.2: `PointerResizable`

**Files:**
- Create: `packages/ui/src/components/mobile/shared/PointerResizable.tsx`
- Create: `packages/ui/src/components/mobile/shared/PointerResizable.test.tsx`

- [ ] **Step 1: Write failing test**

```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PointerResizable } from './PointerResizable'

describe('PointerResizable', () => {
  it('resizes via the handle', () => {
    const onSizeChange = vi.fn()
    render(
      <PointerResizable size={{ width: 100, height: 100 }} onSizeChange={onSizeChange} selected>
        <div>x</div>
      </PointerResizable>,
    )
    const handle = screen.getByTestId('resize-handle')
    fireEvent.pointerDown(handle, { clientX: 0,  clientY: 0,  pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: 50, clientY: 30, pointerId: 1 })
    fireEvent.pointerUp(handle,   { clientX: 50, clientY: 30, pointerId: 1 })
    expect(onSizeChange).toHaveBeenLastCalledWith({ width: 150, height: 130 })
  })

  it('clamps to minWidth/minHeight', () => {
    const onSizeChange = vi.fn()
    render(
      <PointerResizable size={{ width: 100, height: 100 }} onSizeChange={onSizeChange} selected minWidth={80} minHeight={60}>
        <div>x</div>
      </PointerResizable>,
    )
    const handle = screen.getByTestId('resize-handle')
    fireEvent.pointerDown(handle, { clientX: 0,    clientY: 0,    pointerId: 1 })
    fireEvent.pointerMove(handle, { clientX: -200, clientY: -200, pointerId: 1 })
    expect(onSizeChange).toHaveBeenLastCalledWith({ width: 80, height: 60 })
  })

  it('hides handle when not selected', () => {
    render(
      <PointerResizable size={{ width: 100, height: 100 }} onSizeChange={() => {}} selected={false}>
        <div>x</div>
      </PointerResizable>,
    )
    expect(screen.queryByTestId('resize-handle')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test, expect fail**

- [ ] **Step 3: Implement**

```tsx
import { useRef, type ReactNode } from 'react'

export interface PointerResizableProps {
  size: { width: number; height: number }
  onSizeChange: (s: { width: number; height: number }) => void
  onResizeStart?: () => void
  onResizeEnd?: () => void
  minWidth?: number
  minHeight?: number
  selected: boolean
  children: ReactNode
}

interface ResizeState {
  pointerId: number
  startX: number; startY: number
  origW: number;  origH: number
}

export function PointerResizable(props: PointerResizableProps) {
  const { size, onSizeChange, onResizeStart, onResizeEnd, minWidth = 80, minHeight = 60, selected, children } = props
  const stateRef = useRef<ResizeState | null>(null)

  const onPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    stateRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      origW: size.width, origH: size.height,
    }
    onResizeStart?.()
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const s = stateRef.current
    if (!s || s.pointerId !== e.pointerId) return
    const w = Math.max(minWidth,  s.origW + (e.clientX - s.startX))
    const h = Math.max(minHeight, s.origH + (e.clientY - s.startY))
    onSizeChange({ width: w, height: h })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (!stateRef.current || stateRef.current.pointerId !== e.pointerId) return
    stateRef.current = null
    onResizeEnd?.()
  }

  return (
    <div style={{ position: 'relative', width: size.width, height: size.height }}>
      {children}
      {selected && (
        <div
          data-testid="resize-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{
            position: 'absolute', right: -4, bottom: -4, width: 24, height: 24,
            cursor: 'nwse-resize', touchAction: 'none',
            background: 'transparent',
          }}
        >
          <div style={{ position: 'absolute', right: 4, bottom: 4, width: 12, height: 12, borderRight: '2px solid #888', borderBottom: '2px solid #888' }} />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/mobile/shared/PointerResizable.tsx packages/ui/src/components/mobile/shared/PointerResizable.test.tsx
git commit -m "feat(ui): PointerResizable shim (24x24 BR handle, min clamps)"
```

---

### Task 2.3: Add `selectedCardId` to cards store

**Files:**
- Modify: `packages/ui/src/store/cards.ts`

- [ ] **Step 1: Add field + setter**

In `CardsState` interface, append:

```ts
selectedCardId: string | null
setSelectedCard: (id: string | null) => void
```

In the store factory, add `selectedCardId: null`, and:

```ts
setSelectedCard: (id) => set({ selectedCardId: id }),
```

In `removeCard`, also clear selection if matching:

```ts
removeCard: (id) => {
  set((s) => {
    const next = { ...s.cards }
    delete next[id]
    return { cards: next, selectedCardId: s.selectedCardId === id ? null : s.selectedCardId }
  })
},
```

- [ ] **Step 2: Verify tsc**

```bash
pnpm -w tsc -b
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/store/cards.ts
git commit -m "feat(ui): cards store selectedCardId for resize-handle visibility"
```

---

### Task 2.4: Replace `react-rnd` in `CardShell`

**Files:**
- Modify: `packages/ui/src/components/cards/CardShell.tsx`

- [ ] **Step 1: Read current CardShell**

Run `cat packages/ui/src/components/cards/CardShell.tsx` to capture the existing prop names + handlers (drag stop, resize stop, etc.). The shim needs to invoke the same store mutations.

- [ ] **Step 2: Rewrite**

Replace the file body:

```tsx
import { useCardsStore } from '../../store/cards'
import { PointerDraggable } from '../mobile/shared/PointerDraggable'
import { PointerResizable } from '../mobile/shared/PointerResizable'

interface Props {
  id: string
  x: number; y: number
  width: number; height: number
  children: React.ReactNode
}

export default function CardShell({ id, x, y, width, height, children }: Props) {
  const updateCard       = useCardsStore((s) => s.updateCard)
  const bringToFront     = useCardsStore((s) => s.bringToFront)
  const setSelectedCard  = useCardsStore((s) => s.setSelectedCard)
  const selectedCardId   = useCardsStore((s) => s.selectedCardId)
  const isSelected       = selectedCardId === id

  return (
    <div
      style={{ position: 'absolute', left: x, top: y }}
      onPointerDownCapture={() => { bringToFront(id); setSelectedCard(id) }}
    >
      <PointerDraggable
        position={{ x, y }}
        onPositionChange={(p) => updateCard(id, { x: p.x, y: p.y } as any)}
        handle=".drag-tab"
      >
        <PointerResizable
          size={{ width, height }}
          onSizeChange={(s) => updateCard(id, { width: s.width, height: s.height } as any)}
          selected={isSelected}
        >
          {children}
        </PointerResizable>
      </PointerDraggable>
    </div>
  )
}
```

(Keep any pre-existing class names / data attributes that desktop CSS depends on. If the previous file applied transforms via `Rnd`'s `position` relative semantics, set the outer `position: absolute` on the shell wrapper to match.)

- [ ] **Step 3: Run desktop UI manually**

```bash
pnpm -w dev
```

Open canvas, drag/resize a card, confirm parity with previous behavior.

- [ ] **Step 4: Run all tests**

```bash
pnpm -w test
```

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/components/cards/CardShell.tsx
git commit -m "refactor(ui): CardShell uses Pointer Events shim (drops react-rnd)"
```

---

### Task 2.5: Drop `react-rnd` dep

**Files:**
- Modify: `packages/ui/package.json`

- [ ] **Step 1: Remove dep**

```bash
pnpm --filter @1scratch/ui remove react-rnd
```

- [ ] **Step 2: Verify nothing else imports it**

```bash
grep -rn "react-rnd" packages apps
```

Expected: empty.

- [ ] **Step 3: Verify tsc + tests**

```bash
pnpm -w tsc -b
pnpm -w test
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/package.json pnpm-lock.yaml
git commit -m "chore(ui): drop react-rnd after Pointer Events shim swap"
```

---

### Task 2.6: PR 2 acceptance + open

- [ ] **Step 1: Push + open PR**

```bash
git push
gh pr create --title "Phase 3b PR 2: Pointer Events shim replaces react-rnd" \
  --body "$(cat <<'EOF'
## Summary
- PointerDraggable + PointerResizable in-house shims using PointerEvents (mouse + touch one path)
- CardShell rewritten on top of the shim; public API (updateCard, bringToFront) unchanged
- Cards store gains selectedCardId for resize-handle visibility
- react-rnd removed from packages/ui

Spec §2

## Test plan
- [x] PointerDraggable + PointerResizable Vitest cases
- [x] tsc clean across workspace
- [ ] Desktop manual: drag, resize, multi-card on canvas
- [ ] Pixel device: pinch-zoom + long-press card drag in spatial mode
EOF
)"
```

PR 2 ships when CI green and desktop manual passes.

---

## PR 3 — Quick Capture

### Task 3.1: Card kind discriminator + ImageCard variant

**Files:**
- Modify: `packages/ui/src/store/cards.ts`

- [ ] **Step 1: Add discriminator + ImageCard type**

Replace the `Card` interface region:

```ts
export interface BaseCard {
  id: string
  canvasId: string             // required — Library + RecentCards filter by canvas
  x: number; y: number
  width: number; height: number
  zIndex: number
  createdAt: number
  updatedAt: number
}

export interface PromptCard extends BaseCard {
  kind: 'prompt'
  type: 'card'                 // legacy field, kept for backwards compat
  prompt: string
  modelSlot: string
  status: 'idle' | 'streaming' | 'complete' | 'error'
  errorMessage?: string
  response: string
  model: string
  inputTokens?: number
  outputTokens?: number
}

export interface ImageCard extends BaseCard {
  kind: 'image'
  type: 'card'
  fullPath?:  string           // local-only; absent on second device
  thumbPath?: string           // local-only
  width:  number               // already in BaseCard but reaffirmed for clarity
  height: number
  capturedAt: number
  originDeviceId: string
  caption?: string
}

export type Card = PromptCard | ImageCard
```

- [ ] **Step 2: Default existing rows to `kind: 'prompt'`**

In the store factory, in `loadCards`, normalize:

```ts
loadCards: (cards) => {
  const normalized: Record<string, Card> = {}
  for (const [id, c] of Object.entries(cards)) {
    const k = (c as any).kind ?? 'prompt'
    normalized[id] = { ...(c as any), kind: k, updatedAt: (c as any).updatedAt ?? (c as any).createdAt ?? Date.now() }
  }
  const maxZ = Object.values(normalized).reduce((m, c) => Math.max(m, c.zIndex), 0)
  set({ cards: normalized, maxZIndex: maxZ })
},
```

In `addCard`, accept `Omit<Card, 'id' | 'createdAt' | 'zIndex' | 'updatedAt'>`, stamp `updatedAt`.

- [ ] **Step 3: Run all tests**

```bash
pnpm -w test
```

Update any failing test fixtures that constructed a card without `kind` — set `kind: 'prompt'`.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/store/cards.ts
git commit -m "feat(ui): cards store tagged-union (PromptCard | ImageCard) + updatedAt"
```

---

### Task 3.2: `voice.ts` lib (Web Speech path)

**Files:**
- Create: `packages/ui/src/lib/voice.ts`
- Create: `packages/ui/src/lib/voice.test.ts`

- [ ] **Step 1: Write failing test (Web Speech path)**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startDictation } from './voice'

class MockRecognition {
  continuous = false; interimResults = false; lang = ''
  onresult: ((e: any) => void) | null = null
  onerror:  ((e: any) => void) | null = null
  onend:    (() => void) | null = null
  start = vi.fn()
  stop  = vi.fn(() => { this.onend?.() })
  abort = vi.fn()
}

describe('voice — Web Speech path', () => {
  beforeEach(() => {
    ;(globalThis as any).window = globalThis as any
    ;(window as any).SpeechRecognition = MockRecognition
  })

  it('streams partials and resolves with final on stop', async () => {
    const partials: string[] = []
    const handle = await startDictation({ onPartial: (t) => partials.push(t) })
    const rec = (window as any).SpeechRecognition
    // emulate result event
    const inst = (handle as any)._inst as MockRecognition
    inst.onresult?.({ results: [[ { transcript: 'hello', isFinal: false } ]], resultIndex: 0 } as any)
    inst.onresult?.({ results: [[ { transcript: 'hello world', isFinal: true } ]], resultIndex: 0 } as any)
    const { finalText } = await handle.stop()
    expect(partials.length).toBeGreaterThan(0)
    expect(finalText).toBe('hello world')
    expect(rec).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test, expect fail**

- [ ] **Step 3: Implement Web Speech branch (fallback path stubbed for now)**

```ts
export type VoiceError =
  | { kind: 'permission_denied' }
  | { kind: 'no_speech' }
  | { kind: 'network' }
  | { kind: 'transcribe_failed'; status: number }
  | { kind: 'cap_exceeded' }
  | { kind: 'unsupported' }

export interface VoiceHandle {
  stop:  () => Promise<{ finalText: string }>
  abort: () => void
}

export interface StartOpts {
  onPartial?: (text: string) => void
  onFinal?:   (text: string) => void
  onError?:   (e: VoiceError) => void
}

declare global {
  interface Window {
    SpeechRecognition?:        any
    webkitSpeechRecognition?:  any
  }
}

function getSR(): any | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? (window as any).webkitSpeechRecognition ?? null
}

export async function startDictation(opts: StartOpts): Promise<VoiceHandle> {
  const SR = getSR()
  if (SR) return webSpeech(SR, opts)
  return fallback(opts)
}

function webSpeech(SR: any, opts: StartOpts): VoiceHandle {
  const inst = new SR()
  inst.continuous = true
  inst.interimResults = true
  inst.lang = navigator.language || 'en-US'

  let cumulative = ''
  inst.onresult = (e: any) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i][0]
      if (e.results[i].isFinal) cumulative += r.transcript
      else interim += r.transcript
    }
    if (interim) opts.onPartial?.(cumulative + interim)
    else opts.onFinal?.(cumulative)
  }
  inst.onerror = (e: any) => {
    if (e.error === 'not-allowed') opts.onError?.({ kind: 'permission_denied' })
    else if (e.error === 'no-speech') opts.onError?.({ kind: 'no_speech' })
    else if (e.error === 'network')   opts.onError?.({ kind: 'network' })
  }

  let resolveStop: ((v: { finalText: string }) => void) | null = null
  inst.onend = () => { resolveStop?.({ finalText: cumulative }) }
  inst.start()

  const handle: VoiceHandle & { _inst: any } = {
    _inst: inst,
    stop: () => new Promise((res) => { resolveStop = res; inst.stop() }),
    abort: () => { try { inst.abort() } catch {} },
  }
  return handle
}

async function fallback(opts: StartOpts): Promise<VoiceHandle> {
  // Implemented in Task 3.3 (MediaRecorder + Whisper).
  opts.onError?.({ kind: 'unsupported' })
  return { stop: async () => ({ finalText: '' }), abort: () => {} }
}
```

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/lib/voice.ts packages/ui/src/lib/voice.test.ts
git commit -m "feat(ui): voice.ts Web Speech provider"
```

---

### Task 3.3: `voice.ts` MediaRecorder + Whisper fallback

**Files:**
- Modify: `packages/ui/src/lib/voice.ts`
- Modify: `packages/ui/src/lib/voice.test.ts`

- [ ] **Step 1: Add failing test for fallback path**

Append to `voice.test.ts`:

```ts
import { vi } from 'vitest'

describe('voice — fallback path', () => {
  beforeEach(() => {
    ;(window as any).SpeechRecognition = undefined
    ;(window as any).webkitSpeechRecognition = undefined

    const stop = vi.fn()
    const recorder = {
      start: vi.fn(),
      stop, ondataavailable: null as any, onstop: null as any, state: 'inactive',
    }
    ;(globalThis as any).MediaRecorder = vi.fn(() => recorder)
    ;(navigator as any).mediaDevices = { getUserMedia: vi.fn(async () => ({ getTracks: () => [] })) }
    ;(globalThis as any).fetch = vi.fn(async () => new Response(JSON.stringify({ text: 'transcribed' }), { status: 200 }))
  })

  it('hits /api/ai with transcribe=true and returns final text', async () => {
    const handle = await startDictation({})
    const recorder = (MediaRecorder as any).mock.results[0].value
    // simulate stop -> data available -> server response
    setTimeout(() => {
      recorder.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) })
      recorder.onstop?.()
    }, 0)
    const { finalText } = await handle.stop()
    expect(finalText).toBe('transcribed')
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/ai'), expect.objectContaining({ method: 'POST' }))
  })

  it('surfaces 402 as cap_exceeded', async () => {
    ;(globalThis as any).fetch = vi.fn(async () => new Response('cap', { status: 402 }))
    const errors: any[] = []
    const handle = await startDictation({ onError: (e) => errors.push(e) })
    const recorder = (MediaRecorder as any).mock.results[0].value
    setTimeout(() => {
      recorder.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) })
      recorder.onstop?.()
    }, 0)
    await handle.stop()
    expect(errors).toContainEqual({ kind: 'cap_exceeded' })
  })
})
```

- [ ] **Step 2: Run tests, expect fail**

- [ ] **Step 3: Replace `fallback()` with real impl**

```ts
const MAX_RECORD_MS = 60_000

async function fallback(opts: StartOpts): Promise<VoiceHandle> {
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    opts.onError?.({ kind: 'permission_denied' })
    return { stop: async () => ({ finalText: '' }), abort: () => {} }
  }

  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e) => { if (e.data?.size > 0) chunks.push(e.data) }

  let stopResolve: ((v: { finalText: string }) => void) | null = null
  let stopReject: ((e: unknown) => void) | null = null

  const finishUpload = async () => {
    const blob = new Blob(chunks, { type: 'audio/webm' })
    const fd = new FormData()
    fd.append('audio', blob, 'capture.webm')
    fd.append('transcribe', 'true')
    try {
      const apiBase = (globalThis as any).API_BASE_URL ?? ''
      const res = await fetch(`${apiBase}/api/ai`, { method: 'POST', body: fd })
      if (res.status === 402) { opts.onError?.({ kind: 'cap_exceeded' }); stopResolve?.({ finalText: '' }); return }
      if (!res.ok) { opts.onError?.({ kind: 'transcribe_failed', status: res.status }); stopResolve?.({ finalText: '' }); return }
      const body = await res.json() as { text: string }
      opts.onFinal?.(body.text)
      stopResolve?.({ finalText: body.text })
    } catch {
      opts.onError?.({ kind: 'network' })
      stopResolve?.({ finalText: '' })
    } finally {
      stream?.getTracks().forEach((t) => t.stop())
    }
  }

  recorder.onstop = () => { void finishUpload() }
  recorder.start(250)

  const cap = setTimeout(() => { try { recorder.stop() } catch {} }, MAX_RECORD_MS)

  return {
    stop: () => new Promise((res, rej) => {
      stopResolve = res; stopReject = rej
      clearTimeout(cap)
      try { recorder.stop() } catch (e) { rej(e) }
    }),
    abort: () => { clearTimeout(cap); try { recorder.stop() } catch {}; stream?.getTracks().forEach((t) => t.stop()) },
  }
}
```

- [ ] **Step 4: Run tests, expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/lib/voice.ts packages/ui/src/lib/voice.test.ts
git commit -m "feat(ui): voice.ts MediaRecorder fallback with 60s cap + Whisper POST"
```

---

### Task 3.4: `/api/ai` Whisper transcribe branch

**Files:**
- Modify: `apps/web/src/app/api/ai/route.ts`
- Create: `apps/web/tests/integration/api-ai-transcribe.test.ts`

- [ ] **Step 1: Read existing route to find auth resolver + cap check**

```bash
sed -n '1,60p' apps/web/src/app/api/ai/route.ts
```

Capture the names of: the auth helper (`resolveUser` or similar), and the cap-check helper.

- [ ] **Step 2: Write failing integration test**

```ts
import { describe, it, expect } from 'vitest'
import { POST } from '../../src/app/api/ai/route'

const SKIP = !process.env.DATABASE_URL_ADMIN
const d = SKIP ? describe.skip : describe

d('POST /api/ai (transcribe)', () => {
  it('returns 200 + text for an authed user under cap', async () => {
    const fd = new FormData()
    fd.append('audio', new Blob([new Uint8Array([0x1a, 0x45, 0xdf, 0xa3])], { type: 'audio/webm' }))
    fd.append('transcribe', 'true')
    const req = new Request('http://x/api/ai', {
      method: 'POST', body: fd,
      headers: { Authorization: `Bearer ${process.env.TEST_MOBILE_BEARER!}` },
    })
    const res = await POST(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(typeof body.text).toBe('string')
  })

  it('returns 402 when cap is exhausted', async () => {
    // exhaust cap fixture for TEST_USER_ID via direct DB write
    // ... fixture-specific; see apps/web/tests/integration/_fixtures.ts
  })
})
```

- [ ] **Step 3: Implement transcribe branch**

In `apps/web/src/app/api/ai/route.ts`, at the top of `POST`:

```ts
const ct = req.headers.get('content-type') ?? ''
if (ct.includes('multipart/form-data')) {
  const form = await req.formData()
  if (form.get('transcribe') === 'true') {
    const userId = await resolveUser(req)
    if (!userId) return new Response('Unauthorized', { status: 401 })
    const capOk = await checkCap(userId)
    if (!capOk) return new Response('Cap exhausted', { status: 402 })

    const audio = form.get('audio')
    if (!(audio instanceof Blob)) return new Response('audio missing', { status: 400 })

    const ai = getAIGatewayClient()
    const result = await ai.audio.transcriptions.create({
      model: 'whisper-1',
      file: new File([audio], 'capture.webm', { type: 'audio/webm' }),
    })

    const seconds = Math.ceil((result as any).duration ?? 5)
    const cents = Math.ceil((seconds / 60) * 0.6) // $0.006/min => 0.6 cents/min
    await chargeCap(userId, cents, { kind: 'ai_transcribe' })

    return Response.json({ text: result.text })
  }
}
// existing JSON branch follows…
```

(Names `resolveUser`, `checkCap`, `chargeCap`, `getAIGatewayClient` are placeholders — match the names you captured in Step 1.)

- [ ] **Step 4: Run integration test against staging DB**

```bash
DATABASE_URL_ADMIN=$STAGING_URL pnpm --filter ./apps/web test api-ai-transcribe
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/ai/route.ts apps/web/tests/integration/api-ai-transcribe.test.ts
git commit -m "feat(api/ai): transcribe=true branch routes to Whisper, charges cap per-second"
```

---

### Task 3.5: `clipboard-suggest.ts`

**Files:**
- Create: `packages/ui/src/lib/clipboard-suggest.ts`
- Create: `packages/ui/src/lib/clipboard-suggest.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { evaluateClipboard } from './clipboard-suggest'
import { useSettingsStore } from '../store/settings'

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn(async () => 'https://example.com'),
}))

describe('clipboard-suggest', () => {
  beforeEach(() => {
    useSettingsStore.setState({ clipboardSuggestEnabled: true })
    sessionStorage.clear()
  })

  it('returns URL suggestion for a URL', async () => {
    const r = await evaluateClipboard()
    expect(r).toEqual({ kind: 'url', preview: 'https://example.com', hash: expect.any(String) })
  })

  it('returns null when disabled', async () => {
    useSettingsStore.setState({ clipboardSuggestEnabled: false })
    expect(await evaluateClipboard()).toBeNull()
  })

  it('dedups within session', async () => {
    const a = await evaluateClipboard()
    sessionStorage.setItem('1scratch:clipboardSeen', JSON.stringify([a!.hash]))
    expect(await evaluateClipboard()).toBeNull()
  })
})
```

- [ ] **Step 2: Run test, expect fail**

- [ ] **Step 3: Implement**

```ts
import { useSettingsStore } from '../store/settings'

export interface SuggestionDescriptor {
  kind: 'url' | 'text'
  preview: string
  hash: string
}

const SEEN_KEY = '1scratch:clipboardSeen'

function djb2(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(16)
}

function isUrl(s: string): boolean {
  try { new URL(s); return true } catch { return false }
}

export async function evaluateClipboard(): Promise<SuggestionDescriptor | null> {
  if (!useSettingsStore.getState().clipboardSuggestEnabled) return null
  let raw: string
  try {
    const m = await import('@tauri-apps/plugin-clipboard-manager').catch(() => null)
    raw = m ? await m.readText() : ''
  } catch { return null }
  if (!raw) return null
  const trimmed = raw.trim()
  const url = isUrl(trimmed)
  if (!url && trimmed.length <= 20) return null
  const hash = djb2(trimmed)
  const seen: string[] = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]')
  if (seen.includes(hash)) return null
  return { kind: url ? 'url' : 'text', preview: trimmed, hash }
}

export function markSuggestionSeen(hash: string): void {
  const seen: string[] = JSON.parse(sessionStorage.getItem(SEEN_KEY) ?? '[]')
  if (!seen.includes(hash)) seen.push(hash)
  sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen))
}
```

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/lib/clipboard-suggest.ts packages/ui/src/lib/clipboard-suggest.test.ts
git commit -m "feat(ui): clipboard-suggest lib (foreground-only, session de-dup)"
```

---

### Task 3.6: `image-pipeline.ts`

**Files:**
- Create: `packages/ui/src/lib/image-pipeline.ts`
- Create: `packages/ui/src/lib/image-pipeline.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, vi } from 'vitest'
import { processCapturedImage } from './image-pipeline'

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile:  vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff])),
  writeFile: vi.fn(async () => {}),
  remove:    vi.fn(async () => {}),
}))
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => '/tmp/app'),
  join:       vi.fn(async (...parts: string[]) => parts.join('/')),
}))

describe('image-pipeline', () => {
  it('returns full + thumb paths and dimensions', async () => {
    // Mock the canvas pipeline since OffscreenCanvas isn't in jsdom
    ;(globalThis as any).createImageBitmap = vi.fn(async () => ({ width: 4032, height: 3024, close: () => {} }))
    class MockOC {
      width = 0; height = 0
      constructor(w: number, h: number) { this.width = w; this.height = h }
      getContext() { return { drawImage: () => {} } }
      convertToBlob = vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' }))
    }
    ;(globalThis as any).OffscreenCanvas = MockOC
    const r = await processCapturedImage('/tmp/raw.jpg', 'card-1')
    expect(r.fullPath).toContain('card-1.jpg')
    expect(r.thumbPath).toContain('card-1.thumb.jpg')
    expect(r.width).toBe(4032)
    expect(r.height).toBe(3024)
  })
})
```

- [ ] **Step 2: Run test, expect fail**

- [ ] **Step 3: Implement**

```ts
const FULL_MAX = 2048
const THUMB_MAX = 320

export interface ProcessedImage {
  fullPath: string
  thumbPath: string
  width: number
  height: number
}

function fitWithin(w: number, h: number, max: number): { w: number; h: number } {
  const long = Math.max(w, h)
  if (long <= max) return { w, h }
  const scale = max / long
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}

async function encode(bitmap: ImageBitmap, maxLong: number, quality: number): Promise<Blob> {
  const { w, h } = fitWithin(bitmap.width, bitmap.height, maxLong)
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(bitmap, 0, 0, w, h)
  return await canvas.convertToBlob({ type: 'image/jpeg', quality })
}

export async function processCapturedImage(rawPath: string, cardId: string): Promise<ProcessedImage> {
  const fs   = await import('@tauri-apps/plugin-fs')
  const path = await import('@tauri-apps/api/path')

  const bytes = await fs.readFile(rawPath)
  const bitmap = await createImageBitmap(new Blob([bytes]))

  const fullBlob  = await encode(bitmap, FULL_MAX,  0.85)
  const thumbBlob = await encode(bitmap, THUMB_MAX, 0.8)

  const dir = await path.join(await path.appDataDir(), 'images')
  const fullPath  = await path.join(dir, `${cardId}.jpg`)
  const thumbPath = await path.join(dir, `${cardId}.thumb.jpg`)

  await fs.writeFile(fullPath,  new Uint8Array(await fullBlob.arrayBuffer()))
  await fs.writeFile(thumbPath, new Uint8Array(await thumbBlob.arrayBuffer()))
  await fs.remove(rawPath).catch(() => {})

  const w = bitmap.width
  const h = bitmap.height
  bitmap.close?.()
  return { fullPath, thumbPath, width: w, height: h }
}
```

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/lib/image-pipeline.ts packages/ui/src/lib/image-pipeline.test.ts
git commit -m "feat(ui): image-pipeline (EXIF strip via decode-reencode, 2048+320 jpeg)"
```

---

### Task 3.7: `mobile_camera` Rust + Android Kotlin

**Files:**
- Create: `apps/client/src-tauri/src/commands/mobile_camera.rs`
- Create: `apps/client/src-tauri/gen/android/app/src/main/java/ai/scratch/app/MobileCameraPlugin.kt`
- Modify: `apps/client/src-tauri/src/lib.rs`
- Modify: `apps/client/src-tauri/gen/android/app/src/main/AndroidManifest.xml`
- Modify: `apps/client/src-tauri/capabilities/mobile.json`
- Modify: `apps/client/src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Rust command (Android only)**

`mobile_camera.rs`:

```rust
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn mobile_camera<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<String, String> {
    let plugin = app.android_plugin_handle("MobileCameraPlugin").map_err(|e| e.to_string())?;
    let res: serde_json::Value = plugin
        .run_mobile_plugin("capture", serde_json::json!({}))
        .map_err(|e| e.to_string())?;
    let path = res.get("path").and_then(|v| v.as_str()).ok_or_else(|| "missing path".to_string())?;
    Ok(path.to_string())
}

#[cfg(not(target_os = "android"))]
#[tauri::command]
pub async fn mobile_camera() -> Result<String, String> { Err("unsupported".into()) }
```

Add to `commands/mod.rs`: `pub mod mobile_camera;`. Register the handler in `lib.rs` `invoke_handler!`.

- [ ] **Step 2: Android Kotlin plugin**

```kotlin
package ai.scratch.app

import android.app.Activity
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.provider.MediaStore
import androidx.activity.result.ActivityResult
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@TauriPlugin
class MobileCameraPlugin(private val activity: Activity) : Plugin(activity) {
    private var pendingUri: Uri? = null
    private var pendingInvoke: Invoke? = null

    @Command
    fun capture(invoke: Invoke) {
        pendingInvoke = invoke
        val cv = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, "scratch_${System.currentTimeMillis()}.jpg")
            put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
        }
        val uri = activity.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, cv)
        pendingUri = uri
        val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, uri)
        startActivityForResult(invoke, intent, "onCapture")
    }

    @app.tauri.annotation.ActivityCallback
    fun onCapture(invoke: Invoke, result: ActivityResult) {
        val uri = pendingUri
        pendingUri = null
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.reject("cancelled"); return
        }
        // resolve to filesystem path
        val path = resolveContentUri(uri)
        invoke.resolve(JSObject().put("path", path))
    }

    private fun resolveContentUri(uri: Uri): String {
        val proj = arrayOf(MediaStore.Images.Media.DATA)
        activity.contentResolver.query(uri, proj, null, null, null).use { c ->
            if (c != null && c.moveToFirst()) return c.getString(0)
        }
        return uri.toString()
    }
}
```

Register: `registerPlugin(MobileCameraPlugin::class.java)` in `MainActivity.onCreate`.

- [ ] **Step 3: Manifest + capability**

In `AndroidManifest.xml`, inside `<manifest>`:

```xml
<uses-permission android:name="android.permission.CAMERA"/>
<queries>
  <intent>
    <action android:name="android.media.action.IMAGE_CAPTURE"/>
  </intent>
</queries>
```

In `capabilities/mobile.json`, append `"core:webview:default"` if not already present (for capture intent return path).

- [ ] **Step 4: Verify Android build**

```bash
pnpm --filter ./apps/client run android:dev
```

- [ ] **Step 5: Commit**

```bash
git add apps/client/src-tauri/src/commands/mobile_camera.rs apps/client/src-tauri/src/commands/mod.rs apps/client/src-tauri/src/lib.rs apps/client/src-tauri/gen/android/app/src/main/java/ai/scratch/app/MobileCameraPlugin.kt apps/client/src-tauri/gen/android/app/src/main/java/ai/scratch/app/MainActivity.kt apps/client/src-tauri/gen/android/app/src/main/AndroidManifest.xml apps/client/src-tauri/capabilities/mobile.json
git commit -m "feat(android): MobileCameraPlugin (ACTION_IMAGE_CAPTURE) + Rust mobile_camera command"
```

---

### Task 3.8: `Composer`

**Files:**
- Create: `packages/ui/src/components/mobile/capture/Composer.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { SafeArea } from '../shared/SafeArea'

export interface ComposerProps {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onMicTap: () => void
  onCameraTap: () => void
  micState?: 'idle' | 'listening' | 'committing'
  countdown?: number | null
  disabled?: boolean
}

const LINE_HEIGHT = 22
const MIN_LINES = 1
const MAX_LINES = 6

export function Composer(p: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const [translateY, setTranslateY] = useState(0)

  // visualViewport keyboard tracking
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const offset = window.innerHeight - vv.height - vv.offsetTop
      setTranslateY(Math.max(0, offset))
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
  }, [])

  // autogrow
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const lines = Math.min(MAX_LINES, Math.max(MIN_LINES, Math.ceil(el.scrollHeight / LINE_HEIGHT)))
    el.style.height = `${lines * LINE_HEIGHT + 16}px`
  }, [p.value])

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => p.onChange(e.target.value)
  const canSend = p.value.trim().length > 0 && !p.disabled

  return (
    <SafeArea edges={['bottom', 'left', 'right']} style={{ position: 'sticky', bottom: 0, transform: `translateY(${-translateY}px)`, background: '#fff', borderTop: '1px solid #eee' }}>
      <div style={{ padding: 8 }}>
        <textarea
          ref={ref}
          value={p.value}
          onChange={onChange}
          placeholder="Type or speak…"
          rows={1}
          style={{ width: '100%', padding: 12, fontSize: 16, borderRadius: 12, border: '1px solid #ddd', resize: 'none', lineHeight: `${LINE_HEIGHT}px` }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <button aria-label="Camera" onClick={p.onCameraTap} style={{ width: 44, height: 44, fontSize: 22, border: 0, background: 'transparent' }}>📷</button>
          <button
            aria-label="Mic"
            onClick={p.onMicTap}
            style={{ width: 56, height: 56, fontSize: 24, border: 0, background: p.micState === 'listening' ? '#f44' : 'transparent', color: p.micState === 'listening' ? '#fff' : '#000', borderRadius: 28, position: 'relative' }}
          >
            🎙
            {p.countdown != null && (
              <span style={{ position: 'absolute', top: -6, right: -6, fontSize: 11, background: '#000', color: '#fff', borderRadius: 8, padding: '2px 6px' }}>{p.countdown}s</span>
            )}
          </button>
          <div style={{ flex: 1 }} />
          <button
            aria-label="Send"
            disabled={!canSend}
            onClick={p.onSend}
            style={{ width: 44, height: 44, fontSize: 20, border: 0, background: canSend ? '#222' : '#ccc', color: '#fff', borderRadius: 22 }}
          >→</button>
        </div>
      </div>
    </SafeArea>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/capture/Composer.tsx
git commit -m "feat(ui): Composer with visualViewport keyboard tracking + autogrow"
```

---

### Task 3.9: `VoiceDictation`

**Files:**
- Create: `packages/ui/src/components/mobile/capture/VoiceDictation.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useRef, useState } from 'react'
import { startDictation, type VoiceHandle, type VoiceError } from '../../../lib/voice'
import { useSettingsStore } from '../../../store/settings'

export interface VoiceDictationProps {
  onPartial: (text: string) => void
  onFinal:   (text: string) => void
  onError?:  (e: VoiceError) => void
  onStateChange?: (s: 'idle' | 'listening' | 'committing') => void
}

const COUNTDOWN_AT = 50
const MAX_S = 60

export function useVoiceDictation(props: VoiceDictationProps) {
  const reduceMotion = useSettingsStore((s) => s.reduceMotion)
  const handleRef = useRef<VoiceHandle | null>(null)
  const [state, setState] = useState<'idle' | 'listening' | 'committing'>('idle')
  const [countdown, setCountdown] = useState<number | null>(null)
  const elapsedRef = useRef(0)

  useEffect(() => { props.onStateChange?.(state) }, [state])

  const start = async () => {
    if (state !== 'idle') return
    setState('listening')
    elapsedRef.current = 0
    const tick = setInterval(() => {
      elapsedRef.current += 1
      if (elapsedRef.current >= COUNTDOWN_AT) setCountdown(MAX_S - elapsedRef.current)
      if (elapsedRef.current >= MAX_S) { void stop(); clearInterval(tick) }
    }, 1000)
    handleRef.current = await startDictation({
      onPartial: props.onPartial,
      onFinal: props.onFinal,
      onError: (e) => { props.onError?.(e); setState('idle'); clearInterval(tick); setCountdown(null) },
    })
  }
  const stop = async () => {
    if (state !== 'listening') return
    setState('committing')
    setCountdown(null)
    try {
      const r = await handleRef.current?.stop()
      if (r?.finalText) props.onFinal(r.finalText)
    } finally { setState('idle'); handleRef.current = null }
  }
  const toggle = () => { state === 'listening' ? void stop() : void start() }

  return { state, countdown, toggle, reduceMotion }
}
```

(No standalone visual — Composer renders the mic button and consumes this hook's `toggle` + `state` + `countdown`.)

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/capture/VoiceDictation.tsx
git commit -m "feat(ui): useVoiceDictation hook (state machine + 60s countdown)"
```

---

### Task 3.10: `ClipboardSuggestChip`

**Files:**
- Create: `packages/ui/src/components/mobile/capture/ClipboardSuggestChip.tsx`

- [ ] **Step 1: Implement**

```tsx
import type { SuggestionDescriptor } from '../../../lib/clipboard-suggest'
import { markSuggestionSeen } from '../../../lib/clipboard-suggest'

export interface ClipboardSuggestChipProps {
  suggestion: SuggestionDescriptor | null
  onAccept: (preview: string) => void
  onDismiss: () => void
}

export function ClipboardSuggestChip({ suggestion, onAccept, onDismiss }: ClipboardSuggestChipProps) {
  if (!suggestion) return null
  const accept = () => { markSuggestionSeen(suggestion.hash); onAccept(suggestion.preview) }
  const dismiss = () => { markSuggestionSeen(suggestion.hash); onDismiss() }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: '#f3f6fa', borderTop: '1px solid #e0e6ee' }}>
      <span style={{ fontSize: 16 }}>{suggestion.kind === 'url' ? '🔗' : '✎'}</span>
      <button onClick={accept} style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 0, fontSize: 14, color: '#246', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {suggestion.preview}
      </button>
      <button aria-label="Dismiss" onClick={dismiss} style={{ width: 24, height: 24, border: 0, background: 'transparent', fontSize: 16, color: '#888' }}>×</button>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/capture/ClipboardSuggestChip.tsx
git commit -m "feat(ui): ClipboardSuggestChip with accept/dismiss + seen-marking"
```

---

### Task 3.11: `CameraSheet`

**Files:**
- Create: `packages/ui/src/components/mobile/capture/CameraSheet.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { BottomSheet } from '../shared/BottomSheet'
import { processCapturedImage, type ProcessedImage } from '../../../lib/image-pipeline'

export interface CameraSheetProps {
  open: boolean
  onDismiss: () => void
  onSend: (img: ProcessedImage) => void
}

type State =
  | { kind: 'idle' }
  | { kind: 'capturing' }
  | { kind: 'processing'; rawPath: string }
  | { kind: 'ready'; img: ProcessedImage }
  | { kind: 'error'; message: string }

export function CameraSheet({ open, onDismiss, onSend }: CameraSheetProps) {
  const [state, setState] = useState<State>({ kind: 'idle' })

  useEffect(() => {
    if (!open) { setState({ kind: 'idle' }); return }
    setState({ kind: 'capturing' })
    invoke<string>('mobile_camera').then(async (rawPath) => {
      setState({ kind: 'processing', rawPath })
      try {
        const cardId = crypto.randomUUID()
        const img = await processCapturedImage(rawPath, cardId)
        setState({ kind: 'ready', img })
      } catch (e) {
        setState({ kind: 'error', message: String(e) })
      }
    }).catch((e) => setState({ kind: 'error', message: String(e) }))
  }, [open])

  return (
    <BottomSheet open={open} onDismiss={onDismiss}>
      <div style={{ padding: 16 }}>
        {state.kind === 'capturing'  && <p>Opening camera…</p>}
        {state.kind === 'processing' && <p>Processing image…</p>}
        {state.kind === 'error'      && <p style={{ color: '#a33' }}>{state.message}</p>}
        {state.kind === 'ready' && (
          <>
            <img src={`asset://localhost/${state.img.thumbPath}`} alt="captured" style={{ width: '100%', borderRadius: 8 }} />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={onDismiss} style={{ flex: 1, padding: 12, borderRadius: 8 }}>Cancel</button>
              <button onClick={() => onSend(state.img)} style={{ flex: 1, padding: 12, borderRadius: 8, background: '#222', color: '#fff' }}>Send</button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/capture/CameraSheet.tsx
git commit -m "feat(ui): CameraSheet (capture → pipeline → preview → send)"
```

---

### Task 3.12: `RecentStack`

**Files:**
- Create: `packages/ui/src/components/mobile/capture/RecentStack.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useMemo } from 'react'
import { useCardsStore } from '../../../store/cards'
import { useWorkspaceStore } from '../../../store/workspace'
import { useMobileNav } from '../../../store/mobileNav'
import { SwipeActions } from '../shared/SwipeActions'

export function RecentStack() {
  const cards = useCardsStore((s) => s.cards)
  const removeCard = useCardsStore((s) => s.removeCard)
  const setSelected = useCardsStore((s) => s.setSelectedCard)
  const setTab = useMobileNav((s) => s.setTab)

  const sorted = useMemo(
    () => Object.values(cards).sort((a, b) => b.createdAt - a.createdAt).slice(0, 10),
    [cards],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column-reverse', gap: 8, padding: 8, overflowY: 'auto', flex: 1 }}>
      {sorted.map((c) => (
        <SwipeActions key={c.id} leftAction={{ label: 'Delete', color: '#a33', onTrigger: () => removeCard(c.id) }}>
          <button
            onClick={() => { setSelected(c.id); setTab('canvas') }}
            style={{ display: 'block', width: '100%', textAlign: 'left', padding: 12, background: '#fff', border: '1px solid #eee', borderRadius: 12 }}
          >
            <span style={{ fontSize: 11, color: '#888' }}>{new Date(c.createdAt).toLocaleTimeString()}</span>
            <p style={{ margin: '4px 0 0', fontSize: 14, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {c.kind === 'prompt' ? c.prompt : c.kind === 'image' ? '🖼 Image' : ''}
            </p>
          </button>
        </SwipeActions>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/capture/RecentStack.tsx
git commit -m "feat(ui): RecentStack (last 10 cards, swipe-to-delete)"
```

---

### Task 3.13: `QuickCapture` assembly + share-intent focus

**Files:**
- Create: `packages/ui/src/components/mobile/capture/QuickCapture.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useEffect, useState } from 'react'
import { Composer } from './Composer'
import { RecentStack } from './RecentStack'
import { ClipboardSuggestChip } from './ClipboardSuggestChip'
import { CameraSheet } from './CameraSheet'
import { useVoiceDictation } from './VoiceDictation'
import { useShareIntent } from '../../../hooks/useShareIntent'
import { useCardsStore } from '../../../store/cards'
import { useWorkspaceStore } from '../../../store/workspace'
import { evaluateClipboard, type SuggestionDescriptor } from '../../../lib/clipboard-suggest'

export function QuickCapture() {
  const [draft, setDraft] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [suggestion, setSuggestion] = useState<SuggestionDescriptor | null>(null)
  const addCard = useCardsStore((s) => s.addCard)
  const activeTabId = useWorkspaceStore((s) => {
    const sec = s.sections.find((x) => x.id === s.activeSectionId)
    return sec?.activeTabId ?? null
  })

  const { state: micState, countdown, toggle: toggleMic } = useVoiceDictation({
    onPartial: (t) => setDraft(t),
    onFinal:   (t) => setDraft(t),
  })

  const { pendingPayload, consume } = useShareIntent()
  useEffect(() => {
    if (pendingPayload?.kind === 'capture') consume()
  }, [pendingPayload])

  useEffect(() => {
    const refresh = () => evaluateClipboard().then(setSuggestion)
    refresh()
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [])

  const send = () => {
    if (!draft.trim() || !activeTabId) return
    addCard({
      kind: 'prompt',
      type: 'card',
      canvasId: activeTabId,
      x: 100, y: 100, width: 280, height: 200,
      prompt: draft, modelSlot: 'default',
      status: 'idle', response: '', model: '',
    } as any)
    setDraft('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <RecentStack />
      </div>
      <ClipboardSuggestChip
        suggestion={suggestion}
        onAccept={(p) => { setDraft((d) => d ? `${d}\n${p}` : p); setSuggestion(null) }}
        onDismiss={() => setSuggestion(null)}
      />
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={send}
        onMicTap={toggleMic}
        onCameraTap={() => setCameraOpen(true)}
        micState={micState}
        countdown={countdown}
      />
      <CameraSheet
        open={cameraOpen}
        onDismiss={() => setCameraOpen(false)}
        onSend={(img) => {
          if (!activeTabId) return
          addCard({
            kind: 'image',
            type: 'card',
            canvasId: activeTabId,
            x: 100, y: 100, width: 280, height: 200,
            fullPath: img.fullPath, thumbPath: img.thumbPath,
            width: img.width, height: img.height,
            capturedAt: Date.now(),
            originDeviceId: localStorage.getItem('1scratch:device_id') ?? 'unknown',
          } as any)
          setCameraOpen(false)
        }}
      />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/capture/QuickCapture.tsx
git commit -m "feat(ui): QuickCapture surface (composer + voice + camera + clipboard + recent)"
```

---

### Task 3.14: `MobileSignIn`

**Files:**
- Create: `packages/ui/src/components/mobile/auth/MobileSignIn.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState } from 'react'
import { signIn } from '../../../auth/session'
import { SafeArea } from '../shared/SafeArea'

export interface MobileSignInProps {
  onSignedIn: () => void
}

export function MobileSignIn({ onSignedIn }: MobileSignInProps) {
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState<string | null>(null)

  const go = async () => {
    setBusy(true); setErr(null)
    try { await signIn(); onSignedIn() }
    catch (e) { setErr('Sign-in interrupted, try again.') }
    finally { setBusy(false) }
  }

  return (
    <SafeArea edges={['top', 'bottom']} style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <h1 style={{ fontSize: 24, fontWeight: 700 }}>1Scratch</h1>
      <p style={{ color: '#666', marginTop: 8, textAlign: 'center' }}>Capture, think, build — across every device.</p>
      <button
        onClick={go}
        disabled={busy}
        style={{ marginTop: 32, padding: '14px 24px', fontSize: 16, borderRadius: 12, background: '#222', color: '#fff', border: 0 }}
      >
        {busy ? 'Opening browser…' : 'Continue with browser'}
      </button>
      {err && <p style={{ color: '#a33', marginTop: 12 }}>{err}</p>}
    </SafeArea>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/auth/MobileSignIn.tsx
git commit -m "feat(ui): MobileSignIn placeholder"
```

---

### Task 3.15: Wire `MobileShell` content + manual smoke

**Files:**
- Modify: `packages/ui/src/components/mobile/MobileShell.tsx`

- [ ] **Step 1: Replace placeholder content with real surfaces**

```tsx
import { useEffect, useState } from 'react'
import { useMobileNav } from '../../store/mobileNav'
import { BottomTabBar } from './BottomTabBar'
import { SafeArea } from './shared/SafeArea'
import { QuickCapture } from './capture/QuickCapture'
import { MobileSignIn } from './auth/MobileSignIn'
import { loadSession } from '../../auth/session'

export function MobileShell() {
  const tab = useMobileNav((s) => s.tab)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  useEffect(() => { loadSession().then((s) => setSignedIn(!!s)) }, [])

  if (signedIn === null) return null
  if (!signedIn) return <MobileSignIn onSignedIn={() => setSignedIn(true)} />

  return (
    <div data-mobile-shell style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <SafeArea edges={['top']}>
        <header style={{ padding: '8px 16px', fontSize: 14, color: '#666' }}>1Scratch</header>
      </SafeArea>
      <main style={{ flex: 1, overflow: 'hidden' }}>
        {tab === 'capture' && <QuickCapture />}
        {tab === 'canvas'  && <h1 style={{ padding: 16 }}>Canvas (PR 5)</h1>}
        {tab === 'library' && <h1 style={{ padding: 16 }}>Library (PR 4)</h1>}
        {tab === 'you'     && <h1 style={{ padding: 16 }}>You (PR 4)</h1>}
      </main>
      <BottomTabBar />
    </div>
  )
}
```

- [ ] **Step 2: Pixel device manual smoke**

`pnpm android:dev`. Verify: sign-in → capture text → send → card visible in RecentStack. Voice (Web Speech) → partials → final → send. Camera → image card → send. Clipboard with URL → suggest chip → accept → composer populated.

- [ ] **Step 3: Commit + open PR 3**

```bash
git add packages/ui/src/components/mobile/MobileShell.tsx
git commit -m "feat(ui): MobileShell wires QuickCapture + MobileSignIn"
git push
gh pr create --title "Phase 3b PR 3: Quick Capture (composer, voice, camera, clipboard, ImageCard kind)" \
  --body "$(cat <<'EOF'
## Summary
- Cards store tagged-union: PromptCard | ImageCard with updatedAt
- voice.ts: Web Speech + MediaRecorder→Whisper fallback (60s cap, $cap accounting)
- /api/ai transcribe=true branch (multipart, charges per-second)
- clipboard-suggest with foreground-only read + session de-dup
- image-pipeline: EXIF strip + 2048/320 jpeg
- MobileCameraPlugin (ACTION_IMAGE_CAPTURE) + Rust shim
- Composer (autogrow + visualViewport keyboard tracking), VoiceDictation, CameraSheet, ClipboardSuggestChip, RecentStack, MobileSignIn

Spec §3.2 §5

## Test plan
- [x] Vitest green
- [ ] /api/ai integration test against staging DB
- [ ] Pixel: text/voice(WebSpeech)/voice(fallback)/camera/clipboard each create cards
- [ ] Pixel: 60s voice cap auto-stops with countdown
EOF
)"
```

---

## PR 4 — Library + You + FTS5 search

### Task 4.1: `lastTouchedAt` in workspace store

**Files:**
- Modify: `packages/ui/src/store/workspace.ts`

- [ ] **Step 1: Add field to `Tab` interface**

```ts
export interface Tab {
  id: string
  name: string
  sectionId: string
  color?: string | null
  lastTouchedAt?: number          // unix ms; missing on existing rows
}
```

- [ ] **Step 2: Bump on `setActiveTab` and `addTab`**

In `setActiveTab`, after the section update:

```ts
setActiveTab: (sectionId, tabId) => {
  const now = Date.now()
  set((s) => ({
    activeSectionId: sectionId,
    sections: s.sections.map((sec) =>
      sec.id === sectionId
        ? { ...sec, activeTabId: tabId, tabs: sec.tabs.map((t) => t.id === tabId ? { ...t, lastTouchedAt: now } : t) }
        : sec
    ),
  }))
},
```

In `addTab`, stamp `lastTouchedAt: Date.now()`.

- [ ] **Step 3: Verify tsc + tests green**

```bash
pnpm -w tsc -b && pnpm -w test
```

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/store/workspace.ts
git commit -m "feat(workspace): Tab.lastTouchedAt for Continue rail ordering"
```

---

### Task 4.2: Append FTS5 to SQLite schema

**Files:**
- Modify: `apps/client/src/sync/schema.sql`

- [ ] **Step 1: Append**

```sql

-- FTS5 (Phase 3b)
CREATE VIRTUAL TABLE cards_fts USING fts5(
  card_id UNINDEXED,
  content,
  canvas_name,
  section_name,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER cards_fts_ai AFTER INSERT ON cards BEGIN
  INSERT INTO cards_fts(card_id, content, canvas_name, section_name)
  VALUES (new.id,
          coalesce(json_extract(new.payload, '$.prompt'), '') || ' ' ||
          coalesce(json_extract(new.payload, '$.response'), ''),
          (SELECT name FROM canvases WHERE id = new.canvas_id),
          (SELECT s.name FROM sections s
             JOIN canvases c ON c.section_id = s.id
            WHERE c.id = new.canvas_id));
END;

CREATE TRIGGER cards_fts_au AFTER UPDATE ON cards BEGIN
  DELETE FROM cards_fts WHERE card_id = old.id;
  INSERT INTO cards_fts(card_id, content, canvas_name, section_name)
  VALUES (new.id,
          coalesce(json_extract(new.payload, '$.prompt'), '') || ' ' ||
          coalesce(json_extract(new.payload, '$.response'), ''),
          (SELECT name FROM canvases WHERE id = new.canvas_id),
          (SELECT s.name FROM sections s
             JOIN canvases c ON c.section_id = s.id
            WHERE c.id = new.canvas_id));
END;

CREATE TRIGGER cards_fts_ad AFTER DELETE ON cards BEGIN
  DELETE FROM cards_fts WHERE card_id = old.id;
END;
```

- [ ] **Step 2: Verify schema applies on cold start**

```bash
pnpm android:dev
```

(Or desktop dev if Android slow.) Open canvas, write a card, then in DB tool:

```sql
SELECT * FROM cards_fts;
```

Expected: row present.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src/sync/schema.sql
git commit -m "feat(sync): append FTS5 cards_fts virtual table + sync triggers"
```

---

### Task 4.3: `fts.ts` lib

**Files:**
- Create: `packages/ui/src/lib/fts.ts`
- Create: `packages/ui/src/lib/fts.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from 'vitest'
import { rewriteQuery } from './fts'

describe('fts.rewriteQuery', () => {
  it('appends * to each token', () => { expect(rewriteQuery('foo bar')).toBe('foo* bar*') })
  it('strips FTS5 special chars', () => { expect(rewriteQuery('foo:"bar(baz)')).toBe('foo* bar* baz*') })
  it('returns empty for whitespace', () => { expect(rewriteQuery('   ')).toBe('') })
})
```

- [ ] **Step 2: Run test, expect fail**

- [ ] **Step 3: Implement**

```ts
import Database from '@tauri-apps/plugin-sql'

export interface CardHit {
  cardId: string
  canvasId: string
  canvasName: string
  sectionName: string | null
  snippet: string         // contains «highlighted» segments
  rank: number
}

export function rewriteQuery(q: string): string {
  const cleaned = q.replace(/[":()*]/g, ' ').trim().split(/\s+/).filter(Boolean)
  return cleaned.map((t) => `${t}*`).join(' ')
}

export async function searchCards(
  db: Database,
  query: string,
  opts: { sectionId?: string; limit?: number } = {},
): Promise<CardHit[]> {
  const q = rewriteQuery(query)
  if (!q) return []
  const limit = opts.limit ?? 50
  const rows = await db.select<{ id: string; canvas_id: string; cv: string; sn: string | null; snippet: string; rank: number }[]>(
    `SELECT c.id AS id, c.canvas_id AS canvas_id, cv.name AS cv, s.name AS sn,
            snippet(cards_fts, 1, '«', '»', '…', 32) AS snippet,
            bm25(cards_fts) AS rank
       FROM cards_fts
       JOIN cards c ON c.id = cards_fts.card_id
       JOIN canvases cv ON cv.id = c.canvas_id
       LEFT JOIN sections s ON s.id = cv.section_id
      WHERE cards_fts MATCH ?
        AND ($sectionId IS NULL OR cv.section_id = $sectionId)
      ORDER BY rank
      LIMIT $limit`,
    [q, opts.sectionId ?? null, limit],
  )
  return rows.map((r) => ({
    cardId: r.id, canvasId: r.canvas_id,
    canvasName: r.cv, sectionName: r.sn,
    snippet: r.snippet, rank: r.rank,
  }))
}

// Safe render: split on «…» and return alternating plain/highlight segments.
// Avoids dangerouslySetInnerHTML — snippet contains user-controlled content.
export function snippetSegments(snippet: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = []
  let rest = snippet
  while (rest.length) {
    const open = rest.indexOf('«')
    if (open < 0) { out.push({ text: rest, hit: false }); break }
    if (open > 0) out.push({ text: rest.slice(0, open), hit: false })
    const close = rest.indexOf('»', open)
    if (close < 0) { out.push({ text: rest.slice(open + 1), hit: true }); break }
    out.push({ text: rest.slice(open + 1, close), hit: true })
    rest = rest.slice(close + 1)
  }
  return out
}
```

- [ ] **Step 4: Run test, expect pass**

- [ ] **Step 5: Commit**

```bash
git add packages/ui/src/lib/fts.ts packages/ui/src/lib/fts.test.ts
git commit -m "feat(ui): fts.ts wrapper + snippetSegments safe render helper"
```

---

### Task 4.4: `ContinueRail`

**Files:**
- Create: `packages/ui/src/components/mobile/library/ContinueRail.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useMemo } from 'react'
import { useWorkspaceStore } from '../../../store/workspace'
import { useMobileNav } from '../../../store/mobileNav'

export function ContinueRail() {
  const sections = useWorkspaceStore((s) => s.sections)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const setMobileTab = useMobileNav((s) => s.setTab)

  const top = useMemo(() => {
    return sections
      .flatMap((sec) => sec.tabs.map((t) => ({ sec, tab: t, ts: t.lastTouchedAt ?? 0 })))
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 3)
  }, [sections])

  if (top.length === 0) return <p style={{ padding: 16, color: '#888' }}>No recent canvases yet.</p>

  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', padding: 16 }}>
      {top.map(({ sec, tab, ts }) => (
        <button key={tab.id}
          onClick={() => { setActiveTab(sec.id, tab.id); setMobileTab('canvas') }}
          style={{ minWidth: 200, height: 88, padding: 12, borderRadius: 12, background: tab.color ?? '#f6f6f6', border: 0, textAlign: 'left' }}
        >
          <div style={{ fontSize: 11, color: '#666' }}>{sec.name}</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>{tab.name}</div>
          <div style={{ fontSize: 11, color: '#888', marginTop: 8 }}>{ts ? `${Math.round((Date.now() - ts) / 60000)}m ago` : 'never'}</div>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/library/ContinueRail.tsx
git commit -m "feat(ui): ContinueRail (top-3 tabs by lastTouchedAt)"
```

---

### Task 4.5: `SectionTree`

**Files:**
- Create: `packages/ui/src/components/mobile/library/SectionTree.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState } from 'react'
import { useWorkspaceStore } from '../../../store/workspace'
import { useMobileNav } from '../../../store/mobileNav'

export function SectionTree() {
  const sections = useWorkspaceStore((s) => s.sections)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const setMobileTab = useMobileNav((s) => s.setTab)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const toggle = (id: string) => setExpanded((e) => ({ ...e, [id]: !e[id] }))

  return (
    <div>
      {sections.map((sec) => (
        <div key={sec.id}>
          <button
            onClick={() => toggle(sec.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '12px 16px', background: 'transparent', border: 0, textAlign: 'left', fontSize: 13, color: '#666', textTransform: 'uppercase' }}
          >
            <span>{expanded[sec.id] === false ? '▸' : '▾'}</span>
            <span>{sec.name}</span>
          </button>
          {expanded[sec.id] !== false && sec.tabs.map((t) => (
            <button key={t.id}
              onClick={() => { setActiveTab(sec.id, t.id); setMobileTab('canvas') }}
              style={{ display: 'block', width: '100%', padding: '10px 32px', textAlign: 'left', background: 'transparent', border: 0, fontSize: 15 }}>
              {t.name}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/library/SectionTree.tsx
git commit -m "feat(ui): SectionTree mirrors sidebar"
```

---

### Task 4.6: `RecentCards`

**Files:**
- Create: `packages/ui/src/components/mobile/library/RecentCards.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useMemo, useState } from 'react'
import { useCardsStore } from '../../../store/cards'
import { useWorkspaceStore } from '../../../store/workspace'
import { useMobileNav } from '../../../store/mobileNav'

const PAGE = 30

export function RecentCards() {
  const cards = useCardsStore((s) => s.cards)
  const setSelected = useCardsStore((s) => s.setSelectedCard)
  const sections = useWorkspaceStore((s) => s.sections)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const setMobileTab = useMobileNav((s) => s.setTab)
  const [count, setCount] = useState(PAGE)

  const sorted = useMemo(
    () => Object.values(cards).sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt)),
    [cards],
  )
  const slice = sorted.slice(0, count)

  const breadcrumbFor = (canvasId: string) => {
    for (const sec of sections) for (const t of sec.tabs) if (t.id === canvasId) return `${sec.name} · ${t.name}`
    return ''
  }

  const sectionForCanvas = (canvasId: string) => {
    for (const sec of sections) for (const t of sec.tabs) if (t.id === canvasId) return sec.id
    return ''
  }

  return (
    <div>
      {slice.map((c) => (
        <button key={c.id}
          onClick={() => {
            const canvasId = c.canvasId ?? ''
            setSelected(c.id)
            setActiveTab(sectionForCanvas(canvasId), canvasId)
            setMobileTab('canvas')
          }}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', borderBottom: '1px solid #f0f0f0', background: 'transparent', border: 0 }}
        >
          <div style={{ fontSize: 11, color: '#888' }}>{breadcrumbFor(c.canvasId)}</div>
          <p style={{ margin: '4px 0 0', fontSize: 14 }}>
            {c.kind === 'prompt' ? c.prompt.slice(0, 80) : '🖼 Image'}
          </p>
        </button>
      ))}
      {count < sorted.length && (
        <button onClick={() => setCount((n) => n + PAGE)} style={{ width: '100%', padding: 16, color: '#246', background: 'transparent', border: 0 }}>
          Load more
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/library/RecentCards.tsx
git commit -m "feat(ui): RecentCards (paginated by 30)"
```

---

### Task 4.7: `SearchSheet`

**Files:**
- Create: `packages/ui/src/components/mobile/library/SearchSheet.tsx`

- [ ] **Step 1: Implement (renders snippet via segments — no dangerouslySetInnerHTML)**

```tsx
import { useEffect, useState } from 'react'
import Database from '@tauri-apps/plugin-sql'
import { BottomSheet } from '../shared/BottomSheet'
import { searchCards, snippetSegments, type CardHit } from '../../../lib/fts'
import { useCardsStore } from '../../../store/cards'
import { useWorkspaceStore } from '../../../store/workspace'
import { useMobileNav } from '../../../store/mobileNav'

let dbPromise: Promise<Database> | null = null
function db(): Promise<Database> {
  if (!dbPromise) dbPromise = Database.load('sqlite:scratch.db')
  return dbPromise
}

export interface SearchSheetProps {
  open: boolean
  onDismiss: () => void
}

export function SearchSheet({ open, onDismiss }: SearchSheetProps) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<CardHit[]>([])
  const setSelected = useCardsStore((s) => s.setSelectedCard)
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab)
  const sections = useWorkspaceStore((s) => s.sections)
  const setMobileTab = useMobileNav((s) => s.setTab)

  useEffect(() => {
    if (!q.trim()) { setHits([]); return }
    const t = setTimeout(async () => {
      const d = await db()
      const r = await searchCards(d, q)
      setHits(r)
    }, 150)
    return () => clearTimeout(t)
  }, [q])

  const sectionForCanvas = (canvasId: string) => {
    for (const sec of sections) for (const t of sec.tabs) if (t.id === canvasId) return sec.id
    return ''
  }

  const grouped = hits.reduce((acc, h) => {
    const key = h.sectionName ?? '—'
    ;(acc[key] ??= []).push(h)
    return acc
  }, {} as Record<string, CardHit[]>)

  return (
    <BottomSheet open={open} onDismiss={onDismiss} snap={1}>
      <div style={{ padding: 16 }}>
        <input
          autoFocus
          value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search across canvases"
          style={{ width: '100%', padding: 12, fontSize: 16, border: '1px solid #ddd', borderRadius: 8 }}
        />
        <div style={{ marginTop: 12 }}>
          {Object.entries(grouped).map(([sn, list]) => (
            <div key={sn}>
              <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', margin: '8px 0' }}>{sn}</div>
              {list.map((h) => (
                <button key={h.cardId}
                  onClick={() => {
                    setSelected(h.cardId)
                    setActiveTab(sectionForCanvas(h.canvasId), h.canvasId)
                    setMobileTab('canvas')
                    onDismiss()
                  }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 0', background: 'transparent', border: 0, fontSize: 14 }}
                >
                  {snippetSegments(h.snippet).map((seg, i) =>
                    seg.hit
                      ? <mark key={i} style={{ background: '#fef08a', color: 'inherit' }}>{seg.text}</mark>
                      : <span key={i}>{seg.text}</span>,
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </BottomSheet>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/library/SearchSheet.tsx
git commit -m "feat(ui): SearchSheet (debounced FTS5 + safe snippet rendering)"
```

---

### Task 4.8: `Library` assembly

**Files:**
- Create: `packages/ui/src/components/mobile/library/Library.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState } from 'react'
import { ContinueRail } from './ContinueRail'
import { SectionTree } from './SectionTree'
import { RecentCards } from './RecentCards'
import { SearchSheet } from './SearchSheet'

export function Library() {
  const [searchOpen, setSearchOpen] = useState(false)
  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderBottom: '1px solid #eee' }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, flex: 1 }}>Library</h1>
        <button aria-label="Search" onClick={() => setSearchOpen(true)} style={{ width: 44, height: 44, fontSize: 20, border: 0, background: 'transparent' }}>🔍</button>
      </div>
      <div style={{ fontSize: 13, color: '#888', textTransform: 'uppercase', padding: '12px 16px 0' }}>Continue</div>
      <ContinueRail />
      <div style={{ fontSize: 13, color: '#888', textTransform: 'uppercase', padding: '12px 16px 0' }}>Sections</div>
      <SectionTree />
      <div style={{ fontSize: 13, color: '#888', textTransform: 'uppercase', padding: '12px 16px 0' }}>Recent cards</div>
      <RecentCards />
      <SearchSheet open={searchOpen} onDismiss={() => setSearchOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/library/Library.tsx
git commit -m "feat(ui): Library surface assembly"
```

---

### Task 4.9: `DeviceList` + `SettingsRow` + `YouSurface`

**Files:**
- Create: `packages/ui/src/components/mobile/you/DeviceList.tsx`
- Create: `packages/ui/src/components/mobile/you/SettingsRow.tsx`
- Create: `packages/ui/src/components/mobile/you/YouSurface.tsx`

- [ ] **Step 1: SettingsRow**

```tsx
import type { ReactNode } from 'react'

export interface SettingsRowProps {
  label: string
  control: ReactNode
}

export function SettingsRow({ label, control }: SettingsRowProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
      <span style={{ flex: 1, fontSize: 15 }}>{label}</span>
      {control}
    </div>
  )
}
```

- [ ] **Step 2: DeviceList**

```tsx
import { useEffect, useState } from 'react'

interface DeviceSession {
  id: string
  device_label: string | null
  last_used_at: string
  current: boolean
}

async function fetchSessions(): Promise<DeviceSession[]> {
  const apiBase = (globalThis as any).API_BASE_URL ?? ''
  const res = await fetch(`${apiBase}/api/mobile/sessions`)
  if (!res.ok) return []
  return await res.json()
}

async function revoke(id: string): Promise<void> {
  const apiBase = (globalThis as any).API_BASE_URL ?? ''
  await fetch(`${apiBase}/api/mobile/revoke`, { method: 'POST', body: JSON.stringify({ id }) })
}

export function DeviceList() {
  const [list, setList] = useState<DeviceSession[]>([])
  useEffect(() => { fetchSessions().then(setList) }, [])
  return (
    <div>
      {list.map((s) => (
        <div key={s.id} style={{ display: 'flex', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid #f0f0f0' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15 }}>{s.device_label ?? 'Unknown device'}{s.current ? ' (this device)' : ''}</div>
            <div style={{ fontSize: 12, color: '#888' }}>{new Date(s.last_used_at).toLocaleString()}</div>
          </div>
          {!s.current && (
            <button onClick={async () => { await revoke(s.id); setList((l) => l.filter((x) => x.id !== s.id)) }}
              style={{ padding: '8px 12px', border: '1px solid #ddd', borderRadius: 8, background: '#fff' }}>
              Sign out
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: YouSurface**

```tsx
import { useState } from 'react'
import { DeviceList } from './DeviceList'
import { SettingsRow } from './SettingsRow'
import { BottomSheet } from '../shared/BottomSheet'
import SyncDiagnostics from '../../SyncDiagnostics'
import { useSettingsStore } from '../../../store/settings'
import { signOut } from '../../../auth/session'

export function YouSurface() {
  const s = useSettingsStore()
  const [diagOpen, setDiagOpen] = useState(false)

  const Toggle = ({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) => (
    <button onClick={() => onChange(!value)} aria-pressed={value}
      style={{ width: 44, height: 26, borderRadius: 13, background: value ? '#246' : '#ccc', border: 0, position: 'relative' }}>
      <span style={{ position: 'absolute', top: 3, left: value ? 22 : 3, width: 20, height: 20, borderRadius: 10, background: '#fff' }} />
    </button>
  )

  return (
    <div style={{ height: '100%', overflowY: 'auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, padding: '12px 16px', borderBottom: '1px solid #eee' }}>You</h1>

      <div style={{ fontSize: 13, color: '#888', textTransform: 'uppercase', padding: '12px 16px 0' }}>Devices</div>
      <DeviceList />

      <div style={{ fontSize: 13, color: '#888', textTransform: 'uppercase', padding: '12px 16px 0' }}>Sync</div>
      <SettingsRow label="Diagnostics" control={<button onClick={() => setDiagOpen(true)} style={{ background: 'transparent', border: 0, color: '#246' }}>›</button>} />

      <div style={{ fontSize: 13, color: '#888', textTransform: 'uppercase', padding: '12px 16px 0' }}>Settings</div>
      <SettingsRow label="Spatial canvas default" control={<Toggle value={s.spatialOnMobile} onChange={s.setSpatialOnMobile} />} />
      <SettingsRow label="Reduce motion"          control={<Toggle value={s.reduceMotion}     onChange={s.setReduceMotion} />} />
      <SettingsRow label="Smart paste"            control={<Toggle value={s.clipboardSuggestEnabled} onChange={s.setClipboardSuggestEnabled} />} />
      <SettingsRow label="Haptics"                control={<Toggle value={s.hapticsEnabled}    onChange={s.setHapticsEnabled} />} />

      <div style={{ padding: 16 }}>
        <button onClick={() => signOut()} style={{ padding: '12px 20px', border: '1px solid #ddd', borderRadius: 8, background: '#fff' }}>Sign out</button>
      </div>

      <BottomSheet open={diagOpen} onDismiss={() => setDiagOpen(false)} snap={1}>
        <div style={{ padding: 16 }}>
          <SyncDiagnostics />
        </div>
      </BottomSheet>
    </div>
  )
}
```

- [ ] **Step 4: Wire MobileShell**

In `MobileShell.tsx`, replace `Library (PR 4)` and `You (PR 4)` placeholders with `<Library />` and `<YouSurface />`.

- [ ] **Step 5: Commit + open PR 4**

```bash
git add packages/ui/src/components/mobile/you packages/ui/src/components/mobile/library/Library.tsx packages/ui/src/components/mobile/MobileShell.tsx
git commit -m "feat(ui): YouSurface + Library wired into MobileShell"
git push
gh pr create --title "Phase 3b PR 4: Library + You + FTS5 search" \
  --body "$(cat <<'EOF'
## Summary
- workspace.Tab.lastTouchedAt for Continue rail
- FTS5 cards_fts virtual table appended to schema.sql; sync triggers
- fts.ts wrapper + snippetSegments safe render helper
- Library: ContinueRail, SectionTree, RecentCards, SearchSheet
- YouSurface: DeviceList (sessions API), SettingsRow primitives, SyncDiagnostics in BottomSheet

Spec §3.4 §3.5 §6

## Test plan
- [x] fts.test.ts green
- [ ] Pixel: airplane-mode search returns FTS hits
- [ ] Pixel: device list loads, revoke works
EOF
)"
```

---

## PR 5 — Canvas Stack + Spatial

### Task 5.1: per-tab `viewMode` in canvas store

**Files:**
- Modify: `packages/ui/src/store/canvas.ts`

- [ ] **Step 1: Add field**

In the canvas store state, alongside the existing per-tab viewport map, add:

```ts
viewModes: Record<string /* canvasId */, 'stack' | 'spatial'>
setViewMode: (canvasId: string, mode: 'stack' | 'spatial') => void
```

In factory:

```ts
viewModes: {},
setViewMode: (canvasId, mode) => set((s) => ({ viewModes: { ...s.viewModes, [canvasId]: mode } })),
```

- [ ] **Step 2: Default selection helper**

Export a small helper:

```ts
import { useViewport } from '../hooks/useViewport'
import { useSettingsStore } from './settings'

export function useEffectiveViewMode(canvasId: string): 'stack' | 'spatial' {
  const explicit = useCanvasStore((s) => s.viewModes[canvasId])
  const { isMobile } = useViewport()
  const spatialDefault = useSettingsStore((s) => s.spatialOnMobile)
  if (explicit) return explicit
  return isMobile && !spatialDefault ? 'stack' : 'spatial'
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/ui/src/store/canvas.ts
git commit -m "feat(canvas): per-tab viewMode + useEffectiveViewMode hook"
```

---

### Task 5.2: `CanvasHeader`

**Files:**
- Create: `packages/ui/src/components/mobile/canvas/CanvasHeader.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useState } from 'react'
import { useCanvasStore, useEffectiveViewMode } from '../../../store/canvas'
import { useWorkspaceStore } from '../../../store/workspace'
import { useMobileNav } from '../../../store/mobileNav'
import { TabSwitcherSheet } from '../shared/TabSwitcherSheet'

export function CanvasHeader() {
  const setMobileTab = useMobileNav((s) => s.setTab)
  const setViewMode = useCanvasStore((s) => s.setViewMode)
  const sections = useWorkspaceStore((s) => s.sections)

  const activeSection = sections.find((s) => s.tabs.some((t) => t.id === s.activeTabId))
  const activeTab = activeSection?.tabs.find((t) => t.id === activeSection.activeTabId)
  const canvasId = activeTab?.id ?? ''
  const mode = useEffectiveViewMode(canvasId)

  const [switcherOpen, setSwitcherOpen] = useState(false)

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderBottom: '1px solid #eee', background: '#fff' }}>
      <button aria-label="Back" onClick={() => setMobileTab('capture')} style={{ width: 44, height: 44, fontSize: 20, border: 0, background: 'transparent' }}>‹</button>
      <button onClick={() => setSwitcherOpen(true)} style={{ flex: 1, padding: 8, fontSize: 16, fontWeight: 600, border: 0, background: 'transparent', textAlign: 'left' }}>
        {activeTab?.name ?? 'Canvas'}
      </button>
      <div role="tablist" style={{ display: 'flex', border: '1px solid #ddd', borderRadius: 8, overflow: 'hidden' }}>
        <button role="tab" aria-selected={mode === 'stack'}
          onClick={() => setViewMode(canvasId, 'stack')}
          style={{ padding: '6px 10px', border: 0, background: mode === 'stack' ? '#222' : 'transparent', color: mode === 'stack' ? '#fff' : '#222' }}>⊞</button>
        <button role="tab" aria-selected={mode === 'spatial'}
          onClick={() => setViewMode(canvasId, 'spatial')}
          style={{ padding: '6px 10px', border: 0, background: mode === 'spatial' ? '#222' : 'transparent', color: mode === 'spatial' ? '#fff' : '#222' }}>⊡</button>
      </div>
      <TabSwitcherSheet open={switcherOpen} onDismiss={() => setSwitcherOpen(false)} />
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/canvas/CanvasHeader.tsx
git commit -m "feat(ui): CanvasHeader with view-mode toggle + tab switcher"
```

---

### Task 5.3: `ImageCard` body

**Files:**
- Create: `packages/ui/src/components/mobile/canvas/ImageCard.tsx`

- [ ] **Step 1: Implement (handles second-device placeholder)**

```tsx
import type { ImageCard as ImageCardType } from '../../../store/cards'

export interface ImageCardProps {
  card: ImageCardType
  deviceLabel?: string
}

export function ImageCard({ card, deviceLabel }: ImageCardProps) {
  const local = !!card.thumbPath
  if (!local) {
    return (
      <div style={{ padding: 12, background: '#f6f6f6', borderRadius: 8, color: '#666', fontSize: 13 }}>
        🖼 Image · captured on {deviceLabel ?? 'another device'} · {new Date(card.capturedAt).toLocaleString()}
      </div>
    )
  }
  return (
    <img
      src={`asset://localhost/${card.thumbPath}`}
      alt={card.caption ?? 'Captured image'}
      style={{ width: '100%', borderRadius: 8 }}
    />
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/canvas/ImageCard.tsx
git commit -m "feat(ui): ImageCard body with second-device placeholder"
```

---

### Task 5.4: `CardBubble` wrapper

**Files:**
- Create: `packages/ui/src/components/mobile/canvas/CardBubble.tsx`

- [ ] **Step 1: Implement**

```tsx
import type { Card } from '../../../store/cards'
import { ImageCard } from './ImageCard'

export interface CardBubbleProps {
  card: Card
  onTap: () => void
}

export function CardBubble({ card, onTap }: CardBubbleProps) {
  return (
    <button onClick={onTap}
      style={{ display: 'block', width: '100%', textAlign: 'left', padding: 12, background: '#fff', border: '1px solid #eee', borderRadius: 12 }}>
      {card.kind === 'image'
        ? <ImageCard card={card} />
        : (
          <>
            <div style={{ fontSize: 13, color: '#888' }}>{new Date(card.createdAt).toLocaleString()}</div>
            <p style={{ margin: '6px 0 0', fontSize: 14, whiteSpace: 'pre-wrap' }}>{card.prompt}</p>
            {card.response && <p style={{ margin: '6px 0 0', fontSize: 13, color: '#444' }}>{card.response}</p>}
          </>
        )
      }
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/canvas/CardBubble.tsx
git commit -m "feat(ui): CardBubble wrapper (prompt / image kinds)"
```

---

### Task 5.5: `StackView`

**Files:**
- Create: `packages/ui/src/components/mobile/canvas/StackView.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useMemo } from 'react'
import { useCardsStore } from '../../../store/cards'
import { CardBubble } from './CardBubble'
import { SwipeActions } from '../shared/SwipeActions'
import { PullToRefresh } from '../shared/PullToRefresh'

export interface StackViewProps {
  canvasId: string
  onRefresh: () => Promise<void>
}

export function StackView({ canvasId, onRefresh }: StackViewProps) {
  const cards = useCardsStore((s) => s.cards)
  const removeCard = useCardsStore((s) => s.removeCard)
  const setSelected = useCardsStore((s) => s.setSelectedCard)

  const list = useMemo(
    () => Object.values(cards)
      .filter((c) => c.canvasId === canvasId)
      .sort((a, b) => b.zIndex - a.zIndex),
    [cards, canvasId],
  )

  return (
    <PullToRefresh onRefresh={onRefresh}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
        {list.map((c) => (
          <SwipeActions key={c.id}
            leftAction={{ label: 'Delete', color: '#a33', onTrigger: () => removeCard(c.id) }}
            rightAction={{ label: 'Archive', color: '#888', onTrigger: () => removeCard(c.id) }}
          >
            <CardBubble card={c} onTap={() => setSelected(c.id)} />
          </SwipeActions>
        ))}
      </div>
    </PullToRefresh>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/canvas/StackView.tsx
git commit -m "feat(ui): StackView (vertical card list with swipe actions + PullToRefresh)"
```

---

### Task 5.6: `SpatialView`

**Files:**
- Create: `packages/ui/src/components/mobile/canvas/SpatialView.tsx`

- [ ] **Step 1: Implement (wraps existing Canvas)**

```tsx
import Canvas from '../../Canvas/Canvas'

export function SpatialView() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden', touchAction: 'none' }}>
      <Canvas />
    </div>
  )
}
```

(Pinch-zoom + two-finger pan logic lives in `Canvas/Canvas.tsx` — touch-friendly defaults added in Task 5.7.)

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/canvas/SpatialView.tsx
git commit -m "feat(ui): SpatialView wraps existing Canvas with mobile gesture defaults"
```

---

### Task 5.7: Touch-friendly Canvas gestures

**Files:**
- Modify: `packages/ui/src/components/Canvas/Canvas.tsx`

- [ ] **Step 1: Read current Canvas**

```bash
sed -n '1,60p' packages/ui/src/components/Canvas/Canvas.tsx
```

Identify how pan + zoom are wired (likely wheel + drag handlers).

- [ ] **Step 2: Add Pointer Events two-finger pinch**

Add a touch handler block: track active pointers in a `Map<number, { x: number; y: number }>`. On `pointerdown`/`pointermove`/`pointerup` update. When map size === 2, compute centroid + distance to drive `viewport.zoom` and `viewport.panX/Y`. Single-pointer `pointermove` on the background pans (existing). Card hits already short-circuit in their own handlers (PointerDraggable).

Skeleton:

```tsx
const pointers = useRef(new Map<number, { x: number; y: number }>())
const lastPinch = useRef<{ d: number; cx: number; cy: number } | null>(null)

const onPointerDown = (e: React.PointerEvent) => {
  pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.current.size === 2) {
    const [a, b] = [...pointers.current.values()]
    lastPinch.current = { d: dist(a, b), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }
  }
}
const onPointerMove = (e: React.PointerEvent) => {
  const p = pointers.current.get(e.pointerId)
  if (!p) return
  pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
  if (pointers.current.size === 2 && lastPinch.current) {
    const [a, b] = [...pointers.current.values()]
    const d = dist(a, b)
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
    const zoomDelta = d / lastPinch.current.d
    setViewport((v) => ({
      ...v,
      zoom: Math.max(0.5, Math.min(2.5, v.zoom * zoomDelta)),
      panX: v.panX + (cx - lastPinch.current!.cx),
      panY: v.panY + (cy - lastPinch.current!.cy),
    }))
    lastPinch.current = { d, cx, cy }
  }
}
const onPointerUp = (e: React.PointerEvent) => {
  pointers.current.delete(e.pointerId)
  if (pointers.current.size < 2) lastPinch.current = null
}
const dist = (a: {x:number;y:number}, b: {x:number;y:number}) => Math.hypot(a.x-b.x, a.y-b.y)
```

Wire the three handlers onto the existing canvas root element. Keep desktop wheel-zoom path untouched.

- [ ] **Step 3: Verify desktop unchanged**

```bash
pnpm dev
```

Wheel-zoom + drag-pan still work on desktop.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/components/Canvas/Canvas.tsx
git commit -m "feat(canvas): two-finger pinch-zoom + pan via PointerEvents"
```

---

### Task 5.8: `MobileCanvas` assembly

**Files:**
- Create: `packages/ui/src/components/mobile/canvas/MobileCanvas.tsx`

- [ ] **Step 1: Implement**

```tsx
import { CanvasHeader } from './CanvasHeader'
import { StackView } from './StackView'
import { SpatialView } from './SpatialView'
import { useWorkspaceStore } from '../../../store/workspace'
import { useEffectiveViewMode } from '../../../store/canvas'

export function MobileCanvas() {
  const sections = useWorkspaceStore((s) => s.sections)
  const activeSection = sections.find((s) => s.tabs.some((t) => t.id === s.activeTabId))
  const canvasId = activeSection?.activeTabId ?? ''
  const mode = useEffectiveViewMode(canvasId)

  const onRefresh = async () => {
    // PR 6 wires the real sync kick; for now, no-op delay so PullToRefresh resolves
    await new Promise((r) => setTimeout(r, 250))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <CanvasHeader />
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {mode === 'stack' ? <StackView canvasId={canvasId} onRefresh={onRefresh} /> : <SpatialView />}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire in MobileShell**

Replace `Canvas (PR 5)` placeholder with `<MobileCanvas />`.

- [ ] **Step 3: Commit + open PR 5**

```bash
git add packages/ui/src/components/mobile/canvas packages/ui/src/components/mobile/MobileShell.tsx
git commit -m "feat(ui): MobileCanvas assembly + wire into MobileShell"
git push
gh pr create --title "Phase 3b PR 5: Canvas Stack + Spatial" \
  --body "$(cat <<'EOF'
## Summary
- canvas.viewModes per-tab + useEffectiveViewMode hook
- CanvasHeader with view-mode segmented toggle + tab switcher
- StackView (vertical card list, swipe actions, PullToRefresh)
- SpatialView wraps existing Canvas with two-finger pinch + pan
- ImageCard body with second-device placeholder

Spec §3.3 §6.4

## Test plan
- [x] tsc + Vitest green
- [ ] Pixel: 50+ card stack scroll smooth, swipe-actions work
- [ ] Pixel: pinch-zoom 0.5–2.5×, two-finger pan, single-finger drag long-press card
- [ ] Desktop: drag/resize/wheel-zoom unchanged
EOF
)"
```

---

## PR 6 — Sync resilience + Android device DoD

### Task 6.1: Sync engine `persistOnEveryMutation` config

**Files:**
- Modify: `packages/sync-engine/src/*` (locate the outbound queue)

- [ ] **Step 1: Locate queue**

```bash
grep -rn "outbox\|enqueue\|class.*Queue" packages/sync-engine/src
```

Identify the file owning enqueue/dequeue.

- [ ] **Step 2: Add config flag**

Extend the queue config:

```ts
interface OutboundQueueConfig {
  // existing fields…
  persistOnEveryMutation?: boolean
}
```

In `enqueue`, if `persistOnEveryMutation === true`, write to the outbox SQLite table inside the same transaction as the local mutation. In ack handler, delete from outbox in the same transaction.

- [ ] **Step 3: Add cold-start `loadOutbox` hook**

In the engine's bootstrap, when `persistOnEveryMutation: true`:

```ts
const pending = await db.select(`SELECT id, entity_type, entity_id, op, patch, client_version FROM outbox ORDER BY created_at ASC`)
for (const row of pending) queue.replay(row)
```

- [ ] **Step 4: Mobile entrypoint sets the flag**

In `apps/client/src/sync/sync-provider.tsx` (or the mobile bootstrap), pass `persistOnEveryMutation: navigator.userAgent.includes('Android') || isTauriMobile()`.

- [ ] **Step 5: Tests**

`packages/sync-engine/tests/outbox.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { OutboundQueue } from '../src/outbound-queue'

describe('OutboundQueue.persistOnEveryMutation', () => {
  it('writes outbox row on enqueue and removes on ack', async () => { /* … */ })
  it('replays unacked rows on cold start', async () => { /* … */ })
  it('increments retry_count on failure and keeps row', async () => { /* … */ })
  it('desktop default does not write per-mutation', async () => { /* … */ })
})
```

(Fill in the bodies using the existing test fixtures convention.)

- [ ] **Step 6: Commit**

```bash
git add packages/sync-engine
git commit -m "feat(sync-engine): persistOnEveryMutation config + cold-start replay"
```

---

### Task 6.2: Network-change kick

**Files:**
- Modify: `packages/sync-engine/src/*` (locate sync orchestrator)

- [ ] **Step 1: Subscribe to event**

In the sync-provider bootstrap (or the engine itself, with an event source injected):

```ts
let kickTimer: number | null = null
const kick = () => {
  if (kickTimer) return
  kickTimer = window.setTimeout(() => { kickTimer = null; void engine.runCycle() }, 500)
}
window.addEventListener('online', kick)
if ((window as any).__TAURI_INTERNALS__) {
  const { listen } = await import('@tauri-apps/api/event')
  await listen<{ online: boolean }>('network-change', (e) => { if (e.payload.online) kick() })
}
```

- [ ] **Step 2: Test**

```ts
it('debounces network flap to single sync cycle', async () => {
  // mock event source, fire offline+online 100ms apart, assert one cycle
})
```

- [ ] **Step 3: Commit**

```bash
git add packages/sync-engine packages/ui/src/store/sync-bootstrap.ts
git commit -m "feat(sync-engine): debounced sync kick on network-change online transition"
```

---

### Task 6.3: Per-card sync state

**Files:**
- Modify: `packages/ui/src/store/cards.ts`

- [ ] **Step 1: Add helper**

```ts
type SyncState = 'synced' | 'pending' | 'conflict'

interface CardsStateExt {
  syncState: (cardId: string) => SyncState
  conflicts: Set<string>            // cardIds with recent stale rejections
  markConflict: (cardId: string) => void
  pendingIds: Set<string>           // observed from outbox subscription
  setPendingIds: (ids: Set<string>) => void
}
```

`syncState` reads from `pendingIds` and `conflicts`:

```ts
syncState: (id) => {
  const s = get()
  if (s.conflicts.has(id))   return 'conflict'
  if (s.pendingIds.has(id))  return 'pending'
  return 'synced'
},
```

Subscribe to the outbox watcher (added in 6.1) to refresh `pendingIds` whenever the outbox changes.

- [ ] **Step 2: Render pip in CardBubble**

Modify `CardBubble.tsx`:

```tsx
const sync = useCardsStore((s) => s.syncState(card.id))
{sync !== 'synced' && (
  <span aria-label={sync === 'conflict' ? 'Sync conflict' : 'Pending sync'}
    style={{ position: 'absolute', top: 8, right: 8, width: 8, height: 8, borderRadius: 4, background: sync === 'conflict' ? '#a33' : '#dba03c' }} />
)}
```

(Adjust the bubble container to `position: relative`.)

- [ ] **Step 3: Conflict popover (info-only)**

Tap pip → small popover or `alert()` placeholder: "This card was updated on another device — your changes were not applied. Reach out to support if data looks wrong."

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/store/cards.ts packages/ui/src/components/mobile/canvas/CardBubble.tsx
git commit -m "feat(ui): per-card syncState + visual pip + info popover"
```

---

### Task 6.4: Tab-badge dot

**Files:**
- Modify: `packages/ui/src/components/mobile/BottomTabBar.tsx`

- [ ] **Step 1: Subscribe to outbox length**

Add a tiny `useOutboxCount()` hook reading from sync-engine state (or a derived Zustand subscription added in 6.1). Render a 6pt amber dot on Capture + Canvas tab buttons when `outboxCount > 0`.

```tsx
const outboxCount = useOutboxCount()
// inside the button:
{outboxCount > 0 && (t.id === 'capture' || t.id === 'canvas') && (
  <span style={{ position: 'absolute', top: 8, right: '30%', width: 6, height: 6, borderRadius: 3, background: '#dba03c' }} />
)}
```

(Make the button `position: relative`.)

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/BottomTabBar.tsx
git commit -m "feat(ui): tab badge dot on Capture/Canvas while outbox > 0"
```

---

### Task 6.5: SyncBanner final wiring

**Files:**
- Modify: `packages/ui/src/components/mobile/MobileShell.tsx`

- [ ] **Step 1: Compute state from useNetwork + outbox**

```tsx
import { SyncBanner, type SyncBannerState } from './shared/SyncBanner'
import { useNetwork } from '../../hooks/useNetwork'
import { useEffect, useRef, useState } from 'react'

function useSyncBannerState(): SyncBannerState {
  const { online } = useNetwork()
  const outbox = useOutboxCount()
  const [state, setState] = useState<SyncBannerState>('hidden')
  const wasOffline = useRef(false)

  useEffect(() => {
    if (!online) { setState('offline-saved'); wasOffline.current = true; return }
    if (wasOffline.current) {
      setState('reconnecting')
      const t = setTimeout(() => { setState(outbox > 0 ? 'sync-failed' : 'hidden'); wasOffline.current = false }, 2000)
      return () => clearTimeout(t)
    }
    setState(outbox > 0 ? 'hidden' : 'hidden')
  }, [online, outbox])

  return state
}
```

Render `<SyncBanner state={useSyncBannerState()} />` directly under the header in MobileShell.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile/MobileShell.tsx
git commit -m "feat(ui): SyncBanner wired (offline / reconnecting / sync-failed)"
```

---

### Task 6.6: Status-bar theming

**Files:**
- Modify: `packages/ui/src/components/mobile/MobileShell.tsx`
- Modify: `apps/client/src-tauri/src/commands/mobile_status_bar.rs`
- Create: `apps/client/src-tauri/gen/android/app/src/main/java/ai/scratch/app/MobileStatusBarPlugin.kt`

- [ ] **Step 1: Kotlin plugin**

```kotlin
package ai.scratch.app

import android.app.Activity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsControllerCompat
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

@InvokeArg class StatusBarArgs { lateinit var theme: String }

@TauriPlugin
class MobileStatusBarPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun set(invoke: Invoke) {
        val a = invoke.parseArgs(StatusBarArgs::class.java)
        activity.runOnUiThread {
            val win = activity.window
            WindowCompat.setDecorFitsSystemWindows(win, false)
            val ctrl = WindowInsetsControllerCompat(win, win.decorView)
            ctrl.isAppearanceLightStatusBars = a.theme == "light"
        }
        invoke.resolve()
    }
}
```

Register in `MainActivity.onCreate`.

- [ ] **Step 2: Rust shim invokes plugin on Android**

Update `mobile_status_bar.rs`:

```rust
#[cfg(target_os = "android")]
#[tauri::command]
pub async fn mobile_status_bar<R: tauri::Runtime>(app: tauri::AppHandle<R>, theme: String) -> Result<(), String> {
    let plugin = app.android_plugin_handle("MobileStatusBarPlugin").map_err(|e| e.to_string())?;
    plugin.run_mobile_plugin::<()>("set", serde_json::json!({ "theme": theme })).map_err(|e| e.to_string())?;
    Ok(())
}
```

- [ ] **Step 3: MobileShell calls on theme change**

```tsx
import { invoke } from '@tauri-apps/api/core'
import { useSettingsStore } from '../../store/settings'

useEffect(() => {
  const theme = useSettingsStore.getState().theme === 'dark' ? 'dark' : 'light'
  if ((window as any).__TAURI_INTERNALS__) {
    invoke('mobile_status_bar', { theme }).catch(() => {})
  }
}, [/* subscribe to settings.theme */])
```

- [ ] **Step 4: Commit**

```bash
git add apps/client/src-tauri/src/commands/mobile_status_bar.rs apps/client/src-tauri/gen/android/app/src/main/java/ai/scratch/app/MobileStatusBarPlugin.kt apps/client/src-tauri/gen/android/app/src/main/java/ai/scratch/app/MainActivity.kt packages/ui/src/components/mobile/MobileShell.tsx
git commit -m "feat(android): MobileStatusBarPlugin + theme-following icon appearance"
```

---

### Task 6.7: Haptics finalization

**Files:**
- Modify: a few touch-points

- [ ] **Step 1: Wire haptics**

Add `useHaptics().light()` in:
- `BottomTabBar` tab change (already in Task 1.12 ✓)
- `PullToRefresh` threshold cross
- `PointerDraggable` long-press fire (lift)

Add `useHaptics().success()` in `Composer` Send button on click.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile
git commit -m "feat(ui): haptics on PullToRefresh, lift, send"
```

---

### Task 6.8: Reduce-motion compliance audit

**Files:**
- Touch-points across: tab transitions, card lift, mic pulse, banner slide

- [ ] **Step 1: Audit**

In each animation site, gate with:

```ts
import { useSettingsStore } from '../../store/settings'
const reduceMotion = useSettingsStore((s) => s.reduceMotion)
const transition = reduceMotion ? 'opacity 100ms' : 'transform 200ms'
```

Animations that translate become opacity-only when `reduceMotion` is true.

- [ ] **Step 2: Commit**

```bash
git add packages/ui/src/components/mobile
git commit -m "feat(ui): reduce-motion clamps animations to opacity"
```

---

### Task 6.9: A11y target audit script

**Files:**
- Create: `apps/client/tests/e2e/a11y-target-audit.spec.ts`

- [ ] **Step 1: Write Playwright spec**

```ts
import { test, expect } from '@playwright/test'

test('all interactive targets meet 44pt minimum', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('http://localhost:5173')

  const small = await page.evaluate(() => {
    const sels = ['button', 'a', '[role="button"]', '[role="tab"]', 'input', 'select']
    const out: { selector: string; w: number; h: number }[] = []
    for (const sel of sels) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 && r.height === 0) continue
        if (r.width < 44 || r.height < 44) {
          out.push({ selector: el.outerHTML.slice(0, 80), w: r.width, h: r.height })
        }
      }
    }
    return out
  })
  expect(small).toEqual([])
})
```

- [ ] **Step 2: Run, fix violations**

```bash
pnpm --filter ./apps/client exec playwright test a11y-target-audit
```

For any violation, bump padding/min-size to ≥ 44. Mic button to 56.

- [ ] **Step 3: Commit**

```bash
git add apps/client/tests/e2e/a11y-target-audit.spec.ts packages/ui
git commit -m "test(e2e): a11y target audit + fix sub-44pt offenders"
```

---

### Task 6.10: Playwright narrow-window spec

**Files:**
- Create: `apps/client/tests/e2e/mobile-shell.spec.ts`

- [ ] **Step 1: Write spec**

```ts
import { test, expect } from '@playwright/test'

test.describe('mobile shell @ 375x812', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('renders MobileShell, cycles tabs, send creates a card, resize swaps to desktop', async ({ page }) => {
    await page.goto('http://localhost:5173')

    await expect(page.locator('[data-mobile-shell]')).toBeVisible()

    for (const t of ['Capture', 'Canvas', 'Library', 'You']) {
      await page.getByRole('tab', { name: t }).click()
    }
    await page.getByRole('tab', { name: 'Capture' }).click()
    await page.getByPlaceholder('Type or speak…').fill('hello')
    await page.getByRole('button', { name: 'Send' }).click()
    await expect(page.getByText('hello')).toBeVisible()

    await page.setViewportSize({ width: 1200, height: 800 })
    await expect(page.locator('[data-mobile-shell]')).toBeHidden()
  })
})
```

- [ ] **Step 2: Run**

```bash
pnpm --filter ./apps/client exec playwright test mobile-shell
```

- [ ] **Step 3: Commit**

```bash
git add apps/client/tests/e2e/mobile-shell.spec.ts
git commit -m "test(e2e): mobile-shell narrow-window Playwright spec"
```

---

### Task 6.11: Android device runbook

**Files:**
- Create: `docs/runbooks/phase3b-android-device-test.md`

- [ ] **Step 1: Author**

Copy spec §9.3 verbatim as a checklist (22 numbered steps). Each step records pass/fail + notes column.

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/phase3b-android-device-test.md
git commit -m "docs: phase 3b Android device test runbook"
```

---

### Task 6.12: Run runbook + open PR 6

- [ ] **Step 1: Pixel device, top to bottom**

Walk through every step. Record pass/fail. Any fail → fix in branch, re-run failing step.

- [ ] **Step 2: Verify exit gates**

```bash
pnpm -w tsc -b
pnpm -w test
pnpm --filter ./apps/client exec playwright test
grep -r "react-rnd" packages apps   # must be empty
```

- [ ] **Step 3: iOS Simulator build smoke**

```bash
pnpm --filter ./apps/client tauri ios build --debug --no-bundle
```

(Or `ios:dev` to compile in Xcode.) Compile-only.

- [ ] **Step 4: Open PR 6**

```bash
git push
gh pr create --title "Phase 3b PR 6: sync resilience + Android device DoD" \
  --body "$(cat <<'EOF'
## Summary
- sync-engine persistOnEveryMutation + cold-start replay + retry_count
- network-change kick with 500ms debounce
- per-card syncState (synced/pending/conflict) + visual pip + info popover
- BottomTabBar amber dot when outbox > 0
- SyncBanner final wiring (offline/reconnecting/sync-failed)
- MobileStatusBarPlugin + theme-following icons
- Haptics on PullToRefresh threshold, lift, send
- Reduce-motion compliance audit
- Playwright: a11y target audit + mobile-shell narrow-window
- Android runbook authored + executed

Spec §7 §9.3

## Test plan
Attach `docs/runbooks/phase3b-android-device-test.md` completed checklist.

- [x] tsc + Vitest + Playwright green
- [x] grep react-rnd empty
- [x] iOS Simulator build compiles
- [ ] Pixel runbook fully passing
EOF
)"
```

PR 6 ships when runbook fully green and CI green.

---

## Definition of Done (gating PR 6 merge)

Mirrors spec §9.5:

- [ ] All unit tests green
- [ ] Playwright narrow-window + a11y target green in CI
- [ ] Manual Android runbook fully checked, attached to PR 6
- [ ] iOS Simulator build compiles
- [ ] `pnpm -w tsc -b` clean
- [ ] `grep -r react-rnd packages apps` empty
- [ ] Quick Capture round-trip on real Android — text + voice (Web Speech) + camera + clipboard each create cards
- [ ] Stack mode 50+ cards scroll smoothly; reorder via long-press; swipe-actions undo within 5s
- [ ] Spatial pinch-zoom 0.5–2.5× + two-finger pan + long-press drag
- [ ] Library Continue rail surfaces last 3 canvases; recent cards paginate
- [ ] You device list pulls; per-row sign-out revokes
- [ ] 60s airplane + 5 cards reconciles on second device within 10s
- [ ] Keyboard never occludes composer; voice streams while keyboard dismissed
- [ ] Narrow-window desktop ≤ 600pt swaps with no remount; canvas state preserved
- [ ] A11y targets ≥ 44×44 (mic ≥ 56×56), AA contrast, dynamic-type 200% works

---

## Cross-references

- Spec: `docs/superpowers/specs/2026-04-25-phase3b-mobile-touch-ux-design.md`
- 3a plan: `docs/superpowers/plans/2026-04-19-phase3a-mobile-foundation.md`
- 3a spec: `docs/superpowers/specs/2026-04-19-phase3a-mobile-foundation-design.md`
- Sync v1 spec: `docs/superpowers/specs/2026-04-18-sync-v1-design.md`
- PLAN.md §10 Phase 3

