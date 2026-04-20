// Postgres schema for 1Scratch — see PLAN.md §3 for design notes.
// All user-owned tables carry a user_id column; RLS policies in
// migrations/0001_rls.sql restrict reads/writes to the row whose
// user_id matches the `app.user_id` GUC set per request.

import { sql } from 'drizzle-orm'
import {
  pgTable,
  text,
  timestamp,
  bigint,
  integer,
  doublePrecision,
  jsonb,
  boolean,
  uuid,
  bigserial,
  primaryKey,
  uniqueIndex,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core'

// ─── Enums ──────────────────────────────────────────────────────────────────

export const tier = pgEnum('tier', ['free', 'pro'])

export const providerKind = pgEnum('provider_kind', ['api_key', 'oauth'])

export const providerStatus = pgEnum('provider_status', [
  'unverified',
  'connected',
  'invalid',
  'revoked',
])

export const entityType = pgEnum('entity_type', ['card', 'canvas', 'section'])

export const mutationOp = pgEnum('mutation_op', ['upsert', 'delete'])

// ─── Identity ───────────────────────────────────────────────────────────────

// Mirrors Clerk's user.id — we never store passwords.
export const users = pgTable('users', {
  id: text('id').primaryKey(),                       // Clerk user id (string)
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  tier: tier('tier').notNull().default('free'),
  // Per-day AI cap in cents — defaults to $2 for free tier (PLAN.md §10).
  dailyAiCapCents: integer('daily_ai_cap_cents').notNull().default(200),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Workspace tree ─────────────────────────────────────────────────────────

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('workspaces_user_idx').on(t.userId)],
)

export const sections = pgTable(
  'sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    position: doublePrecision('position').notNull(),
    permanent: boolean('permanent').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('sections_workspace_idx').on(t.workspaceId, t.position)],
)

export const canvases = pgTable(
  'canvases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    sectionId: uuid('section_id')
      .notNull()
      .references(() => sections.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color'),
    // {panX, panY, zoom}
    viewport: jsonb('viewport').notNull(),
    position: doublePrecision('position').notNull(),
    // Server-assigned HLC, monotonic per row.
    version: bigint('version', { mode: 'bigint' }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('canvases_section_idx').on(t.sectionId, t.position),
    index('canvases_user_version_idx').on(t.userId, t.version),
  ],
)

export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    canvasId: uuid('canvas_id')
      .notNull()
      .references(() => canvases.id, { onDelete: 'cascade' }),
    x: doublePrecision('x').notNull(),
    y: doublePrecision('y').notNull(),
    width: doublePrecision('width').notNull(),
    height: doublePrecision('height').notNull(),
    zIndex: integer('z_index').notNull().default(0),
    // {prompt, modelSlot, status, response, model, inputTokens, outputTokens, errorMessage?}
    payload: jsonb('payload').notNull(),
    version: bigint('version', { mode: 'bigint' }).notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('cards_canvas_idx').on(t.canvasId).where(sql`deleted_at IS NULL`),
    index('cards_user_version_idx').on(t.userId, t.version),
  ],
)

// ─── Append-only mutation log (sync substrate) ──────────────────────────────

// Server-assigned monotonic version. Clients pull `WHERE version > since`.
// Idempotency: (user_id, client_mutation_id) is unique so retries are safe.
export const mutations = pgTable(
  'mutations',
  {
    serverId: bigserial('server_id', { mode: 'bigint' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: text('device_id').notNull(),
    clientMutationId: text('client_mutation_id').notNull(),
    entityType: entityType('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    op: mutationOp('op').notNull(),
    patch: jsonb('patch').notNull(),
    clientVersion: bigint('client_version', { mode: 'bigint' }).notNull(),
    serverVersion: bigint('server_version', { mode: 'bigint' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('mutations_idempotency_idx').on(t.userId, t.clientMutationId),
    index('mutations_user_version_idx').on(t.userId, t.serverVersion),
  ],
)

// ─── Provider connections (BYOK + OAuth) ────────────────────────────────────

// Encrypted material is stored per-row using KMS envelope encryption.
// dek_ciphertext = AWS KMS-wrapped data encryption key.
// secret_ciphertext = AES-256-GCM(plaintext, dek) with iv + tag.
export const providerConnections = pgTable(
  'provider_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),               // 'anthropic' | 'openai' | ...
    kind: providerKind('kind').notNull(),
    label: text('label'),
    status: providerStatus('status').notNull().default('unverified'),
    endpointUrl: text('endpoint_url'),                  // for self-hosted Ollama etc.
    // Envelope encryption fields — never returned to the client.
    dekCiphertext: text('dek_ciphertext').notNull(),    // base64
    secretCiphertext: text('secret_ciphertext').notNull(),
    secretIv: text('secret_iv').notNull(),
    secretTag: text('secret_tag').notNull(),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('provider_connections_user_idx').on(t.userId)],
)

// 0–9 model slots per user that map to a (connection, model_id) pair.
export const modelSlots = pgTable(
  'model_slots',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    slot: integer('slot').notNull(),                    // 0–9
    providerConnectionId: uuid('provider_connection_id').references(
      () => providerConnections.id,
      { onDelete: 'set null' },
    ),
    modelId: text('model_id'),
    displayLabel: text('display_label'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.slot] })],
)

// ─── AI usage ledger (drives free-tier $2/day cap) ──────────────────────────

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // 'YYYY-MM-DD' in UTC — lets the cap query stay an indexed exact match.
    usageDate: text('usage_date').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costMicros: bigint('cost_micros', { mode: 'bigint' }).notNull(),  // 1 cent = 10_000 micros
    cardId: uuid('card_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_usage_user_date_idx').on(t.userId, t.usageDate)],
)

// ─── Auth audit log (PLAN.md §2 threat model) ───────────────────────────────

// Append-only. Users can read their own rows; see migrations/0002 for RLS.
// kind is an open string; known values live in src/lib/audit-events.ts so
// we can add new event types without a schema change.
export const authEvents = pgTable(
  'auth_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    // Neon driver returns inet as text; store/read as string.
    ip: text('ip'),
    ua: text('ua'),
    meta: jsonb('meta').notNull().default({}),
    ts: timestamp('ts', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auth_events_user_ts_idx').on(t.userId, t.ts)],
)

// ─── Account deletion (24-hr cool-off; PLAN.md §5) ──────────────────────────

// One active request per user enforced by a partial unique index in SQL.
// confirm_token_hash = sha256(plaintext token); plaintext is emailed once.
export const accountDeletionRequests = pgTable(
  'account_deletion_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    confirmTokenHash: text('confirm_token_hash').notNull(),
    status: text('status').notNull().default('pending'),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    executesAfter: timestamp('executes_after', { withTimezone: true }).notNull(),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    executedAt: timestamp('executed_at', { withTimezone: true }),
  },
)

// ─── Billing events (Paddle webhook log) ────────────────────────────────────

// Idempotency key is Paddle's event_id; the webhook is at-least-once.
export const billingEvents = pgTable(
  'billing_events',
  {
    eventId: text('event_id').primaryKey(),             // Paddle event_id
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    eventType: text('event_type').notNull(),            // 'subscription.created' etc.
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('billing_events_user_idx').on(t.userId)],
)

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
  (t) => [
    uniqueIndex('device_sessions_user_device_idx').on(t.userId, t.deviceId),
    index('device_sessions_refresh_hash_active_idx').on(t.refreshHash),
  ],
)
