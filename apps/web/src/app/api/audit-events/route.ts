// GET /api/audit-events — last 100 audit events for the authed user.

import { auth } from '@clerk/nextjs/server'
import { listEvents } from '@/lib/audit-events'

export const runtime = 'nodejs'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })
  const events = await listEvents(userId, 100)
  return Response.json({ events })
}
