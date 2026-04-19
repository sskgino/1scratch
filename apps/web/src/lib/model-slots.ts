// Per-user model_slots CRUD. Slots 0–9 map to (connection, model_id)
// pairs; see PLAN.md §3 and §7. Empty slots are represented by the
// *absence* of a row — list() returns a dense 10-element array with
// `null`s so the client can render every pill.

import { sqlUser, withRls } from '@/db/rls'
import type { ModelSlot, ProviderId } from '@1scratch/types'
import { getModel } from './model-registry'

export const SLOT_MIN = 0
export const SLOT_MAX = 9

interface SlotRow {
  slot: number
  provider_connection_id: string | null
  model_id: string | null
  display_label: string | null
}

export async function listSlots(userId: string): Promise<ModelSlot[]> {
  const sql = sqlUser()
  const [rows] = await withRls<[SlotRow[]]>(userId, [
    sql`SELECT slot, provider_connection_id, model_id, display_label
        FROM model_slots
        WHERE user_id = ${userId}
        ORDER BY slot`,
  ])
  const byIdx = new Map<number, SlotRow>(rows.map((r) => [r.slot, r]))
  const out: ModelSlot[] = []
  for (let i = SLOT_MIN; i <= SLOT_MAX; i++) {
    const r = byIdx.get(i)
    out.push({
      slot: i,
      providerConnectionId: r?.provider_connection_id ?? null,
      modelId: r?.model_id ?? null,
      displayLabel: r?.display_label ?? null,
    })
  }
  return out
}

export interface UpsertSlotArgs {
  userId: string
  slot: number
  providerConnectionId: string
  modelId: string
  displayLabel: string | null
}

export class SlotValidationError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export async function upsertSlot(args: UpsertSlotArgs): Promise<ModelSlot> {
  if (args.slot < SLOT_MIN || args.slot > SLOT_MAX) {
    throw new SlotValidationError('invalid_slot', `slot must be ${SLOT_MIN}-${SLOT_MAX}`)
  }
  const model = getModel(args.modelId)
  if (!model) {
    throw new SlotValidationError('unknown_model', `model_id not in registry`)
  }
  const sql = sqlUser()
  // Confirm the connection belongs to the user and provider matches.
  // RLS already scopes reads, but the provider match is a correctness
  // check the schema can't express.
  const [conn] = await withRls<[Array<{ provider: ProviderId }>]>(args.userId, [
    sql`SELECT provider FROM provider_connections
        WHERE id = ${args.providerConnectionId}
        LIMIT 1`,
  ])
  const row = conn[0]
  if (!row) {
    throw new SlotValidationError('unknown_connection', 'connection not found')
  }
  if (row.provider !== model.provider) {
    throw new SlotValidationError(
      'provider_mismatch',
      `model ${args.modelId} requires provider ${model.provider}, not ${row.provider}`,
    )
  }

  await withRls(args.userId, [
    sql`INSERT INTO model_slots (user_id, slot, provider_connection_id, model_id, display_label)
        VALUES (${args.userId}, ${args.slot}, ${args.providerConnectionId}, ${args.modelId}, ${args.displayLabel})
        ON CONFLICT (user_id, slot) DO UPDATE SET
          provider_connection_id = EXCLUDED.provider_connection_id,
          model_id = EXCLUDED.model_id,
          display_label = EXCLUDED.display_label,
          updated_at = now()`,
  ])
  return {
    slot: args.slot,
    providerConnectionId: args.providerConnectionId,
    modelId: args.modelId,
    displayLabel: args.displayLabel,
  }
}

export async function clearSlot(userId: string, slot: number): Promise<void> {
  if (slot < SLOT_MIN || slot > SLOT_MAX) {
    throw new SlotValidationError('invalid_slot', `slot must be ${SLOT_MIN}-${SLOT_MAX}`)
  }
  const sql = sqlUser()
  await withRls(userId, [
    sql`DELETE FROM model_slots WHERE user_id = ${userId} AND slot = ${slot}`,
  ])
}

export async function resolveSlot(
  userId: string,
  slot: number,
): Promise<{ providerConnectionId: string; modelId: string } | null> {
  const sql = sqlUser()
  const [rows] = await withRls<[SlotRow[]]>(userId, [
    sql`SELECT slot, provider_connection_id, model_id, display_label
        FROM model_slots
        WHERE user_id = ${userId} AND slot = ${slot}
        LIMIT 1`,
  ])
  const r = rows[0]
  if (!r || !r.provider_connection_id || !r.model_id) return null
  return { providerConnectionId: r.provider_connection_id, modelId: r.model_id }
}
