import { NextResponse } from 'next/server'
import { rotateSession } from '@/lib/mobile-sessions'
import { recordAdmin } from '@/lib/audit-events'

const BEARER_RE = /^Bearer\s+(.+)$/i

export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  const header = req.headers.get('authorization')
  const match = header?.match(BEARER_RE)
  if (!match) return new NextResponse('Unauthorized', { status: 401 })

  const rotated = await rotateSession(match[1]!.trim())
  if (!rotated) return new NextResponse('Unauthorized', { status: 401 })

  await recordAdmin(rotated.userId, 'mobile_session_refreshed', {
    meta: { session_id: rotated.sessionId },
    ua: req.headers.get('user-agent'),
  })

  return NextResponse.json({
    access_jwt: rotated.accessToken,
    access_exp: rotated.accessExp,
    refresh_token: rotated.refreshToken,
    refresh_exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    user: { id: rotated.userId },
  })
}
