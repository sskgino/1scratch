// DELETE /api/model-slots/:slot — clear a slot row (slot itself remains addressable; next PUT recreates it).

import { resolveAuthedUserId } from '@/lib/auth-resolver'
import { clearSlot, SlotValidationError } from '@/lib/model-slots'

export const runtime = 'nodejs'

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ slot: string }> },
) {
  const userId = await resolveAuthedUserId(req)
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })
  const { slot } = await params
  const n = Number.parseInt(slot, 10)
  if (!Number.isFinite(n)) {
    return Response.json({ error: 'invalid_slot' }, { status: 400 })
  }
  try {
    await clearSlot(userId, n)
    return new Response(null, { status: 204 })
  } catch (err) {
    if (err instanceof SlotValidationError) {
      return Response.json({ error: err.code, message: err.message }, { status: 400 })
    }
    throw err
  }
}
