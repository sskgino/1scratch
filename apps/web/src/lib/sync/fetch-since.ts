import { sqlUser, withRls } from '@/db/rls'
import type { ServerMutationRow } from './apply-push'

export interface PullResult {
  mutations: ServerMutationRow[]
  serverVersion: string
  more: boolean
}

interface Row {
  id: string
  entity_type: 'card' | 'canvas' | 'section'
  entity_id: string
  op: 'upsert' | 'delete'
  patch: Record<string, unknown>
  server_version: string
  device_id: string
  created_at: string
}

export async function fetchSince(
  userId: string,
  since: string,
  limit: number,
): Promise<PullResult> {
  const sql = sqlUser()
  const fetchLimit = limit + 1

  const [rows] = await withRls<[Row[]]>(userId, [
    sql`SELECT client_mutation_id AS id, entity_type, entity_id, op, patch,
               server_version, device_id, created_at
        FROM mutations
        WHERE user_id = ${userId} AND server_version > ${since}::bigint
        ORDER BY server_version
        LIMIT ${fetchLimit}`,
  ])

  const more = rows.length > limit
  const page = more ? rows.slice(0, limit) : rows
  const serverVersion = page.length > 0 ? page[page.length - 1].server_version : since

  return {
    mutations: page.map((r) => ({
      id: r.id,
      entityType: r.entity_type,
      entityId: r.entity_id,
      op: r.op,
      patch: r.patch,
      version: r.server_version,
      deviceId: r.device_id,
      createdAt: r.created_at,
    })),
    serverVersion,
    more,
  }
}
