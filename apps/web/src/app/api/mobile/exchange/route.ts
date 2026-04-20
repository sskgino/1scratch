import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSession } from '@/lib/mobile-sessions'
import { recordAdmin } from '@/lib/audit-events'

const bodySchema = z.object({
  device_id: z.string().min(8).max(64),
  device_label: z.string().max(120).optional(),
})

export const runtime = 'nodejs'

export async function POST(req: Request): Promise<Response> {
  const { userId } = await auth()
  if (!userId) return new NextResponse('Unauthorized', { status: 401 })

  const json = await req.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', detail: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const session = await createSession({
    userId,
    deviceId: parsed.data.device_id,
    deviceLabel: parsed.data.device_label,
  })
  await recordAdmin(userId, 'mobile_session_created', {
    meta: { session_id: session.sessionId, device_id: parsed.data.device_id },
    ua: req.headers.get('user-agent'),
  })

  return NextResponse.json({
    access_jwt: session.accessToken,
    access_exp: session.accessExp,
    refresh_token: session.refreshToken,
    refresh_exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    user: { id: session.userId },
  })
}
