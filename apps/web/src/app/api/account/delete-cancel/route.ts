// POST /api/account/delete-cancel
// Authed. Cancels any active (pending|confirmed) deletion request.

import { auth } from '@clerk/nextjs/server'
import { cancelDeletion } from '@/lib/account-deletion'
import { record } from '@/lib/audit-events'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })
  const cancelled = await cancelDeletion(userId)
  if (!cancelled) {
    return Response.json({ error: 'no_active_request' }, { status: 404 })
  }
  const ip = req.headers.get('x-forwarded-for') ?? null
  const ua = req.headers.get('user-agent')
  await record(userId, 'account_delete_cancel', {
    ip,
    ua,
    meta: { requestId: cancelled.id },
  })
  return Response.json({ ok: true, request: cancelled })
}
