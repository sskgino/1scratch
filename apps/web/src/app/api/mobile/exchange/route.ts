import { auth, currentUser } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSession } from '@/lib/mobile-sessions'
import { recordAdmin } from '@/lib/audit-events'
import { sqlAdmin } from '@/db/rls'

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

  // Lazy-provision the users row. The Clerk webhook usually does this on
  // user.created, but pre-webhook users (or a missed delivery) leave the
  // device_sessions FK with no target. Idempotent on conflict.
  const user = await currentUser()
  const email =
    user?.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)
      ?.emailAddress ?? user?.emailAddresses[0]?.emailAddress
  if (!email) return new NextResponse('user_email_missing', { status: 422 })
  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(' ') || null
  await sqlAdmin()`
    INSERT INTO users (id, email, display_name)
    VALUES (${userId}, ${email}, ${displayName})
    ON CONFLICT (id) DO NOTHING
  `

  const session = await createSession({
    userId,
    deviceId: parsed.data.device_id,
    deviceLabel: parsed.data.device_label,
  })
  await recordAdmin(userId, 'mobile_session_created', {
    meta: { session_id: session.sessionId, device_id: parsed.data.device_id },
    ua: req.headers.get('user-agent'),
  })

  const res = NextResponse.json({
    access_jwt: session.accessToken,
    access_exp: session.accessExp,
    refresh_token: session.refreshToken,
    refresh_exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    user: { id: session.userId },
  })
  const clear = { httpOnly: true, sameSite: 'lax' as const, path: '/', maxAge: 0 }
  res.cookies.set('mobile_return', '', clear)
  res.cookies.set('mobile_device_id', '', clear)
  res.cookies.set('mobile_device_label', '', clear)
  return res
}
