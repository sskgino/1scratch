// GET  /api/model-slots        — list all 10 slots (dense; empty slots returned as nulls)
// PUT  /api/model-slots        — upsert one slot: { slot, providerConnectionId, modelId, displayLabel? }

import { z } from 'zod'
import { resolveAuthedUserId } from '@/lib/auth-resolver'
import { listSlots, upsertSlot, SlotValidationError, SLOT_MIN, SLOT_MAX } from '@/lib/model-slots'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const userId = await resolveAuthedUserId(req)
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })
  const slots = await listSlots(userId)
  return Response.json({ slots })
}

const PutSchema = z.object({
  slot: z.number().int().min(SLOT_MIN).max(SLOT_MAX),
  providerConnectionId: z.string().uuid(),
  modelId: z.string().min(1).max(120),
  displayLabel: z.string().max(60).nullable().optional(),
})

export async function PUT(req: Request) {
  const userId = await resolveAuthedUserId(req)
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })
  const parsed = PutSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }
  try {
    const saved = await upsertSlot({
      userId,
      slot: parsed.data.slot,
      providerConnectionId: parsed.data.providerConnectionId,
      modelId: parsed.data.modelId,
      displayLabel: parsed.data.displayLabel ?? null,
    })
    return Response.json({ slot: saved })
  } catch (err) {
    if (err instanceof SlotValidationError) {
      return Response.json({ error: err.code, message: err.message }, { status: 400 })
    }
    throw err
  }
}
