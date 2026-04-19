// Provider credential store. All persisted secrets are envelope-encrypted
// via src/lib/crypto/kms.ts. Reads decrypt in-memory and return plaintext
// only to server callers — never to the client.
//
// RLS enforces per-user isolation on writes + reads (see migrations/0001_rls.sql).

import { randomUUID } from 'node:crypto'
import { seal, open, type SealedSecret } from './crypto/kms'
import { sqlUser, withRls } from '@/db/rls'
import type { ProviderId, ProviderStatus } from '@1scratch/types'

export interface ProviderConnectionRow {
  id: string
  user_id: string
  provider: ProviderId
  kind: 'api_key' | 'oauth'
  label: string | null
  status: ProviderStatus
  dek_ciphertext: string
  secret_ciphertext: string
  secret_iv: string
  secret_tag: string
  last_verified_at: string | null
  created_at: string
}

export interface ConnectionPublic {
  id: string
  provider: ProviderId
  kind: 'api_key' | 'oauth'
  label: string | null
  status: ProviderStatus
  lastVerifiedAt: string | null
}

export async function saveApiKey(args: {
  userId: string
  provider: ProviderId
  label: string | null
  plaintext: string
  endpointUrl?: string | null
}): Promise<ConnectionPublic> {
  return saveConnection({ ...args, kind: 'api_key' })
}

// OpenRouter PKCE returns a long-lived API key; we seal + store it the
// same way as a BYOK key, just tagged kind='oauth' for audit clarity.
export async function saveOauthConnection(args: {
  userId: string
  provider: ProviderId
  label: string | null
  plaintext: string
}): Promise<ConnectionPublic> {
  return saveConnection({ ...args, kind: 'oauth', status: 'connected' })
}

async function saveConnection(args: {
  userId: string
  provider: ProviderId
  kind: 'api_key' | 'oauth'
  label: string | null
  plaintext: string
  endpointUrl?: string | null
  status?: ProviderStatus
}): Promise<ConnectionPublic> {
  const id = randomUUID()
  const sealed = await seal(args.plaintext, {
    userId: args.userId,
    purpose: 'provider_secret',
    rowId: id,
  })
  const status: ProviderStatus = args.status ?? 'unverified'
  const verifiedAt = status === 'connected' ? new Date() : null
  const sql = sqlUser()
  await withRls(args.userId, [
    sql`INSERT INTO provider_connections
        (id, user_id, provider, kind, label, status, endpoint_url,
         dek_ciphertext, secret_ciphertext, secret_iv, secret_tag,
         last_verified_at)
        VALUES (${id}, ${args.userId}, ${args.provider}, ${args.kind},
                ${args.label}, ${status}, ${args.endpointUrl ?? null},
                ${sealed.dekCiphertext}, ${sealed.ciphertext},
                ${sealed.iv}, ${sealed.tag},
                ${verifiedAt})`,
  ])
  return {
    id,
    provider: args.provider,
    kind: args.kind,
    label: args.label,
    status,
    lastVerifiedAt: verifiedAt?.toISOString() ?? null,
  }
}

// Load a connection with its endpoint_url (for Ollama verification).
export async function loadConnectionMeta(
  userId: string,
  connectionId: string,
): Promise<{ provider: ProviderId; endpointUrl: string | null } | null> {
  const sql = sqlUser()
  const [rows] = await withRls<[Array<{ provider: ProviderId; endpoint_url: string | null }>]>(
    userId,
    [
      sql`SELECT provider, endpoint_url FROM provider_connections
          WHERE id = ${connectionId} LIMIT 1`,
    ],
  )
  const r = rows[0]
  if (!r) return null
  return { provider: r.provider, endpointUrl: r.endpoint_url }
}

export async function listConnections(userId: string): Promise<ConnectionPublic[]> {
  const sql = sqlUser()
  const [rows] = await withRls<[ProviderConnectionRow[]]>(userId, [
    sql`SELECT id, provider, kind, label, status, last_verified_at
        FROM provider_connections
        ORDER BY created_at DESC`,
  ])
  return (rows as unknown as Array<{
    id: string
    provider: ProviderId
    kind: 'api_key' | 'oauth'
    label: string | null
    status: ProviderStatus
    last_verified_at: string | null
  }>).map((r) => ({
    id: r.id,
    provider: r.provider,
    kind: r.kind,
    label: r.label,
    status: r.status,
    lastVerifiedAt: r.last_verified_at,
  }))
}

export async function loadDecryptedKey(
  userId: string,
  connectionId: string,
): Promise<{ provider: ProviderId; plaintext: string } | null> {
  const sql = sqlUser()
  const [rows] = await withRls<[ProviderConnectionRow[]]>(userId, [
    sql`SELECT id, provider, dek_ciphertext, secret_ciphertext, secret_iv, secret_tag
        FROM provider_connections
        WHERE id = ${connectionId}
        LIMIT 1`,
  ])
  const row = (rows as unknown as ProviderConnectionRow[])[0]
  if (!row) return null
  const sealed: SealedSecret = {
    dekCiphertext: row.dek_ciphertext,
    ciphertext: row.secret_ciphertext,
    iv: row.secret_iv,
    tag: row.secret_tag,
  }
  const plaintext = await open(sealed, {
    userId,
    purpose: 'provider_secret',
    rowId: row.id,
  })
  return { provider: row.provider, plaintext }
}

export async function markVerified(
  userId: string,
  connectionId: string,
  status: ProviderStatus,
): Promise<void> {
  const sql = sqlUser()
  await withRls(userId, [
    sql`UPDATE provider_connections
        SET status = ${status}, last_verified_at = now()
        WHERE id = ${connectionId}`,
  ])
}

export async function deleteConnection(
  userId: string,
  connectionId: string,
): Promise<void> {
  const sql = sqlUser()
  await withRls(userId, [
    sql`DELETE FROM provider_connections WHERE id = ${connectionId}`,
  ])
}

// Resolve a specific provider's most-recently-added connection for the
// authed user. Used by /api/ai/stream when a request doesn't pick a slot.
export async function findConnectionByProvider(
  userId: string,
  provider: ProviderId,
): Promise<ProviderConnectionRow | null> {
  const sql = sqlUser()
  const [rows] = await withRls<[ProviderConnectionRow[]]>(userId, [
    sql`SELECT id, provider, dek_ciphertext, secret_ciphertext, secret_iv, secret_tag
        FROM provider_connections
        WHERE provider = ${provider}
        ORDER BY created_at DESC
        LIMIT 1`,
  ])
  return (rows as unknown as ProviderConnectionRow[])[0] ?? null
}
