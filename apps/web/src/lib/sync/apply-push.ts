// applyPush — core server-side push logic.
// Idempotent via (user_id, client_mutation_id) unique index. LWW at row level.

import { sqlUser, withRls } from '@/db/rls'
import { nextHlc, observeRemoteHlc } from '@/lib/hlc'
import { ensureDefaultWorkspaceAndSection } from '@/lib/workspace'
import {
  deleteCanvasQuery,
  deleteSectionQuery,
  softDeleteCardQuery,
  upsertCanvasQuery,
  upsertCardQuery,
  upsertSectionQuery,
} from './patch'
import type { ValidatedMutation, ValidatedPush } from './validate'

export interface PushResult {
  accepted: string[]
  rejected: { id: string; reason: 'stale' | 'forbidden' | 'invalid' | 'quota_exceeded'; message?: string }[]
  serverVersion: string
  additional: ServerMutationRow[]
}

export interface ServerMutationRow {
  id: string
  entityType: 'card' | 'canvas' | 'section'
  entityId: string
  op: 'upsert' | 'delete'
  patch: Record<string, unknown>
  version: string
  deviceId: string
  createdAt: string
}

const PATCH_MAX_BYTES = 64 * 1024

export async function applyPush(userId: string, body: ValidatedPush): Promise<PushResult> {
  const sql = sqlUser()
  const { workspaceId } = await ensureDefaultWorkspaceAndSection(userId)

  const accepted: string[] = []
  const rejected: PushResult['rejected'] = []
  let maxServerVersion = BigInt(body.baseVersion)

  for (const m of body.mutations) {
    const patchBytes = Buffer.byteLength(JSON.stringify(m.patch), 'utf8')
    if (patchBytes > PATCH_MAX_BYTES) {
      rejected.push({ id: m.id, reason: 'invalid', message: 'patch too large' })
      continue
    }
    observeRemoteHlc(BigInt(m.clientVersion))
    const serverVersion = nextHlc()
    if (serverVersion > maxServerVersion) maxServerVersion = serverVersion

    const logQuery = sql`
      INSERT INTO mutations
        (user_id, device_id, client_mutation_id, entity_type, entity_id, op, patch,
         client_version, server_version)
      VALUES
        (${userId}, ${body.deviceId}, ${m.id}, ${m.entityType}, ${m.entityId}, ${m.op},
         ${JSON.stringify(m.patch)}::jsonb, ${m.clientVersion}::bigint,
         ${serverVersion.toString()}::bigint)
      ON CONFLICT (user_id, client_mutation_id) DO NOTHING
    `

    try {
      if (m.op === 'upsert') {
        const upsertQuery = entityUpsert(m, userId, workspaceId, serverVersion)
        await withRls(userId, [logQuery, upsertQuery])
      } else {
        const deleteQuery = entityDelete(m, userId, serverVersion)
        await withRls(userId, [logQuery, deleteQuery])
      }
      accepted.push(m.id)
    } catch (e) {
      rejected.push({
        id: m.id,
        reason: 'invalid',
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // Other-device mutations since baseVersion — piggyback on the push response.
  const [additionalRows] = await withRls<[ServerMutationRowDb[]]>(userId, [
    sql`SELECT client_mutation_id AS id, entity_type, entity_id, op, patch,
               server_version, device_id, created_at
        FROM mutations
        WHERE user_id = ${userId}
          AND server_version > ${body.baseVersion}::bigint
          AND device_id != ${body.deviceId}
        ORDER BY server_version
        LIMIT 500`,
  ])

  return {
    accepted,
    rejected,
    serverVersion: maxServerVersion.toString(),
    additional: additionalRows.map(rowToServerMutation),
  }
}

interface ServerMutationRowDb {
  id: string
  entity_type: 'card' | 'canvas' | 'section'
  entity_id: string
  op: 'upsert' | 'delete'
  patch: Record<string, unknown>
  server_version: string
  device_id: string
  created_at: string
}

function rowToServerMutation(r: ServerMutationRowDb): ServerMutationRow {
  return {
    id: r.id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    op: r.op,
    patch: r.patch,
    version: r.server_version,
    deviceId: r.device_id,
    createdAt: r.created_at,
  }
}

function entityUpsert(m: ValidatedMutation, userId: string, workspaceId: string, version: bigint) {
  const args = { userId, workspaceId, entityId: m.entityId, patch: m.patch, version }
  if (m.entityType === 'section') return upsertSectionQuery(args)
  if (m.entityType === 'canvas') return upsertCanvasQuery(args)
  return upsertCardQuery(args)
}

function entityDelete(m: ValidatedMutation, userId: string, version: bigint) {
  if (m.entityType === 'card') return softDeleteCardQuery(userId, m.entityId, version)
  if (m.entityType === 'canvas') return deleteCanvasQuery(userId, m.entityId)
  return deleteSectionQuery(userId, m.entityId)
}
