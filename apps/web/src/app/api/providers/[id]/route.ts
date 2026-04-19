// DELETE /api/providers/:id — remove a BYOK connection. Model slots
// referencing this connection are set to NULL via ON DELETE SET NULL.

import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { deleteConnection } from '@/lib/providers'
import { record } from '@/lib/audit-events'

export const runtime = 'nodejs'

const IdSchema = z.string().uuid()

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })
  const { id } = await params
  const parsed = IdSchema.safeParse(id)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_id' }, { status: 400 })
  }
  await deleteConnection(userId, parsed.data)
  await record(userId, 'credential_remove', {
    ip: req.headers.get('x-forwarded-for'),
    ua: req.headers.get('user-agent'),
    meta: { connectionId: parsed.data },
  })
  return new Response(null, { status: 204 })
}
