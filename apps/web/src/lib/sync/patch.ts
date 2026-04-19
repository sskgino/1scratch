// Entity-specific SQL builders for upsert/delete, shared by applyPush.
// Each upsert uses WHERE clause "incoming.version > current.version" so LWW
// is enforced at the DB layer.

import type { NeonQueryFunction, NeonQueryPromise } from '@neondatabase/serverless'
import { sqlUser } from '@/db/rls'

type UpsertArgs = {
  userId: string
  workspaceId: string
  entityId: string
  patch: Record<string, unknown>
  version: bigint
}

export function upsertSectionQuery(a: UpsertArgs): NeonQueryPromise<false, false> {
  const sql = sqlUser()
  const name = (a.patch.name as string | undefined) ?? ''
  const color = (a.patch.color as string | null | undefined) ?? null
  const position = (a.patch.position as number | undefined) ?? 0
  const permanent = (a.patch.permanent as boolean | undefined) ?? false
  return sql`
    INSERT INTO sections (id, user_id, workspace_id, name, color, position, permanent)
    VALUES (${a.entityId}, ${a.userId}, ${a.workspaceId}, ${name}, ${color}, ${position}, ${permanent})
    ON CONFLICT (id) DO UPDATE SET
      name = COALESCE(${a.patch.name as string | undefined} ::text, sections.name),
      color = CASE WHEN ${Object.prototype.hasOwnProperty.call(a.patch, 'color')}::bool
                   THEN ${color}::text ELSE sections.color END,
      position = COALESCE(${a.patch.position as number | undefined} ::double precision, sections.position),
      permanent = COALESCE(${a.patch.permanent as boolean | undefined} ::bool, sections.permanent)
  `
}

export function upsertCanvasQuery(a: UpsertArgs): NeonQueryPromise<false, false> {
  const sql = sqlUser()
  const sectionId = a.patch.sectionId as string | undefined
  const name = (a.patch.name as string | undefined) ?? ''
  const color = (a.patch.color as string | null | undefined) ?? null
  const position = (a.patch.position as number | undefined) ?? 0
  const viewport = a.patch.viewport ?? { panX: 0, panY: 0, zoom: 1 }
  return sql`
    INSERT INTO canvases
      (id, user_id, workspace_id, section_id, name, color, position, viewport, version)
    VALUES
      (${a.entityId}, ${a.userId}, ${a.workspaceId}, ${sectionId}, ${name}, ${color},
       ${position}, ${JSON.stringify(viewport)}::jsonb, ${a.version.toString()}::bigint)
    ON CONFLICT (id) DO UPDATE SET
      section_id = COALESCE(${sectionId}::uuid, canvases.section_id),
      name = COALESCE(${a.patch.name as string | undefined} ::text, canvases.name),
      color = CASE WHEN ${Object.prototype.hasOwnProperty.call(a.patch, 'color')}::bool
                   THEN ${color}::text ELSE canvases.color END,
      position = COALESCE(${a.patch.position as number | undefined} ::double precision, canvases.position),
      viewport = CASE WHEN ${Object.prototype.hasOwnProperty.call(a.patch, 'viewport')}::bool
                      THEN ${JSON.stringify(viewport)}::jsonb ELSE canvases.viewport END,
      version = EXCLUDED.version
    WHERE canvases.version < EXCLUDED.version
  `
}

export function upsertCardQuery(a: UpsertArgs): NeonQueryPromise<false, false> {
  const sql = sqlUser()
  const canvasId = a.patch.canvasId as string | undefined
  const x = (a.patch.x as number | undefined) ?? 0
  const y = (a.patch.y as number | undefined) ?? 0
  const width = (a.patch.width as number | undefined) ?? 300
  const height = (a.patch.height as number | undefined) ?? 200
  const zIndex = (a.patch.zIndex as number | undefined) ?? 0
  const payload = a.patch.payload ?? {}
  return sql`
    INSERT INTO cards
      (id, user_id, workspace_id, canvas_id, x, y, width, height, z_index, payload, version)
    VALUES
      (${a.entityId}, ${a.userId}, ${a.workspaceId}, ${canvasId},
       ${x}, ${y}, ${width}, ${height}, ${zIndex},
       ${JSON.stringify(payload)}::jsonb, ${a.version.toString()}::bigint)
    ON CONFLICT (id) DO UPDATE SET
      canvas_id = COALESCE(${canvasId}::uuid, cards.canvas_id),
      x = COALESCE(${a.patch.x as number | undefined} ::double precision, cards.x),
      y = COALESCE(${a.patch.y as number | undefined} ::double precision, cards.y),
      width = COALESCE(${a.patch.width as number | undefined} ::double precision, cards.width),
      height = COALESCE(${a.patch.height as number | undefined} ::double precision, cards.height),
      z_index = COALESCE(${a.patch.zIndex as number | undefined} ::integer, cards.z_index),
      payload = CASE WHEN ${Object.prototype.hasOwnProperty.call(a.patch, 'payload')}::bool
                     THEN cards.payload || ${JSON.stringify(payload)}::jsonb
                     ELSE cards.payload END,
      version = EXCLUDED.version
    WHERE cards.version < EXCLUDED.version
  `
}

export function softDeleteCardQuery(userId: string, entityId: string, version: bigint): NeonQueryPromise<false, false> {
  const sql = sqlUser()
  return sql`
    UPDATE cards
    SET deleted_at = now(), version = ${version.toString()}::bigint
    WHERE id = ${entityId} AND user_id = ${userId} AND version < ${version.toString()}::bigint
  `
}

export function deleteCanvasQuery(userId: string, entityId: string): NeonQueryPromise<false, false> {
  const sql = sqlUser()
  return sql`DELETE FROM canvases WHERE id = ${entityId} AND user_id = ${userId}`
}

export function deleteSectionQuery(userId: string, entityId: string): NeonQueryPromise<false, false> {
  const sql = sqlUser()
  return sql`DELETE FROM sections WHERE id = ${entityId} AND user_id = ${userId}`
}
