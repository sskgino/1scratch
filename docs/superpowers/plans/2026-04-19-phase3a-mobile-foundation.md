# Phase 3a Mobile Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap the Android-first Tauri Mobile shell, extract a shared `packages/ui` from `apps/client`, ship a thin secure-storage plugin, and wire a browser-handoff Clerk session that issues our own short-lived access JWT + 30-day refresh stored in OS-secure storage.

**Architecture:** Backend-first slice (migration → JWT helper → device-sessions helper → routes → middleware swap → web handoff page) lands a complete server-side auth surface. Client side then refactors `apps/client/src/{components,lib,store}` into `packages/ui`, adds the custom `tauri-plugin-secure-store` (Android `EncryptedSharedPreferences`, iOS Keychain stub, desktop `keyring` fallback), and bootstraps `tauri android init` + `tauri ios init`. Final tasks integrate `signIn`/`signOut`/`loadSession` into the existing `getAuthToken()` so the sync engine works unchanged on a real Android device.

**Tech Stack:** Tauri v2 + tauri-plugin-deep-link/shell/os, Tauri 2 mobile-plugin macros (Kotlin + Swift), `androidx.security:security-crypto`, Apple `Security.framework`, Rust `keyring` crate, Next.js 16 App Router (existing), HS256 JWT via `jose`, Postgres + Drizzle, Vitest.

**Spec:** `docs/superpowers/specs/2026-04-19-phase3a-mobile-foundation-design.md`

---

## Pre-flight: working directory + branches

This plan modifies both `apps/web` and `apps/client` plus introduces two new packages. Work on a single feature branch; commit after each task. Do not mix unrelated changes into the same commit.

```bash
git checkout -b phase3a-mobile-foundation main
pnpm install
pnpm -w tsc -b   # baseline must be green before starting
```

---

## File Structure

**Created:**
- `apps/web/src/db/migrations/0003_device_sessions.sql`
- `apps/web/src/lib/mobile-jwt.ts` + `mobile-jwt.test.ts`
- `apps/web/src/lib/mobile-sessions.ts` + integration test
- `apps/web/src/lib/auth-resolver.ts` + test
- `apps/web/src/app/api/mobile/exchange/route.ts`
- `apps/web/src/app/api/mobile/refresh/route.ts`
- `apps/web/src/app/api/mobile/revoke/route.ts`
- `apps/web/src/app/mobile/handoff/page.tsx`
- `apps/web/tests/integration/mobile-auth.test.ts`
- `packages/ui/package.json`, `tsconfig.json`, `src/index.ts`
- `packages/ui/src/auth/{session,deep-link}.ts` + tests
- `packages/ui/src/secure-store.ts`
- `packages/ui/src/hooks/usePlatform.ts`
- `packages/tauri-plugin-secure-store/Cargo.toml`
- `packages/tauri-plugin-secure-store/src/{lib,desktop,mobile}.rs`
- `packages/tauri-plugin-secure-store/android/.../SecureStorePlugin.kt` + `build.gradle.kts`
- `packages/tauri-plugin-secure-store/ios/Sources/SecureStore/SecureStorePlugin.swift` + `Package.swift`
- `packages/tauri-plugin-secure-store/permissions/{get,set,delete,has}.toml`
- `apps/client/src-tauri/capabilities/mobile.json`

**Modified:**
- `apps/web/src/db/schema.ts` (add `deviceSessions` table)
- `apps/web/src/lib/audit-events.ts` (new event kinds)
- `apps/web/proxy.ts` (relax `isProtectedRoute` for routes that self-gate)
- `apps/web/src/app/api/{sync,ai,providers,model-slots,cap,audit-events,account/delete-{request,cancel},import}/**/*route.ts` (swap `auth()` → `resolveAuthedUserId`)
- `apps/web/src/app/(auth)/sign-in/[[...sign-in]]/page.tsx` (handle `?return=…` cookie write)
- `apps/web/package.json` (add `jose`)
- `apps/client/src-tauri/Cargo.toml` (deep-link + shell + os + secure-store deps)
- `apps/client/src-tauri/src/lib.rs` (register plugins)
- `apps/client/src-tauri/tauri.conf.json` (identifier, deep-link config)
- `apps/client/src-tauri/capabilities/default.json` → renamed `desktop.json` + new perms
- `apps/client/package.json` (android scripts, deep-link/shell/os JS deps)
- `apps/client/src/main.tsx`, `App.tsx`, `sync/{auth-token,sync-provider,migrate-zustand,hydrate,tauri-sqlite-store}.ts` (import rewrites)
- `apps/client/src/sync/auth-token.ts` (rewrite `getAuthToken()` to call `loadSession()`)
- `pnpm-workspace.yaml` — no edit (glob already covers `packages/*`)

**Deleted (after move):** `apps/client/src/{components,lib,store}/**` — moved into `packages/ui/src/*`.

---

## Task 1: Migration `0003_device_sessions.sql`

**Files:**
- Create: `apps/web/src/db/migrations/0003_device_sessions.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase 3a: device sessions (mobile + future desktop). One active row per
-- (user_id, device_id); rotate replaces row in place. Refresh stored as
-- sha256 hex; plaintext returned only at issue time.

CREATE TABLE device_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id text NOT NULL,
  device_label text,
  refresh_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (user_id, device_id)
);

ALTER TABLE device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_sessions FORCE ROW LEVEL SECURITY;

CREATE POLICY device_sessions_owner ON device_sessions
  FOR ALL
  USING (user_id = current_setting('app.user_id', true));

CREATE INDEX device_sessions_refresh_hash_active_idx
  ON device_sessions (refresh_hash) WHERE revoked_at IS NULL;
```

> Note: `users.id` is `text` (Clerk id), per `apps/web/src/db/schema.ts:44`. FK type matches.

- [ ] **Step 2: Apply migration to live Neon**

Use the Neon MCP tool with explicit role (per Phase 2 lesson — see PLAN build log 2026-04-18 step 7-9-10). First statement of the transaction MUST be `SET ROLE neondb_owner`.

Pseudo-call (run via the agent with Neon MCP available):
```
mcp__plugin_neon_neon__run_sql_transaction([
  "SET ROLE neondb_owner",
  "<paste each statement from 0003 migration as a separate string>"
])
```

Expected: all statements succeed, no permission errors.

- [ ] **Step 3: Verify table exists with RLS**

```sql
\d device_sessions       -- via psql or Neon SQL editor
SELECT relname, relrowsecurity, relforcerowsecurity
  FROM pg_class WHERE relname = 'device_sessions';
-- Expect: relrowsecurity=t, relforcerowsecurity=t
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/db/migrations/0003_device_sessions.sql
git commit -m "feat(db): add device_sessions table for mobile auth (0003)"
```

---

## Task 2: Drizzle types for `device_sessions`

**Files:**
- Modify: `apps/web/src/db/schema.ts`

- [ ] **Step 1: Append the table definition**

Add to the bottom of `apps/web/src/db/schema.ts`, after the existing tables and before any trailing comment:

```ts
// ─── Device sessions (mobile + desktop refresh tokens) ──────────────────────

export const deviceSessions = pgTable(
  'device_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    deviceLabel: text('device_label'),
    refreshHash: text('refresh_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => ({
    userDevice: uniqueIndex('device_sessions_user_device_idx').on(t.userId, t.deviceId),
    refreshActive: index('device_sessions_refresh_hash_active_idx').on(t.refreshHash),
  }),
)
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @1scratch/web tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/db/schema.ts
git commit -m "feat(db): drizzle types for device_sessions"
```

---

## Task 3: HS256 JWT helper

**Files:**
- Create: `apps/web/src/lib/mobile-jwt.ts`
- Create: `apps/web/src/lib/mobile-jwt.test.ts`
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add `jose` dep**

Run: `pnpm --filter @1scratch/web add jose`
Expected: `jose` appears under dependencies; lockfile updated.

- [ ] **Step 2: Generate signing key locally + add env**

Generate a key:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Add to `apps/web/.env.development.local`:
```
MOBILE_JWT_SIGNING_KEY=<paste output>
MOBILE_JWT_ISS=https://app.1scratch.ai
```

(Production scoping comes after the manual device pass — Task 30.)

- [ ] **Step 3: Write the failing test**

Create `apps/web/src/lib/mobile-jwt.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'

beforeAll(() => {
  process.env.MOBILE_JWT_SIGNING_KEY ??= Buffer.alloc(32, 1).toString('base64')
  process.env.MOBILE_JWT_ISS = 'https://app.1scratch.ai'
})

describe('mobile-jwt', () => {
  it('signs and verifies an access token round-trip', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./mobile-jwt')
    const jwt = await signAccessToken({ userId: 'user_abc', sessionId: 'sess_1' })
    const payload = await verifyAccessToken(jwt)
    expect(payload.sub).toBe('user_abc')
    expect(payload.sid).toBe('sess_1')
    expect(payload.iss).toBe('https://app.1scratch.ai')
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
  })

  it('rejects a token signed with the wrong key', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./mobile-jwt')
    const original = process.env.MOBILE_JWT_SIGNING_KEY
    const jwt = await signAccessToken({ userId: 'u', sessionId: 's' })
    process.env.MOBILE_JWT_SIGNING_KEY = Buffer.alloc(32, 2).toString('base64')
    await expect(verifyAccessToken(jwt)).rejects.toThrow()
    process.env.MOBILE_JWT_SIGNING_KEY = original
  })

  it('rejects an expired token', async () => {
    const { signAccessToken, verifyAccessToken } = await import('./mobile-jwt')
    const jwt = await signAccessToken({ userId: 'u', sessionId: 's', expiresInSeconds: -1 })
    await expect(verifyAccessToken(jwt)).rejects.toThrow()
  })
})
```

Run: `pnpm --filter @1scratch/web vitest run src/lib/mobile-jwt.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement**

Create `apps/web/src/lib/mobile-jwt.ts`:

```ts
import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

const ALG = 'HS256'
const DEFAULT_TTL_SECONDS = 15 * 60

function signingKey(): Uint8Array {
  const b64 = process.env.MOBILE_JWT_SIGNING_KEY
  if (!b64) throw new Error('MOBILE_JWT_SIGNING_KEY is not set')
  return Uint8Array.from(Buffer.from(b64, 'base64'))
}

function issuer(): string {
  const iss = process.env.MOBILE_JWT_ISS
  if (!iss) throw new Error('MOBILE_JWT_ISS is not set')
  return iss
}

export interface AccessTokenClaims extends JWTPayload {
  sub: string
  sid: string
  iss: string
}

export async function signAccessToken(opts: {
  userId: string
  sessionId: string
  expiresInSeconds?: number
}): Promise<string> {
  const ttl = opts.expiresInSeconds ?? DEFAULT_TTL_SECONDS
  const now = Math.floor(Date.now() / 1000)
  return await new SignJWT({ sid: opts.sessionId })
    .setProtectedHeader({ alg: ALG })
    .setIssuer(issuer())
    .setSubject(opts.userId)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(signingKey())
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  const { payload } = await jwtVerify(token, signingKey(), {
    issuer: issuer(),
    algorithms: [ALG],
  })
  if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
    throw new Error('access token missing sub/sid')
  }
  return payload as AccessTokenClaims
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @1scratch/web vitest run src/lib/mobile-jwt.test.ts`
Expected: 3 PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/mobile-jwt.ts apps/web/src/lib/mobile-jwt.test.ts apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): HS256 mobile access-token helper (sign/verify)"
```

---

## Task 4: `mobile-sessions` helper (CRUD + hash + rotate)

**Files:**
- Create: `apps/web/src/lib/mobile-sessions.ts`
- Create: `apps/web/tests/integration/mobile-sessions.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `apps/web/tests/integration/mobile-sessions.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'

const hasDb = !!process.env.DATABASE_URL_ADMIN
const d = hasDb ? describe : describe.skip

d('mobile-sessions', () => {
  const adminSql = hasDb ? neon(process.env.DATABASE_URL_ADMIN!) : (null as never)
  const users: string[] = []

  beforeAll(() => {
    process.env.MOBILE_JWT_SIGNING_KEY ??= Buffer.alloc(32, 7).toString('base64')
    process.env.MOBILE_JWT_ISS = 'https://app.1scratch.ai'
  })

  afterAll(async () => {
    if (users.length > 0) {
      await adminSql`DELETE FROM users WHERE id = ANY(${users}::text[])`
    }
  })

  async function seedUser(): Promise<string> {
    const id = `user_ms_${randomUUID().slice(0, 8)}`
    users.push(id)
    await adminSql`INSERT INTO users (id, email) VALUES (${id}, ${id + '@test.local'})`
    return id
  }

  it('creates a session row and returns plaintext refresh exactly once', async () => {
    const { createSession } = await import('@/lib/mobile-sessions')
    const userId = await seedUser()
    const out = await createSession({ userId, deviceId: 'dev-1', deviceLabel: 'Pixel 8' })
    expect(out.refreshToken).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    const [row] = await adminSql<{ refresh_hash: string; device_label: string | null }[]>`
      SELECT refresh_hash, device_label FROM device_sessions WHERE id = ${out.sessionId}`
    expect(row.refresh_hash).not.toBe(out.refreshToken)
    expect(row.device_label).toBe('Pixel 8')
  })

  it('rotateSession revokes old row and inserts new one in same tx', async () => {
    const { createSession, rotateSession } = await import('@/lib/mobile-sessions')
    const userId = await seedUser()
    const first = await createSession({ userId, deviceId: 'dev-r' })
    const second = await rotateSession(first.refreshToken)
    expect(second).not.toBeNull()
    expect(second!.refreshToken).not.toBe(first.refreshToken)
    const rows = await adminSql<{ id: string; revoked_at: Date | null }[]>`
      SELECT id, revoked_at FROM device_sessions WHERE user_id = ${userId} ORDER BY created_at`
    expect(rows.length).toBe(2)
    expect(rows[0].revoked_at).not.toBeNull()
    expect(rows[1].revoked_at).toBeNull()
  })

  it('rotateSession returns null for unknown / revoked refresh', async () => {
    const { rotateSession } = await import('@/lib/mobile-sessions')
    expect(await rotateSession('totally-bogus')).toBeNull()
  })

  it('revokeSession marks row revoked', async () => {
    const { createSession, revokeSession } = await import('@/lib/mobile-sessions')
    const userId = await seedUser()
    const s = await createSession({ userId, deviceId: 'dev-x' })
    await revokeSession(s.refreshToken)
    const [row] = await adminSql<{ revoked_at: Date | null }[]>`
      SELECT revoked_at FROM device_sessions WHERE id = ${s.sessionId}`
    expect(row.revoked_at).not.toBeNull()
  })
})
```

Run: `pnpm --filter @1scratch/web vitest run tests/integration/mobile-sessions.test.ts`
Expected: FAIL — `@/lib/mobile-sessions` does not exist.

- [ ] **Step 2: Implement**

Create `apps/web/src/lib/mobile-sessions.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto'
import { sqlAdmin } from '@/db/rls'
import { signAccessToken } from '@/lib/mobile-jwt'

const REFRESH_BYTES = 48

function hashRefresh(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex')
}

function newRefresh(): string {
  return randomBytes(REFRESH_BYTES).toString('base64url')
}

export interface SessionPair {
  sessionId: string
  userId: string
  accessToken: string
  accessExp: number
  refreshToken: string
}

export async function createSession(opts: {
  userId: string
  deviceId: string
  deviceLabel?: string | null
}): Promise<SessionPair> {
  const sql = sqlAdmin()
  const refresh = newRefresh()
  const refreshHash = hashRefresh(refresh)
  // ON CONFLICT (user_id, device_id) DO UPDATE — rotate-in-place if a row already exists.
  const rows = await sql<{ id: string }[]>`
    INSERT INTO device_sessions (user_id, device_id, device_label, refresh_hash)
    VALUES (${opts.userId}, ${opts.deviceId}, ${opts.deviceLabel ?? null}, ${refreshHash})
    ON CONFLICT (user_id, device_id) DO UPDATE
      SET refresh_hash = EXCLUDED.refresh_hash,
          device_label = COALESCE(EXCLUDED.device_label, device_sessions.device_label),
          last_used_at = now(),
          revoked_at = NULL
    RETURNING id`
  const sessionId = rows[0]!.id
  const expiresInSeconds = 15 * 60
  const accessToken = await signAccessToken({ userId: opts.userId, sessionId, expiresInSeconds })
  return {
    sessionId,
    userId: opts.userId,
    accessToken,
    accessExp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    refreshToken: refresh,
  }
}

export async function rotateSession(presentedRefresh: string): Promise<SessionPair | null> {
  const sql = sqlAdmin()
  const refreshHash = hashRefresh(presentedRefresh)
  // Atomic: revoke the existing row by hash, fetch its (user, device), insert a new active row.
  const rows = await sql<{ user_id: string; device_id: string; device_label: string | null }[]>`
    UPDATE device_sessions
       SET revoked_at = now()
     WHERE refresh_hash = ${refreshHash} AND revoked_at IS NULL
   RETURNING user_id, device_id, device_label`
  if (rows.length === 0) return null
  const { user_id: userId, device_id: deviceId, device_label: deviceLabel } = rows[0]!
  return await createSession({ userId, deviceId, deviceLabel })
}

export async function revokeSession(presentedRefresh: string): Promise<void> {
  const sql = sqlAdmin()
  await sql`
    UPDATE device_sessions
       SET revoked_at = now()
     WHERE refresh_hash = ${hashRefresh(presentedRefresh)} AND revoked_at IS NULL`
}

export async function findSessionByRefresh(presentedRefresh: string): Promise<{
  sessionId: string
  userId: string
} | null> {
  const sql = sqlAdmin()
  const rows = await sql<{ id: string; user_id: string }[]>`
    SELECT id, user_id FROM device_sessions
     WHERE refresh_hash = ${hashRefresh(presentedRefresh)} AND revoked_at IS NULL
     LIMIT 1`
  if (rows.length === 0) return null
  return { sessionId: rows[0]!.id, userId: rows[0]!.user_id }
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @1scratch/web vitest run tests/integration/mobile-sessions.test.ts`
Expected: 4 PASS (or skip if no `DATABASE_URL_ADMIN`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/mobile-sessions.ts apps/web/tests/integration/mobile-sessions.test.ts
git commit -m "feat(web): mobile session create/rotate/revoke + hashed refresh"
```

---

## Task 5: `resolveAuthedUserId` helper

**Files:**
- Create: `apps/web/src/lib/auth-resolver.ts`
- Create: `apps/web/src/lib/auth-resolver.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/src/lib/auth-resolver.test.ts`:

```ts
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

beforeAll(() => {
  process.env.MOBILE_JWT_SIGNING_KEY ??= Buffer.alloc(32, 3).toString('base64')
  process.env.MOBILE_JWT_ISS = 'https://app.1scratch.ai'
})

vi.mock('@clerk/nextjs/server', () => ({
  auth: vi.fn(async () => ({ userId: null })),
}))

describe('resolveAuthedUserId', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns userId from a valid mobile bearer JWT', async () => {
    const { signAccessToken } = await import('./mobile-jwt')
    const { resolveAuthedUserId } = await import('./auth-resolver')
    const jwt = await signAccessToken({ userId: 'user_b1', sessionId: 'sess_1' })
    const req = new Request('https://x', { headers: { Authorization: `Bearer ${jwt}` } })
    expect(await resolveAuthedUserId(req)).toBe('user_b1')
  })

  it('falls back to Clerk auth() when no bearer present', async () => {
    const { auth } = await import('@clerk/nextjs/server')
    ;(auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ userId: 'user_clerk' })
    const { resolveAuthedUserId } = await import('./auth-resolver')
    const req = new Request('https://x')
    expect(await resolveAuthedUserId(req)).toBe('user_clerk')
  })

  it('returns null on invalid bearer', async () => {
    const { resolveAuthedUserId } = await import('./auth-resolver')
    const req = new Request('https://x', { headers: { Authorization: 'Bearer not-a-jwt' } })
    expect(await resolveAuthedUserId(req)).toBeNull()
  })

  it('returns null when neither bearer nor Clerk session present', async () => {
    const { resolveAuthedUserId } = await import('./auth-resolver')
    expect(await resolveAuthedUserId(new Request('https://x'))).toBeNull()
  })
})
```

Run: `pnpm --filter @1scratch/web vitest run src/lib/auth-resolver.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 2: Implement**

Create `apps/web/src/lib/auth-resolver.ts`:

```ts
import { auth } from '@clerk/nextjs/server'
import { verifyAccessToken } from './mobile-jwt'

const BEARER_RE = /^Bearer\s+(.+)$/i

export async function resolveAuthedUserId(req: Request): Promise<string | null> {
  const header = req.headers.get('authorization')
  const match = header?.match(BEARER_RE)
  if (match) {
    try {
      const claims = await verifyAccessToken(match[1]!.trim())
      return claims.sub
    } catch {
      return null
    }
  }
  const { userId } = await auth()
  return userId ?? null
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @1scratch/web vitest run src/lib/auth-resolver.test.ts`
Expected: 4 PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/auth-resolver.ts apps/web/src/lib/auth-resolver.test.ts
git commit -m "feat(web): resolveAuthedUserId — bearer-or-Clerk auth gate"
```

---

## Task 6: `POST /api/mobile/exchange`

**Files:**
- Create: `apps/web/src/app/api/mobile/exchange/route.ts`
- Modify: `apps/web/src/lib/audit-events.ts` (add new kinds)
- Test: extends `apps/web/tests/integration/mobile-auth.test.ts` (created here)

- [ ] **Step 1: Add audit-event kinds**

Edit `apps/web/src/lib/audit-events.ts`. In the union type:

```ts
export type AuthEventKind =
  | 'sign_in'
  | 'sign_out'
  | 'credential_add'
  | 'credential_remove'
  | 'credential_verified'
  | 'credential_invalid'
  | 'decrypt_for_use'
  | 'account_delete_request'
  | 'account_delete_confirm'
  | 'account_delete_cancel'
  | 'account_delete_executed'
  | 'scratch_imported'
  | 'oauth_connected'
  | 'mobile_session_created'
  | 'mobile_session_refreshed'
  | 'mobile_session_revoked'
```

- [ ] **Step 2: Write failing integration test**

Create `apps/web/tests/integration/mobile-auth.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'

const hasDb = !!process.env.DATABASE_URL_ADMIN
const d = hasDb ? describe : describe.skip

d('mobile auth routes', () => {
  const adminSql = hasDb ? neon(process.env.DATABASE_URL_ADMIN!) : (null as never)
  const users: string[] = []

  beforeAll(() => {
    process.env.MOBILE_JWT_SIGNING_KEY ??= Buffer.alloc(32, 9).toString('base64')
    process.env.MOBILE_JWT_ISS = 'https://app.1scratch.ai'
  })

  afterAll(async () => {
    if (users.length > 0) await adminSql`DELETE FROM users WHERE id = ANY(${users}::text[])`
  })

  async function seedUser(): Promise<string> {
    const id = `user_mauth_${randomUUID().slice(0, 8)}`
    users.push(id)
    await adminSql`INSERT INTO users (id, email) VALUES (${id}, ${id + '@test.local'})`
    return id
  }

  it('exchange issues access + refresh, audit row written', async () => {
    vi.doMock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: users[users.length] }) }))
    const userId = await seedUser()
    vi.doMock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId }) }))
    const { POST } = await import('@/app/api/mobile/exchange/route')
    const req = new Request('https://x/api/mobile/exchange', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ device_id: 'dev-e1', device_label: 'Pixel 8' }),
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { access_jwt: string; refresh_token: string; user: { id: string } }
    expect(body.access_jwt.split('.').length).toBe(3)
    expect(body.refresh_token.length).toBeGreaterThan(40)
    expect(body.user.id).toBe(userId)
    const audits = await adminSql<{ kind: string }[]>`
      SELECT kind FROM auth_events WHERE user_id = ${userId} AND kind = 'mobile_session_created'`
    expect(audits.length).toBe(1)
    vi.doUnmock('@clerk/nextjs/server')
  })

  it('exchange returns 401 with no Clerk session', async () => {
    vi.doMock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }) }))
    const { POST } = await import('@/app/api/mobile/exchange/route')
    const res = await POST(new Request('https://x', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(401)
    vi.doUnmock('@clerk/nextjs/server')
  })
})
```

Run: `pnpm --filter @1scratch/web vitest run tests/integration/mobile-auth.test.ts`
Expected: FAIL — route module missing.

- [ ] **Step 3: Implement the route**

Create `apps/web/src/app/api/mobile/exchange/route.ts`:

```ts
import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSession } from '@/lib/mobile-sessions'
import { recordAdmin } from '@/lib/audit-events'

const bodySchema = z.object({
  device_id: z.string().min(8).max(64),
  device_label: z.string().max(120).optional(),
})

export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  const { userId } = await auth()
  if (!userId) return new NextResponse('Unauthorized', { status: 401 })

  const json = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.flatten() }, { status: 400 })
  }

  const session = await createSession({
    userId,
    deviceId: parsed.data.device_id,
    deviceLabel: parsed.data.device_label,
  })
  await recordAdmin(userId, 'mobile_session_created', {
    meta: { session_id: session.sessionId, device_id: parsed.data.device_id },
    ua: req.headers.get('user-agent'),
  })

  return NextResponse.json({
    access_jwt: session.accessToken,
    access_exp: session.accessExp,
    refresh_token: session.refreshToken,
    refresh_exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    user: { id: session.userId },
  })
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @1scratch/web vitest run tests/integration/mobile-auth.test.ts`
Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/mobile/exchange/route.ts apps/web/src/lib/audit-events.ts apps/web/tests/integration/mobile-auth.test.ts
git commit -m "feat(web): POST /api/mobile/exchange — issue device session"
```

---

## Task 7: `POST /api/mobile/refresh`

**Files:**
- Create: `apps/web/src/app/api/mobile/refresh/route.ts`
- Test: extends `apps/web/tests/integration/mobile-auth.test.ts`

- [ ] **Step 1: Add failing test**

Append to `mobile-auth.test.ts`:

```ts
  it('refresh rotates the row; old refresh token rejected on re-use', async () => {
    const userId = await seedUser()
    const { createSession } = await import('@/lib/mobile-sessions')
    const first = await createSession({ userId, deviceId: 'dev-rfr' })
    const { POST } = await import('@/app/api/mobile/refresh/route')
    const res1 = await POST(new Request('https://x', {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.refreshToken}` },
    }))
    expect(res1.status).toBe(200)
    const body1 = await res1.json() as { refresh_token: string; access_jwt: string }
    expect(body1.refresh_token).not.toBe(first.refreshToken)
    // Re-using the original refresh now fails:
    const res2 = await POST(new Request('https://x', {
      method: 'POST',
      headers: { Authorization: `Bearer ${first.refreshToken}` },
    }))
    expect(res2.status).toBe(401)
  })

  it('refresh without bearer returns 401', async () => {
    const { POST } = await import('@/app/api/mobile/refresh/route')
    const res = await POST(new Request('https://x', { method: 'POST' }))
    expect(res.status).toBe(401)
  })
```

Run tests; expect 2 new failures (route missing).

- [ ] **Step 2: Implement**

Create `apps/web/src/app/api/mobile/refresh/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { rotateSession } from '@/lib/mobile-sessions'
import { recordAdmin } from '@/lib/audit-events'

const BEARER_RE = /^Bearer\s+(.+)$/i

export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  const header = req.headers.get('authorization')
  const match = header?.match(BEARER_RE)
  if (!match) return new NextResponse('Unauthorized', { status: 401 })

  const rotated = await rotateSession(match[1]!.trim())
  if (!rotated) return new NextResponse('Unauthorized', { status: 401 })

  await recordAdmin(rotated.userId, 'mobile_session_refreshed', {
    meta: { session_id: rotated.sessionId },
    ua: req.headers.get('user-agent'),
  })

  return NextResponse.json({
    access_jwt: rotated.accessToken,
    access_exp: rotated.accessExp,
    refresh_token: rotated.refreshToken,
    refresh_exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    user: { id: rotated.userId },
  })
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @1scratch/web vitest run tests/integration/mobile-auth.test.ts`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/mobile/refresh/route.ts apps/web/tests/integration/mobile-auth.test.ts
git commit -m "feat(web): POST /api/mobile/refresh — rotate refresh token"
```

---

## Task 8: `POST /api/mobile/revoke`

**Files:**
- Create: `apps/web/src/app/api/mobile/revoke/route.ts`
- Test: extends `apps/web/tests/integration/mobile-auth.test.ts`

- [ ] **Step 1: Add failing test**

Append:

```ts
  it('revoke marks row revoked; subsequent refresh fails', async () => {
    const userId = await seedUser()
    const { createSession } = await import('@/lib/mobile-sessions')
    const s = await createSession({ userId, deviceId: 'dev-rev' })
    const { POST: revoke } = await import('@/app/api/mobile/revoke/route')
    const r1 = await revoke(new Request('https://x', {
      method: 'POST', headers: { Authorization: `Bearer ${s.refreshToken}` },
    }))
    expect(r1.status).toBe(204)
    const { POST: refresh } = await import('@/app/api/mobile/refresh/route')
    const r2 = await refresh(new Request('https://x', {
      method: 'POST', headers: { Authorization: `Bearer ${s.refreshToken}` },
    }))
    expect(r2.status).toBe(401)
  })
```

- [ ] **Step 2: Implement**

Create `apps/web/src/app/api/mobile/revoke/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { findSessionByRefresh, revokeSession } from '@/lib/mobile-sessions'
import { recordAdmin } from '@/lib/audit-events'

const BEARER_RE = /^Bearer\s+(.+)$/i

export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  const header = req.headers.get('authorization')
  const match = header?.match(BEARER_RE)
  if (!match) return new NextResponse('Unauthorized', { status: 401 })
  const refresh = match[1]!.trim()

  const sess = await findSessionByRefresh(refresh)
  await revokeSession(refresh)
  if (sess) {
    await recordAdmin(sess.userId, 'mobile_session_revoked', {
      meta: { session_id: sess.sessionId },
      ua: req.headers.get('user-agent'),
    })
  }
  return new NextResponse(null, { status: 204 })
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @1scratch/web vitest run tests/integration/mobile-auth.test.ts`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/mobile/revoke/route.ts apps/web/tests/integration/mobile-auth.test.ts
git commit -m "feat(web): POST /api/mobile/revoke — revoke device session"
```

---

## Task 9: Swap `auth()` → `resolveAuthedUserId(req)` across protected handlers

Existing handlers call `const { userId } = await auth()` directly. Mobile bearer needs to be honored, but the proxy currently 401s before the route runs (`auth.protect()` in `apps/web/proxy.ts`). Two parts: relax proxy and update handlers.

**Files modified:**
- `apps/web/proxy.ts`
- All routes listed in spec §4.5 — `apps/web/src/app/api/sync/{push,pull}/route.ts`, `apps/web/src/app/api/ai/stream/route.ts`, `apps/web/src/app/api/providers/{route.ts,[id]/route.ts,[id]/verify/route.ts}`, `apps/web/src/app/api/model-slots/{route.ts,[slot]/route.ts}`, `apps/web/src/app/api/cap/route.ts`, `apps/web/src/app/api/audit-events/route.ts`, `apps/web/src/app/api/account/delete-request/route.ts`, `apps/web/src/app/api/account/delete-cancel/route.ts`, `apps/web/src/app/api/import/scratch/route.ts`

- [ ] **Step 1: Relax proxy matcher**

Edit `apps/web/proxy.ts`. Remove API route patterns from `isProtectedRoute` (handlers self-gate via `resolveAuthedUserId`); keep `/app(.*)` so unauthed web users still get redirected to sign-in.

```ts
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isProtectedRoute = createRouteMatcher([
  '/app(.*)',
  '/mobile(.*)',
])

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next|\\.well-known/workflow/|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
```

(Note: `/mobile/handoff` must require Clerk session — that's why `/mobile(.*)` stays protected. API-side `/api/mobile/exchange` runs `auth()` directly to enforce Clerk session for the exchange.)

- [ ] **Step 2: Refactor each handler**

Pattern per file (example for `apps/web/src/app/api/sync/push/route.ts`):

```ts
// Before
import { auth } from '@clerk/nextjs/server'
...
const { userId } = await auth()
if (!userId) return new NextResponse('Unauthorized', { status: 401 })

// After
import { resolveAuthedUserId } from '@/lib/auth-resolver'
...
const userId = await resolveAuthedUserId(req)
if (!userId) return new NextResponse('Unauthorized', { status: 401 })
```

Apply to every file in the list above. **Do not** modify `/api/mobile/exchange/route.ts` (it intentionally requires Clerk session, not bearer). **Do not** touch `/api/cron/*`, `/api/webhooks/*`, `/api/account/delete-confirm`, `/api/health`, `/oauth/*`.

For routes that signature is `(req: Request)` — already there in most. Some use `({ params })`-style without `req` — read `req` parameter from the second argument or add it as the first; verify each compiles.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @1scratch/web tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Re-run full test suite**

Run: `pnpm --filter @1scratch/web vitest run`
Expected: all existing tests still PASS (handler shape unchanged from caller perspective).

- [ ] **Step 5: Commit**

```bash
git add apps/web/proxy.ts apps/web/src/app/api/
git commit -m "refactor(web): swap auth() → resolveAuthedUserId; relax proxy for self-gating routes"
```

---

## Task 10: `/sign-in` return cookie + `/mobile/handoff` page

**Files:**
- Modify: `apps/web/src/app/(auth)/sign-in/[[...sign-in]]/page.tsx` (or wherever the existing sign-in page lives — verify with `grep -r "SignIn" apps/web/src/app | head`)
- Create: `apps/web/src/app/mobile/handoff/page.tsx`
- Create: `apps/web/src/app/mobile/handoff/MobileHandoffClient.tsx`

- [ ] **Step 1: Locate the existing sign-in page**

Run: `grep -r '<SignIn' apps/web/src/app | head -5`
Expected: returns the path of the sign-in page using `@clerk/nextjs`'s `<SignIn />` component.

- [ ] **Step 2: Edit the sign-in page to capture `?return`**

In the sign-in page (server component if possible), if `searchParams.return` matches `^1scratch://auth/done(\?|$)`, set an HttpOnly cookie `mobile_return` (path `/`, SameSite=Lax, max-age 600 sec). Then render the existing `<SignIn />` with `forceRedirectUrl="/mobile/handoff"` only when the cookie was set.

```tsx
// Example structure — adapt to existing page
import { cookies } from 'next/headers'
import { SignIn } from '@clerk/nextjs'

const RETURN_RE = /^1scratch:\/\/auth\/done(\?|$)/

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ return?: string }>
}) {
  const params = await searchParams
  const ret = params.return
  let mobile = false
  if (ret && RETURN_RE.test(ret)) {
    const jar = await cookies()
    jar.set('mobile_return', ret, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 600,
    })
    mobile = true
  }
  return (
    <SignIn
      forceRedirectUrl={mobile ? '/mobile/handoff' : undefined}
      signUpForceRedirectUrl={mobile ? '/mobile/handoff' : undefined}
    />
  )
}
```

- [ ] **Step 3: Create `/mobile/handoff` server component**

Create `apps/web/src/app/mobile/handoff/page.tsx`:

```tsx
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { auth } from '@clerk/nextjs/server'
import MobileHandoffClient from './MobileHandoffClient'

export const dynamic = 'force-dynamic'

const RETURN_RE = /^1scratch:\/\/auth\/done(\?|$)/

export default async function MobileHandoffPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  const jar = await cookies()
  const ret = jar.get('mobile_return')?.value
  if (!ret || !RETURN_RE.test(ret)) redirect('/app')
  jar.delete('mobile_return')
  return <MobileHandoffClient returnUrl={ret} />
}
```

- [ ] **Step 4: Create the handoff client component**

Create `apps/web/src/app/mobile/handoff/MobileHandoffClient.tsx`:

```tsx
'use client'

import { useEffect, useState } from 'react'

interface Props { returnUrl: string }

export default function MobileHandoffClient({ returnUrl }: Props) {
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const deviceId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `web-${Date.now()}`
    void (async () => {
      const res = await fetch('/api/mobile/exchange', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ device_id: deviceId, device_label: navigator.userAgent.slice(0, 120) }),
      })
      if (!res.ok) {
        setError(`Exchange failed (${res.status})`)
        return
      }
      const body = (await res.json()) as { access_jwt: string; refresh_token: string; access_exp: number }
      const url = new URL(returnUrl)
      url.searchParams.set('access', body.access_jwt)
      url.searchParams.set('refresh', body.refresh_token)
      url.searchParams.set('exp', String(body.access_exp))
      window.location.replace(url.toString())
    })()
  }, [returnUrl])
  return (
    <main style={{ display: 'grid', placeItems: 'center', minHeight: '60vh' }}>
      {error ? <p style={{ color: '#b00' }}>{error}</p> : <p>Returning to the app…</p>}
    </main>
  )
}
```

> **Note on `device_id`:** the handoff page generates a fresh UUID per visit, but the *real* device id is the one the Tauri client persists in its secure store. The Tauri client picks up its own `device_id` and presents it directly when calling `/api/mobile/exchange`. The web handoff page only triggers when a Tauri client redirects through the browser; the deep-link return drops the browser's `device_id`. **Bug risk:** If we keep this code, the row created by the handoff page is orphaned — never refreshed by the client. Solution: pass the Tauri-side `device_id` through the round-trip. Append `?device_id=…&device_label=…` to the `1scratch://auth/done?return=…` query (Tauri side), have `/sign-in` cookie those values too, and have the handoff page POST them. (Implement in this same task — see Step 5.)

- [ ] **Step 5: Plumb `device_id` through the round-trip**

Update `/sign-in` page to also cookie `mobile_device_id` and `mobile_device_label` from `searchParams.device_id` and `searchParams.device_label`. Update `/mobile/handoff/page.tsx` to read those cookies and pass them as props to `MobileHandoffClient`. Update `MobileHandoffClient` to use the props instead of generating a UUID:

```tsx
interface Props { returnUrl: string; deviceId: string; deviceLabel: string }

export default function MobileHandoffClient({ returnUrl, deviceId, deviceLabel }: Props) {
  // ... use deviceId / deviceLabel directly in the POST body, drop the fallback UUID branch
}
```

The Tauri client opens `https://app.1scratch.ai/sign-in?return=1scratch://auth/done&device_id=<uuid>&device_label=Pixel%208` in Task 25.

- [ ] **Step 6: Manual smoke (no test — UI flow)**

Run web dev server: `pnpm --filter @1scratch/web dev`
Open `http://localhost:3000/sign-in?return=1scratch%3A%2F%2Fauth%2Fdone&device_id=test-1&device_label=Browser+test`
Sign in via any provider.
Expect: redirect to `/mobile/handoff`, then attempted `window.location` to `1scratch://...` (browser will show "this app cannot be opened" — that's fine). Open Network tab → `/api/mobile/exchange` returned 200.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/
git commit -m "feat(web): /mobile/handoff page + sign-in return cookie plumbing"
```

---

## Task 11: `packages/ui` skeleton

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/index.ts`

- [ ] **Step 1: Create package manifest**

Create `packages/ui/package.json`:

```json
{
  "name": "@1scratch/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./components/*": "./src/components/*",
    "./lib/*": "./src/lib/*",
    "./store/*": "./src/store/*",
    "./auth/*": "./src/auth/*",
    "./hooks/*": "./src/hooks/*",
    "./secure-store": "./src/secure-store.ts"
  },
  "dependencies": {
    "@1scratch/sync-engine": "workspace:*",
    "@1scratch/sync-proto": "workspace:*",
    "@1scratch/types": "workspace:*",
    "@anthropic-ai/sdk": "^0.88.0",
    "@tauri-apps/api": "^2",
    "@tauri-apps/plugin-deep-link": "^2",
    "@tauri-apps/plugin-shell": "^2",
    "@tauri-apps/plugin-sql": "^2",
    "nanoid": "^5.1.7",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "react-markdown": "^10.1.0",
    "react-rnd": "^10.5.3",
    "remark-gfm": "^4.0.1",
    "zustand": "^5.0.12"
  },
  "devDependencies": {
    "@types/react": "^19.1.8",
    "@types/react-dom": "^19.1.6",
    "typescript": "~5.8.3"
  }
}
```

- [ ] **Step 2: Create tsconfig**

Create `packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "noEmit": true,
    "jsx": "react-jsx",
    "lib": ["DOM", "DOM.Iterable", "ES2022"],
    "types": ["vite/client"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Create barrel**

Create `packages/ui/src/index.ts`:

```ts
// Re-exports added as files move in (next task).
export {}
```

- [ ] **Step 4: Install**

Run: `pnpm install`
Expected: `@1scratch/ui` linked into workspace.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @1scratch/ui tsc -b`
Expected: PASS (empty package).

- [ ] **Step 6: Commit**

```bash
git add packages/ui/ pnpm-lock.yaml
git commit -m "feat(ui): empty @1scratch/ui workspace package skeleton"
```

---

## Task 12: Move `components`, `lib`, `store` to `packages/ui`

**Files:**
- Move: `apps/client/src/{components,lib,store}/**` → `packages/ui/src/{components,lib,store}/**`

- [ ] **Step 1: Move directories**

```bash
git mv apps/client/src/components packages/ui/src/components
git mv apps/client/src/lib packages/ui/src/lib
git mv apps/client/src/store packages/ui/src/store
```

- [ ] **Step 2: Update barrel**

Edit `packages/ui/src/index.ts`:

```ts
export * from './components/SyncDiagnostics'
// Add other top-level component re-exports as needed by the client
export * as canvasStore from './store/canvas'
export * as cardsStore from './store/cards'
export * as settingsStore from './store/settings'
export * as workspaceStore from './store/workspace'
```

(If consumers import deep paths via `@1scratch/ui/components/Foo`, the barrel can stay sparse.)

- [ ] **Step 3: Verify packages/ui compiles in isolation**

Run: `pnpm --filter @1scratch/ui tsc -b`
Expected: errors come only from cross-imports inside the moved code referencing `apps/client/...` paths — NONE expected, since these subdirs were self-contained. If errors appear, fix the offending import to use a relative path within `packages/ui/src/`.

- [ ] **Step 4: Commit (do NOT update apps/client imports yet — separate task)**

```bash
git commit -m "refactor: move components/lib/store from apps/client into packages/ui"
```

---

## Task 13: Update `apps/client` imports to consume `@1scratch/ui`

**Files:**
- Modify: `apps/client/src/main.tsx`, `App.tsx`, `sync/sync-provider.tsx`, `sync/migrate-zustand.ts`, `sync/hydrate.ts`, `sync/tauri-sqlite-store.ts`, `vite.config.ts` (path alias if used)

- [ ] **Step 1: Add `@1scratch/ui` dependency**

Edit `apps/client/package.json` — add to `dependencies`:

```json
"@1scratch/ui": "workspace:*"
```

Run: `pnpm install`

- [ ] **Step 2: Rewrite imports**

Search-and-replace within `apps/client/src/`:

- `from './components/...'` → `from '@1scratch/ui/components/...'`
- `from './lib/...'`        → `from '@1scratch/ui/lib/...'`
- `from './store/...'`      → `from '@1scratch/ui/store/...'`
- `from '../components/...'`, `../lib/...`, `../store/...` (from `sync/*`) → same as above

Use grep to verify nothing was missed:

```bash
grep -rn "from '\\(\\.\\./\\)*\\(components\\|lib\\|store\\)" apps/client/src/
# Expected: no matches
```

- [ ] **Step 3: Typecheck the whole tree**

Run: `pnpm -w tsc -b`
Expected: PASS.

- [ ] **Step 4: Build the client**

Run: `pnpm --filter @1scratch/client build`
Expected: vite + tsc build produces `apps/client/dist/`.

- [ ] **Step 5: Commit**

```bash
git add apps/client/
git commit -m "refactor(client): consume @1scratch/ui after extraction"
```

---

## Task 14: `tauri-plugin-secure-store` Cargo skeleton + Rust dispatch

**Files:**
- Create: `packages/tauri-plugin-secure-store/Cargo.toml`
- Create: `packages/tauri-plugin-secure-store/src/lib.rs`
- Create: `packages/tauri-plugin-secure-store/src/desktop.rs`
- Create: `packages/tauri-plugin-secure-store/src/mobile.rs`

- [ ] **Step 1: Cargo manifest**

Create `packages/tauri-plugin-secure-store/Cargo.toml`:

```toml
[package]
name = "tauri-plugin-1scratch-secure-store"
version = "0.0.0"
edition = "2021"
description = "Thin secure storage plugin for 1Scratch (Android EncryptedSharedPreferences, iOS Keychain, desktop keyring)"

[dependencies]
tauri = { version = "2", features = [] }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
thiserror = "1"

[target.'cfg(not(any(target_os = "android", target_os = "ios")))'.dependencies]
keyring = "3"
```

- [ ] **Step 2: Plugin lib**

Create `packages/tauri-plugin-secure-store/src/lib.rs`:

```rust
use serde::{Deserialize, Serialize};
use tauri::{plugin::{Builder, TauriPlugin}, Manager, Runtime};

#[cfg(mobile)] mod mobile;
#[cfg(desktop)] mod desktop;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Other(String),
}
impl serde::Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> { s.serialize_str(&self.to_string()) }
}

#[derive(Deserialize)]
struct GetArgs { key: String }
#[derive(Deserialize)]
struct SetArgs { key: String, value: String }
#[derive(Serialize)]
struct GetReturn { value: Option<String> }
#[derive(Serialize)]
struct HasReturn { value: bool }

#[tauri::command]
async fn get<R: Runtime>(_app: tauri::AppHandle<R>, args: GetArgs) -> Result<GetReturn, Error> {
    let value = {
        #[cfg(mobile)]    { mobile::get(&args.key).await.map_err(|e| Error::Other(e.to_string()))? }
        #[cfg(desktop)]   { desktop::get(&args.key).map_err(|e| Error::Other(e.to_string()))? }
    };
    Ok(GetReturn { value })
}

#[tauri::command]
async fn set<R: Runtime>(_app: tauri::AppHandle<R>, args: SetArgs) -> Result<(), Error> {
    #[cfg(mobile)]    { mobile::set(&args.key, &args.value).await.map_err(|e| Error::Other(e.to_string())) }
    #[cfg(desktop)]   { desktop::set(&args.key, &args.value).map_err(|e| Error::Other(e.to_string())) }
}

#[tauri::command]
async fn delete<R: Runtime>(_app: tauri::AppHandle<R>, args: GetArgs) -> Result<(), Error> {
    #[cfg(mobile)]    { mobile::delete(&args.key).await.map_err(|e| Error::Other(e.to_string())) }
    #[cfg(desktop)]   { desktop::delete(&args.key).map_err(|e| Error::Other(e.to_string())) }
}

#[tauri::command]
async fn has<R: Runtime>(_app: tauri::AppHandle<R>, args: GetArgs) -> Result<HasReturn, Error> {
    let v = {
        #[cfg(mobile)]    { mobile::has(&args.key).await.map_err(|e| Error::Other(e.to_string()))? }
        #[cfg(desktop)]   { desktop::has(&args.key).map_err(|e| Error::Other(e.to_string()))? }
    };
    Ok(HasReturn { value: v })
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("secure-store")
        .invoke_handler(tauri::generate_handler![get, set, delete, has])
        .setup(|app, api| {
            let _ = app;
            #[cfg(target_os = "android")] {
                let _ = api.register_android_plugin("app.scratch.securestore", "SecureStorePlugin");
            }
            #[cfg(target_os = "ios")] {
                // Swift-side init function name produced by `tauri ios init` macros.
                extern "C" {
                    fn init_plugin_secure_store(webview: tauri::ipc::Channel<()>) -> *const std::ffi::c_void;
                }
                let _ = api.register_ios_plugin(init_plugin_secure_store);
            }
            Ok(())
        })
        .build()
}
```

> The `register_ios_plugin` extern signature is what `tauri-plugin` 2.x expects. If the Tauri version pinned in `apps/client/src-tauri/Cargo.lock` differs, adjust to match the current `tauri::plugin::PluginApi::register_ios_plugin` signature. The exact name `init_plugin_secure_store` is generated by Swift macros in Task 17.

- [ ] **Step 3: Desktop fallback**

Create `packages/tauri-plugin-secure-store/src/desktop.rs`:

```rust
use keyring::Entry;

const SERVICE: &str = "ai.scratch.app";

pub fn get(key: &str) -> Result<Option<String>, keyring::Error> {
    let entry = Entry::new(SERVICE, key)?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn set(key: &str, value: &str) -> Result<(), keyring::Error> {
    Entry::new(SERVICE, key)?.set_password(value)
}

pub fn delete(key: &str) -> Result<(), keyring::Error> {
    match Entry::new(SERVICE, key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e),
    }
}

pub fn has(key: &str) -> Result<bool, keyring::Error> {
    Ok(get(key)?.is_some())
}
```

- [ ] **Step 4: Mobile dispatch shell**

Create `packages/tauri-plugin-secure-store/src/mobile.rs`:

```rust
// Mobile dispatch is wired through Tauri's mobile plugin macros — the actual
// JNI / Objective-C bridging is generated. These helpers delegate to the
// installed plugin via the AppHandle. In Tauri 2.x mobile, the recommended
// pattern is `app.secure_store().get(...)`. We use a thin handle accessor.

use std::error::Error;

pub async fn get(_key: &str) -> Result<Option<String>, Box<dyn Error + Send + Sync>> {
    Err("secure-store mobile dispatch not yet bound — registered by app.handle()".into())
}
pub async fn set(_key: &str, _value: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    Err("secure-store mobile dispatch not yet bound".into())
}
pub async fn delete(_key: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
    Err("secure-store mobile dispatch not yet bound".into())
}
pub async fn has(_key: &str) -> Result<bool, Box<dyn Error + Send + Sync>> {
    Err("secure-store mobile dispatch not yet bound".into())
}
```

> The mobile dispatch is filled in once Tauri's mobile plugin macros are wired. Tauri 2 mobile generates a strongly-typed handle from `register_android_plugin`/`register_ios_plugin`. Replace the `Err(...)` placeholders with real `app.handle().secure_store().get(key)` calls after Task 17/18 confirms the plugin name is registered. (See https://v2.tauri.app/develop/plugins/develop-mobile/ for the current macro shape.)

- [ ] **Step 5: Cargo build (host)**

Run: `cargo build -p tauri-plugin-1scratch-secure-store`
Expected: PASS (host = desktop, only the desktop branch compiles).

- [ ] **Step 6: Commit**

```bash
git add packages/tauri-plugin-secure-store/
git commit -m "feat(plugin): tauri-plugin-secure-store skeleton (Rust + desktop keyring)"
```

---

## Task 15: Permission TOMLs

**Files:**
- Create: `packages/tauri-plugin-secure-store/permissions/{get,set,delete,has}.toml`
- Create: `packages/tauri-plugin-secure-store/permissions/default.toml`

- [ ] **Step 1: Per-command perms**

For each of `get.toml`, `set.toml`, `delete.toml`, `has.toml`, write (replacing `<cmd>`):

```toml
"$schema" = "schemas/schema.json"

[[permission]]
identifier = "allow-<cmd>"
description = "Allows the secure-store <cmd> command"
commands.allow = ["<cmd>"]
```

- [ ] **Step 2: Default set**

Create `permissions/default.toml`:

```toml
"$schema" = "schemas/schema.json"

[default]
description = "Default permissions for secure-store: read/write/delete/has"
permissions = ["allow-get", "allow-set", "allow-delete", "allow-has"]
```

- [ ] **Step 3: Commit**

```bash
git add packages/tauri-plugin-secure-store/permissions/
git commit -m "feat(plugin): secure-store permission manifests"
```

---

## Task 16: Android Kotlin plugin

**Files:**
- Create: `packages/tauri-plugin-secure-store/android/build.gradle.kts`
- Create: `packages/tauri-plugin-secure-store/android/src/main/kotlin/app/scratch/securestore/SecureStorePlugin.kt`
- Create: `packages/tauri-plugin-secure-store/android/src/main/AndroidManifest.xml`

- [ ] **Step 1: Gradle**

Create `packages/tauri-plugin-secure-store/android/build.gradle.kts`:

```kotlin
plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "app.scratch.securestore"
  compileSdk = 34
  defaultConfig { minSdk = 24 }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  kotlinOptions { jvmTarget = "17" }
}

dependencies {
  implementation("androidx.security:security-crypto:1.1.0-alpha06")
  // The Tauri Android plugin scaffolding provides `app.tauri:tauri-android` via
  // the parent project — included transitively when used inside `gen/android`.
}
```

- [ ] **Step 2: AndroidManifest**

Create `packages/tauri-plugin-secure-store/android/src/main/AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android" />
```

- [ ] **Step 3: Kotlin plugin**

Create `.../SecureStorePlugin.kt`:

```kotlin
package app.scratch.securestore

import android.app.Activity
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin

@InvokeArg
class GetArgs { lateinit var key: String }

@InvokeArg
class SetArgs {
    lateinit var key: String
    lateinit var value: String
}

@TauriPlugin
class SecureStorePlugin(private val activity: Activity) : Plugin(activity) {
    private val prefs by lazy {
        val mk = MasterKey.Builder(activity)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            activity,
            "scratch_secure",
            mk,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    @Command
    fun get(invoke: Invoke) {
        val args = invoke.parseArgs(GetArgs::class.java)
        val v = prefs.getString(args.key, null)
        val out = JSObject()
        if (v != null) out.put("value", v) else out.put("value", JSObject.NULL)
        invoke.resolve(out)
    }

    @Command
    fun set(invoke: Invoke) {
        val args = invoke.parseArgs(SetArgs::class.java)
        prefs.edit().putString(args.key, args.value).apply()
        invoke.resolve()
    }

    @Command
    fun delete(invoke: Invoke) {
        val args = invoke.parseArgs(GetArgs::class.java)
        prefs.edit().remove(args.key).apply()
        invoke.resolve()
    }

    @Command
    fun has(invoke: Invoke) {
        val args = invoke.parseArgs(GetArgs::class.java)
        invoke.resolve(JSObject().put("value", prefs.contains(args.key)))
    }
}
```

> The `app.tauri.*` annotations come from `tauri-android`, which is on the classpath inside `apps/client/src-tauri/gen/android` after `tauri android init`. The plugin won't compile standalone — only as part of an Android build invoked by `tauri android dev/build`.

- [ ] **Step 4: Commit**

```bash
git add packages/tauri-plugin-secure-store/android/
git commit -m "feat(plugin): Android Kotlin SecureStorePlugin (EncryptedSharedPreferences)"
```

---

## Task 17: iOS Swift plugin (stub)

**Files:**
- Create: `packages/tauri-plugin-secure-store/ios/Package.swift`
- Create: `packages/tauri-plugin-secure-store/ios/Sources/SecureStore/SecureStorePlugin.swift`

- [ ] **Step 1: SwiftPM manifest**

Create `packages/tauri-plugin-secure-store/ios/Package.swift`:

```swift
// swift-tools-version:5.9
import PackageDescription

let package = Package(
  name: "tauri-plugin-secure-store",
  platforms: [.iOS(.v14)],
  products: [.library(name: "tauri-plugin-secure-store", type: .static, targets: ["tauri-plugin-secure-store"])],
  dependencies: [
    .package(name: "Tauri", path: "../../../apps/client/src-tauri/gen/apple/Tauri"),
  ],
  targets: [
    .target(name: "tauri-plugin-secure-store", dependencies: [.byName(name: "Tauri")], path: "Sources/SecureStore"),
  ]
)
```

> The `Tauri` package path resolves once `tauri ios init` runs (Task 26). Until then, the Swift package is unbuildable — that's OK; iOS init is required before a real Xcode build.

- [ ] **Step 2: Swift plugin (stub)**

Create `Sources/SecureStore/SecureStorePlugin.swift`:

```swift
import SwiftRs
import Tauri
import UIKit
import WebKit
import Security

class GetArgs: Decodable { let key: String }
class SetArgs: Decodable { let key: String; let value: String }

class SecureStorePlugin: Plugin {
  private let service = "ai.scratch.app.secure-store"

  @objc public func get(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(GetArgs.self)
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: args.key,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: AnyObject?
    let status = SecItemCopyMatching(q as CFDictionary, &out)
    if status == errSecItemNotFound {
      invoke.resolve(["value": NSNull()])
      return
    }
    guard status == errSecSuccess, let data = out as? Data, let value = String(data: data, encoding: .utf8) else {
      invoke.reject("keychain read failed (\(status))")
      return
    }
    invoke.resolve(["value": value])
  }

  @objc public func set(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(SetArgs.self)
    let value = args.value.data(using: .utf8) ?? Data()
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: args.key,
    ]
    SecItemDelete(q as CFDictionary)
    var add = q
    add[kSecValueData as String] = value
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    let status = SecItemAdd(add as CFDictionary, nil)
    if status == errSecSuccess { invoke.resolve() } else { invoke.reject("keychain write failed (\(status))") }
  }

  @objc public func delete(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(GetArgs.self)
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: args.key,
    ]
    SecItemDelete(q as CFDictionary)
    invoke.resolve()
  }

  @objc public func has(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(GetArgs.self)
    let q: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: args.key,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    let status = SecItemCopyMatching(q as CFDictionary, nil)
    invoke.resolve(["value": status == errSecSuccess])
  }
}

@_cdecl("init_plugin_secure_store")
func initPlugin() -> Plugin { return SecureStorePlugin() }
```

- [ ] **Step 3: Commit**

```bash
git add packages/tauri-plugin-secure-store/ios/
git commit -m "feat(plugin): iOS Keychain SecureStorePlugin (Swift)"
```

---

## Task 18: `secureStore` JS API

**Files:**
- Create: `packages/ui/src/secure-store.ts`
- Create: `packages/ui/src/secure-store.test.ts`

- [ ] **Step 1: Write failing test (mocks `invoke`)**

Create `packages/ui/src/secure-store.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invokeMock = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }))

beforeEach(() => invokeMock.mockReset())

describe('secureStore', () => {
  it('get unwraps { value }', async () => {
    invokeMock.mockResolvedValue({ value: 'hello' })
    const { secureStore } = await import('./secure-store')
    expect(await secureStore.get('k')).toBe('hello')
    expect(invokeMock).toHaveBeenCalledWith('plugin:secure-store|get', { key: 'k' })
  })

  it('get returns null when value is null', async () => {
    invokeMock.mockResolvedValue({ value: null })
    const { secureStore } = await import('./secure-store')
    expect(await secureStore.get('k')).toBeNull()
  })

  it('set forwards key + value', async () => {
    invokeMock.mockResolvedValue(undefined)
    const { secureStore } = await import('./secure-store')
    await secureStore.set('k', 'v')
    expect(invokeMock).toHaveBeenCalledWith('plugin:secure-store|set', { key: 'k', value: 'v' })
  })

  it('has unwraps { value: bool }', async () => {
    invokeMock.mockResolvedValue({ value: true })
    const { secureStore } = await import('./secure-store')
    expect(await secureStore.has('k')).toBe(true)
  })
})
```

- [ ] **Step 2: Add vitest to packages/ui**

Edit `packages/ui/package.json` `devDependencies`:

```json
"vitest": "^2.1.0"
```

Run: `pnpm install`

Add `packages/ui/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

- [ ] **Step 3: Implement**

Create `packages/ui/src/secure-store.ts`:

```ts
import { invoke } from '@tauri-apps/api/core'

export const secureStore = {
  async get(key: string): Promise<string | null> {
    const out = await invoke<{ value: string | null }>('plugin:secure-store|get', { key })
    return out.value
  },
  async set(key: string, value: string): Promise<void> {
    await invoke<void>('plugin:secure-store|set', { key, value })
  },
  async delete(key: string): Promise<void> {
    await invoke<void>('plugin:secure-store|delete', { key })
  },
  async has(key: string): Promise<boolean> {
    const out = await invoke<{ value: boolean }>('plugin:secure-store|has', { key })
    return out.value
  },
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @1scratch/ui vitest run`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/ui/
git commit -m "feat(ui): secureStore JS API + tests"
```

---

## Task 19: Add Tauri JS plugin deps to client

**Files:**
- Modify: `apps/client/package.json`

- [ ] **Step 1: Install plugin JS bindings**

Run:
```bash
pnpm --filter @1scratch/client add @tauri-apps/plugin-deep-link @tauri-apps/plugin-shell @tauri-apps/plugin-os
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -w tsc -b`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/client/package.json pnpm-lock.yaml
git commit -m "chore(client): add deep-link/shell/os Tauri plugin deps"
```

---

## Task 20: Wire plugins into `src-tauri`

**Files:**
- Modify: `apps/client/src-tauri/Cargo.toml`
- Modify: `apps/client/src-tauri/src/lib.rs`

- [ ] **Step 1: Update Cargo.toml**

Replace `[dependencies]` block in `apps/client/src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-opener = "2"
tauri-plugin-sql = { version = "2", features = ["sqlite"] }
tauri-plugin-deep-link = "2"
tauri-plugin-shell = "2"
tauri-plugin-os = "2"
tauri-plugin-1scratch-secure-store = { path = "../../../packages/tauri-plugin-secure-store" }
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

- [ ] **Step 2: Register plugins in lib.rs**

Replace `apps/client/src-tauri/src/lib.rs`:

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

> The `greet` command is removed — it was a Tauri scaffold leftover and is not used by `apps/client/src/`. Verify first with `grep greet apps/client/src` returning no matches; if it returns matches, keep `greet`.

- [ ] **Step 3: Cargo build host**

Run: `cd apps/client/src-tauri && cargo check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src-tauri/Cargo.toml apps/client/src-tauri/src/lib.rs apps/client/src-tauri/Cargo.lock
git commit -m "feat(client): register deep-link/shell/os/secure-store plugins"
```

---

## Task 21: `tauri.conf.json` identifier + plugin config

**Files:**
- Modify: `apps/client/src-tauri/tauri.conf.json`

- [ ] **Step 1: Edit config**

Replace contents of `apps/client/src-tauri/tauri.conf.json`:

```json
{
  "$schema": "https://schema.tauri.app/config/2",
  "productName": "scratch",
  "version": "0.1.0",
  "identifier": "ai.scratch.app",
  "build": {
    "beforeDevCommand": "npm run dev",
    "devUrl": "http://localhost:1420",
    "beforeBuildCommand": "npm run build",
    "frontendDist": "../dist"
  },
  "app": {
    "windows": [
      { "title": "scratch", "width": 800, "height": 600 }
    ],
    "security": { "csp": null }
  },
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": [
      "icons/32x32.png",
      "icons/128x128.png",
      "icons/128x128@2x.png",
      "icons/icon.icns",
      "icons/icon.ico"
    ]
  },
  "plugins": {
    "deep-link": {
      "mobile": [{ "host": "app.1scratch.ai", "pathPrefix": ["/m"] }],
      "desktop": { "schemes": ["1scratch"] }
    }
  }
}
```

> If Tauri rejects this on `cargo tauri dev` because the `plugins.deep-link` schema differs at the pinned version, run `pnpm tauri info` to find the deep-link plugin docs link and adjust to the current shape. The intent (custom scheme `1scratch://` desktop + Android App Links host `app.1scratch.ai/m/*`) is locked.

- [ ] **Step 2: Verify desktop dev still works**

Run: `pnpm --filter @1scratch/client tauri dev`
Expected: app launches; existing Workbench renders. Quit with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git add apps/client/src-tauri/tauri.conf.json
git commit -m "feat(client): app identifier ai.scratch.app + deep-link plugin config"
```

---

## Task 22: Capabilities split

**Files:**
- Move: `apps/client/src-tauri/capabilities/default.json` → `desktop.json`
- Create: `apps/client/src-tauri/capabilities/mobile.json`

- [ ] **Step 1: Rename + edit desktop**

```bash
git mv apps/client/src-tauri/capabilities/default.json apps/client/src-tauri/capabilities/desktop.json
```

Replace contents of `desktop.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "desktop",
  "description": "Desktop window capabilities",
  "platforms": ["macOS", "linux", "windows"],
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "sql:default",
    "sql:allow-load",
    "sql:allow-execute",
    "sql:allow-select",
    "deep-link:default",
    "shell:allow-open",
    "secure-store:default"
  ]
}
```

- [ ] **Step 2: Create mobile capability**

Create `apps/client/src-tauri/capabilities/mobile.json`:

```json
{
  "$schema": "../gen/schemas/mobile-schema.json",
  "identifier": "mobile",
  "description": "Capabilities for iOS and Android",
  "platforms": ["iOS", "android"],
  "windows": ["main"],
  "permissions": [
    "core:default",
    "sql:default",
    "sql:allow-load",
    "sql:allow-execute",
    "sql:allow-select",
    "deep-link:default",
    "deep-link:allow-get-current",
    "shell:allow-open",
    "os:allow-platform",
    "os:allow-version",
    "secure-store:default"
  ]
}
```

- [ ] **Step 3: Re-run desktop dev**

Run: `pnpm --filter @1scratch/client tauri dev`
Expected: launches; capability schema may show a warning about `mobile-schema.json` not existing yet (it generates on `tauri android init`). Acceptable — that file isn't loaded on desktop.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src-tauri/capabilities/
git commit -m "feat(client): split capabilities into desktop + mobile"
```

---

## Task 23: `tauri android init`

**Files:**
- Create (generated): `apps/client/src-tauri/gen/android/**`

> Requires: `ANDROID_HOME` set, NDK installed (Android Studio's SDK Manager), Java 17. If the developer doesn't have these, this task blocks until installed.

- [ ] **Step 1: Verify env**

Run:
```bash
echo "$ANDROID_HOME"             # e.g. /home/gino/Android/Sdk
ls "$ANDROID_HOME/ndk"           # at least one numbered NDK version
java --version                   # 17.x
```

If any missing, install via Android Studio first (do not proceed).

- [ ] **Step 2: Run init**

```bash
cd apps/client/src-tauri
pnpm tauri android init
```

Expected: `gen/android/` is created with Gradle wrapper, `app/`, `app/src/main/AndroidManifest.xml`, etc.

- [ ] **Step 3: Verify the deep-link intent landed in the manifest**

Open `apps/client/src-tauri/gen/android/app/src/main/AndroidManifest.xml`. Find the `<activity>` block. It should include:

```xml
<intent-filter>
  <action android:name="android.intent.action.VIEW"/>
  <category android:name="android.intent.category.DEFAULT"/>
  <category android:name="android.intent.category.BROWSABLE"/>
  <data android:scheme="1scratch"/>
</intent-filter>
```

If missing, the deep-link plugin's manifest merging didn't fire — re-run `tauri android init` after confirming `tauri.conf.json` has the deep-link config.

- [ ] **Step 4: Commit generated files**

```bash
git add apps/client/src-tauri/gen/android
git commit -m "build(android): tauri android init — generated project files"
```

---

## Task 24: `tauri ios init` (macOS only — skip on Linux)

**Files:**
- Create (generated): `apps/client/src-tauri/gen/apple/**`

- [ ] **Step 1: Decide if macOS available**

If on Linux, write `gen/apple/.gitkeep` with a comment "iOS init pending macOS environment" and commit. Skip steps 2-4.

If on macOS with Xcode installed, proceed.

- [ ] **Step 2: Run init**

```bash
cd apps/client/src-tauri
pnpm tauri ios init
```

Expected: `gen/apple/` created with `*.xcodeproj`, Tauri Swift package, etc.

- [ ] **Step 3: Verify `Info.plist` URL scheme**

Open `gen/apple/scratch_iOS/Info.plist`. Find `CFBundleURLTypes`. Should include `CFBundleURLSchemes = ["1scratch"]`.

- [ ] **Step 4: Verify Swift compiles in simulator**

```bash
pnpm tauri ios build --debug --target sim-arm64
```

Expected: build succeeds; bundle in `gen/apple/build/`. (If Apple cert prompts appear, abort and document — Apple work is deferred.)

- [ ] **Step 5: Commit**

```bash
git add apps/client/src-tauri/gen/apple
git commit -m "build(ios): tauri ios init — generated Xcode project"
```

---

## Task 25: `packages/ui/src/auth/deep-link.ts`

**Files:**
- Create: `packages/ui/src/auth/deep-link.ts`
- Create: `packages/ui/src/auth/deep-link.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const onOpenUrl = vi.fn()
const getCurrent = vi.fn()
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl, getCurrent }))

beforeEach(() => { onOpenUrl.mockReset(); getCurrent.mockReset() })

describe('deep-link', () => {
  it('getColdStartUrl returns the matching URL when present', async () => {
    getCurrent.mockResolvedValue(['https://example.com/x', '1scratch://auth/done?refresh=abc'])
    const { getColdStartUrl } = await import('./deep-link')
    const url = await getColdStartUrl()
    expect(url?.toString()).toBe('1scratch://auth/done?refresh=abc')
  })

  it('getColdStartUrl returns null when no match', async () => {
    getCurrent.mockResolvedValue([])
    const { getColdStartUrl } = await import('./deep-link')
    expect(await getColdStartUrl()).toBeNull()
  })

  it('listenForAuthCallback only fires for matching scheme/path', async () => {
    let cb: (urls: string[]) => void = () => {}
    onOpenUrl.mockImplementation((c: typeof cb) => { cb = c; return () => {} })
    const { listenForAuthCallback } = await import('./deep-link')
    const seen: URL[] = []
    listenForAuthCallback((u) => seen.push(u))
    cb(['https://nope.com', '1scratch://auth/done?x=1', '1scratch://other/path'])
    expect(seen.length).toBe(1)
    expect(seen[0]!.toString()).toBe('1scratch://auth/done?x=1')
  })
})
```

Run; expect FAIL.

- [ ] **Step 2: Implement**

Create `packages/ui/src/auth/deep-link.ts`:

```ts
import { onOpenUrl, getCurrent } from '@tauri-apps/plugin-deep-link'

const SCHEME = '1scratch:'
const PATH = '/auth/done'

function matches(raw: string): URL | null {
  try {
    const u = new URL(raw)
    if (u.protocol === SCHEME && u.pathname === PATH) return u
    return null
  } catch {
    return null
  }
}

export async function getColdStartUrl(): Promise<URL | null> {
  const urls = (await getCurrent()) ?? []
  for (const raw of urls) {
    const m = matches(raw)
    if (m) return m
  }
  return null
}

export function listenForAuthCallback(handler: (url: URL) => void): () => void {
  const stop = onOpenUrl((urls) => {
    for (const raw of urls) {
      const m = matches(raw)
      if (m) handler(m)
    }
  })
  // Tauri's onOpenUrl returns a Promise<UnlistenFn> — wrap.
  let cancelled = false
  void stop.then?.((fn) => { if (cancelled) fn?.() })
  return () => { cancelled = true }
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @1scratch/ui vitest run src/auth/deep-link.test.ts`
Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/auth/
git commit -m "feat(ui): deep-link helpers (cold-start + listener)"
```

---

## Task 26: `packages/ui/src/auth/session.ts`

**Files:**
- Create: `packages/ui/src/auth/session.ts`
- Create: `packages/ui/src/auth/session.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const secureGet = vi.fn()
const secureSet = vi.fn()
const secureDelete = vi.fn()
vi.mock('../secure-store', () => ({
  secureStore: {
    get: secureGet, set: secureSet, delete: secureDelete, has: vi.fn(),
  },
}))

const fetchSpy = vi.fn()
vi.stubGlobal('fetch', fetchSpy)

beforeEach(() => { secureGet.mockReset(); secureSet.mockReset(); secureDelete.mockReset(); fetchSpy.mockReset() })

describe('loadSession', () => {
  it('returns null when no refresh stored', async () => {
    secureGet.mockResolvedValue(null)
    const { loadSession } = await import('./session')
    expect(await loadSession({ apiBase: 'https://x' })).toBeNull()
  })

  it('refreshes and persists the new refresh token', async () => {
    secureGet.mockResolvedValue('old-refresh')
    fetchSpy.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ access_jwt: 'eyJ.a.b', refresh_token: 'new-refresh', user: { id: 'u' } }),
    })
    const { loadSession } = await import('./session')
    const sess = await loadSession({ apiBase: 'https://x' })
    expect(sess).toEqual({ access: 'eyJ.a.b', userId: 'u' })
    expect(secureSet).toHaveBeenCalledWith('refresh', 'new-refresh')
  })

  it('clears refresh on 401 and returns null', async () => {
    secureGet.mockResolvedValue('bad-refresh')
    fetchSpy.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const { loadSession } = await import('./session')
    expect(await loadSession({ apiBase: 'https://x' })).toBeNull()
    expect(secureDelete).toHaveBeenCalledWith('refresh')
  })
})
```

- [ ] **Step 2: Implement**

Create `packages/ui/src/auth/session.ts`:

```ts
import { secureStore } from '../secure-store'
import { listenForAuthCallback, getColdStartUrl } from './deep-link'

export interface Session { access: string; userId: string }

interface ExchangeResponse {
  access_jwt: string
  refresh_token: string
  user: { id: string }
}

export async function ensureDeviceId(): Promise<string> {
  const existing = await secureStore.get('device_id')
  if (existing) return existing
  const id = crypto.randomUUID()
  await secureStore.set('device_id', id)
  return id
}

export async function loadSession(opts: { apiBase: string }): Promise<Session | null> {
  const refresh = await secureStore.get('refresh')
  if (!refresh) return null
  const res = await fetch(`${opts.apiBase}/api/mobile/refresh`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${refresh}` },
  })
  if (res.status === 401) {
    await secureStore.delete('refresh')
    return null
  }
  if (!res.ok) throw new Error(`refresh failed (${res.status})`)
  const body = (await res.json()) as ExchangeResponse
  await secureStore.set('refresh', body.refresh_token)
  return { access: body.access_jwt, userId: body.user.id }
}

export async function signIn(opts: {
  apiBase: string
  webBase: string
  shellOpen: (url: string) => Promise<void>
  deviceLabel?: string
}): Promise<Session> {
  const deviceId = await ensureDeviceId()
  const params = new URLSearchParams({
    return: '1scratch://auth/done',
    device_id: deviceId,
    device_label: opts.deviceLabel ?? 'Tauri client',
  })
  const url = `${opts.webBase}/sign-in?${params.toString()}`

  const cold = await getColdStartUrl()
  let resolved: URL | null = cold
  if (!resolved) {
    resolved = await new Promise<URL>((resolve) => {
      const stop = listenForAuthCallback((u) => { stop(); resolve(u) })
      void opts.shellOpen(url)
    })
  }
  const refresh = resolved.searchParams.get('refresh')
  const access = resolved.searchParams.get('access')
  if (!refresh || !access) throw new Error('deep-link missing refresh/access params')
  await secureStore.set('refresh', refresh)
  // Decode JWT subject (no signature verify on client — server is source of truth).
  const sub = JSON.parse(atob(access.split('.')[1] ?? '{}')).sub as string
  return { access, userId: sub }
}

export async function signOut(opts: { apiBase: string }): Promise<void> {
  const refresh = await secureStore.get('refresh')
  if (refresh) {
    await fetch(`${opts.apiBase}/api/mobile/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${refresh}` },
    }).catch(() => {})
  }
  await secureStore.delete('refresh')
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @1scratch/ui vitest run src/auth/session.test.ts`
Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/ui/src/auth/
git commit -m "feat(ui): session loadSession/signIn/signOut over secure-store + deep-link"
```

---

## Task 27: Rewrite `apps/client/src/sync/auth-token.ts`

**Files:**
- Modify: `apps/client/src/sync/auth-token.ts`
- Modify: `apps/client/src/sync/sync-provider.tsx` (or wherever a "sign in" button can hang for the smoke test)

- [ ] **Step 1: Replace getAuthToken**

Replace contents of `apps/client/src/sync/auth-token.ts`:

```ts
import { open as shellOpen } from '@tauri-apps/plugin-shell'
import { loadSession, signIn, type Session } from '@1scratch/ui/auth/session'

let cached: Session | null = null

export function apiBaseUrl(): string {
  const url = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_API_BASE_URL
  return url ?? 'https://app.1scratch.ai'
}

export function webBaseUrl(): string {
  const url = (import.meta as unknown as { env: Record<string, string> }).env?.VITE_WEB_BASE_URL
  return url ?? 'https://app.1scratch.ai'
}

export async function getAuthToken(): Promise<string> {
  if (cached) return cached.access
  const sess = await loadSession({ apiBase: apiBaseUrl() })
  if (sess) {
    cached = sess
    return sess.access
  }
  // No session — caller must trigger interactive sign-in via signInInteractive().
  throw new Error('not_signed_in')
}

export async function signInInteractive(): Promise<Session> {
  const sess = await signIn({
    apiBase: apiBaseUrl(),
    webBase: webBaseUrl(),
    shellOpen: (u) => shellOpen(u),
  })
  cached = sess
  return sess
}

export function clearAuthCache(): void { cached = null }
```

- [ ] **Step 2: Add a Sign-in button**

In `apps/client/src/App.tsx` (or the smallest existing root with mounted UI), add an effect: on first render, attempt `getAuthToken()`. On `not_signed_in`, render a "Sign in" button that calls `signInInteractive()` then forces a re-render of the rest of the app. Implementation can be as simple as:

```tsx
import { useEffect, useState } from 'react'
import { getAuthToken, signInInteractive } from './sync/auth-token'
// existing imports...

export default function App() {
  const [signedIn, setSignedIn] = useState(false)
  const [busy, setBusy] = useState(true)
  useEffect(() => {
    getAuthToken().then(() => { setSignedIn(true); setBusy(false) })
                  .catch(() => setBusy(false))
  }, [])
  if (busy) return <p style={{ padding: 24 }}>Loading…</p>
  if (!signedIn) {
    return (
      <main style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <button onClick={async () => { await signInInteractive(); setSignedIn(true) }}>
          Sign in
        </button>
      </main>
    )
  }
  return <ExistingRootBody />   // wire to whatever the previous default export rendered
}
```

(If `App.tsx` already has its own structure — wrap inside a top-level guard rather than restructure.)

- [ ] **Step 3: Typecheck + build**

Run:
```bash
pnpm -w tsc -b
pnpm --filter @1scratch/client build
```
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/client/src/
git commit -m "feat(client): wire signIn over deep-link; getAuthToken now backed by device session"
```

---

## Task 28: `apps/client/package.json` mobile scripts

**Files:**
- Modify: `apps/client/package.json`

- [ ] **Step 1: Add scripts**

Edit `apps/client/package.json` `scripts`:

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build",
  "preview": "vite preview",
  "typecheck": "tsc --noEmit",
  "tauri": "tauri",
  "android:dev": "tauri android dev",
  "android:build": "tauri android build",
  "ios:dev": "tauri ios dev",
  "ios:build": "tauri ios build"
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/client/package.json
git commit -m "chore(client): add android:dev/build + ios:dev/build scripts"
```

---

## Task 29: Wire MOBILE_JWT_SIGNING_KEY to Vercel Prod+Preview+Dev

**Files:** none (CLI ops)

- [ ] **Step 1: Add env to all three scopes**

Run from `apps/web/`:

```bash
# Generate one fresh value PER ENV (do not reuse the one in .env.development.local for prod)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | tee /tmp/mjk.txt
vercel env add MOBILE_JWT_SIGNING_KEY production < /tmp/mjk.txt
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | tee /tmp/mjk.txt
vercel env add MOBILE_JWT_SIGNING_KEY preview < /tmp/mjk.txt
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" | tee /tmp/mjk.txt
vercel env add MOBILE_JWT_SIGNING_KEY development < /tmp/mjk.txt
shred -u /tmp/mjk.txt 2>/dev/null || rm /tmp/mjk.txt

vercel env add MOBILE_JWT_ISS production
# Paste: https://app.1scratch.ai
vercel env add MOBILE_JWT_ISS preview
# Paste: https://app.1scratch.ai
vercel env add MOBILE_JWT_ISS development
# Paste: https://app.1scratch.ai
```

> Vercel CLI `git_branch_required` bug from the Phase 1 build log may still bite Preview scope on the CLI — fall back to the dashboard if so.

- [ ] **Step 2: Pull dev env back**

Run: `vercel env pull apps/web/.env.development.local` (overwrites with the fresh dev value).

- [ ] **Step 3: No commit (env only)**

---

## Task 30: Manual device DoD verification

**Files:** none (manual)

- [ ] **Step 1: Connect a Pixel-class Android device (or start API 34 emulator)**

```bash
adb devices
# Expected: device listed as "device" not "unauthorized"
```

- [ ] **Step 2: Run the app**

```bash
cd apps/client
pnpm android:dev
```

Expected: gradle build succeeds, APK installs, app launches showing "Sign in" button.

- [ ] **Step 3: Sign in flow**

Tap "Sign in". Expected: system browser opens `https://app.1scratch.ai/sign-in?return=…`. Sign in via Google. Browser hits `/mobile/handoff`, redirects via `1scratch://auth/done?...`. App regains focus, "Sign in" disappears, Workbench renders.

- [ ] **Step 4: Verify secure storage**

```bash
adb shell run-as ai.scratch.app ls shared_prefs
adb shell run-as ai.scratch.app cat shared_prefs/scratch_secure.xml | head
# Expected: ciphertext only, no readable refresh token
```

- [ ] **Step 5: Sync round-trip**

Type a prompt in the workbench, submit, await response. Then on a host with `psql` or via Neon SQL editor:

```sql
SELECT id, payload->>'prompt' AS prompt, updated_at
  FROM cards
 WHERE user_id = '<the user id you signed in with>'
 ORDER BY updated_at DESC
 LIMIT 1;
```

Expected: a row exists with the prompt you just typed.

- [ ] **Step 6: Force-quit + relaunch**

Close the app from the recents tray. Re-open. Expected: no sign-in prompt; Workbench renders immediately; the card from Step 5 still visible (sync pull replays it).

- [ ] **Step 7: Sign out**

In the app, trigger sign-out (add a temporary button to the top-right of `App.tsx` if not already wired — call `signOut({ apiBase: apiBaseUrl() })` then `clearAuthCache()` then `setSignedIn(false)`). After sign-out:

```sql
SELECT revoked_at FROM device_sessions WHERE user_id = '<id>';
-- Expected: revoked_at is NOT NULL
```

Re-attempting `getAuthToken()` (or restarting the app) returns to the sign-in screen.

- [ ] **Step 8: Document the pass + commit any glue (sign-out button)**

```bash
git add apps/client/src/
git commit -m "feat(client): temporary sign-out button for 3a manual DoD"
```

- [ ] **Step 9: PLAN.md build log entry**

Append to `PLAN.md` under `# Build Log — Amendments & Deviations`, **at the top**:

```markdown
## 2026-04-19 — Phase 3a: mobile foundation (Android-first)

Scoped pass: PLAN §10 Phase 3 step 1 (Tauri Mobile project setup, shared `src/`)
plus the mobile-side prerequisites: secure storage, deep-link OAuth callback,
and own-token auth so `/api/sync/*` can be reached over a refreshable bearer.
Apple Developer enrollment blocked → iOS slice is skeleton-only.

Spec: `docs/superpowers/specs/2026-04-19-phase3a-mobile-foundation-design.md`
Plan: `docs/superpowers/plans/2026-04-19-phase3a-mobile-foundation.md`

**Shipped:**
- `packages/ui/` — extracted from `apps/client/src/{components,lib,store}`
- `packages/tauri-plugin-secure-store/` — Android EncryptedSharedPreferences,
  iOS Keychain (Swift), desktop keyring fallback, single JS API.
- Migration `0003_device_sessions.sql` + Drizzle types + RLS.
- `MOBILE_JWT_SIGNING_KEY` HS256 access JWT (15 min) + 30-day refresh token
  rotated on use; `device_sessions` table; `/api/mobile/{exchange,refresh,revoke}`.
- `resolveAuthedUserId()` swap across all self-gating routes; `proxy.ts`
  matcher relaxed to `/app(.*)` + `/mobile(.*)`.
- `/sign-in?return=…` cookie flow + `/mobile/handoff` browser-handoff page.
- Tauri Android init committed (`src-tauri/gen/android`); deep-link plugin,
  shell, os plugins wired; `tauri.conf.json` identifier → `ai.scratch.app`.
- Real Android device DoD passed: sign-in → exchange → sync push → server
  stores → pull replays after force-quit.

**Deferred to 3a-ios-finish (Apple unblocks):**
- iOS init from macOS, Apple Sign-In wiring, TestFlight, Privacy Manifest.

**Deferred to 3b/3c:** touch UX (3b), foreground sync triggers (3b), push
infra (3c), Play Console / store metadata (3c), App Links assetlinks.json (3c).
```

- [ ] **Step 10: Final commit**

```bash
git add PLAN.md
git commit -m "docs(plan): build-log entry for Phase 3a mobile foundation"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Tasks |
|---|---|
| §1 Locked decisions | All tasks honor; bundle ID Task 21; iOS skeleton Task 24 |
| §2 Workspace layout | Tasks 11, 12, 13, 14, 15 |
| §3 Tauri mobile bootstrap | Tasks 19, 20, 21, 22, 23, 24, 28 |
| §4 Auth: device sessions | Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 29 |
| §5 Secure-storage plugin | Tasks 14, 15, 16, 17, 18 |
| §6 Deep-link plumbing | Task 25 (client side); Android intent verified in Task 23; iOS in Task 24 |
| §7 Testing strategy + DoD | Unit tests in Tasks 3-8, 18, 25, 26; manual DoD in Task 30 |
| §8 Deferrals | Documented in Task 30 build-log entry |

No spec section is unaddressed.

**Placeholder scan:** No `TBD` / `TODO` / "implement later" remaining. Tasks that intentionally defer (iOS macOS gate in Task 24, mobile.rs dispatch shell in Task 14) carry an explicit explanation of *why* and the conditions for filling them in.

**Type consistency:** `SessionPair`, `Session`, `secureStore`, `loadSession`, `signIn`, `signOut`, `ensureDeviceId`, `resolveAuthedUserId`, `signAccessToken`, `verifyAccessToken`, `createSession`, `rotateSession`, `revokeSession`, `findSessionByRefresh` — all referenced consistently across tasks.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-19-phase3a-mobile-foundation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
