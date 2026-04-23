// GET /api/audit-events — last 100 audit events for the authed user.

import { resolveAuthedUserId } from '@/lib/auth-resolver'
import { listEvents } from '@/lib/audit-events'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const userId = await resolveAuthedUserId(req)
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })
  const events = await listEvents(userId, 100)
  return Response.json({ events })
}
