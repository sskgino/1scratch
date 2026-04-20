import { NextResponse } from 'next/server'
import { findSessionByRefresh, revokeSession } from '@/lib/mobile-sessions'
import { recordAdmin } from '@/lib/audit-events'

const BEARER_RE = /^Bearer\s+(.+)$/i

export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  const header = req.headers.get('authorization')
  const match = header?.match(BEARER_RE)
  if (!match) return new NextResponse('Unauthorized', { status: 401 })
  const refresh = match[1]!.trim()

  const sess = await findSessionByRefresh(refresh)
  await revokeSession(refresh)
  if (sess) {
    await recordAdmin(sess.userId, 'mobile_session_revoked', {
      meta: { session_id: sess.sessionId },
      ua: req.headers.get('user-agent'),
    })
  }
  return new NextResponse(null, { status: 204 })
}
