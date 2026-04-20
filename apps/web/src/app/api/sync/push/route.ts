import { NextResponse } from 'next/server'
import { resolveAuthedUserId } from '@/lib/auth-resolver'
import { applyPush } from '@/lib/sync/apply-push'
import { pushRequestSchema } from '@/lib/sync/validate'

export async function POST(req: Request) {
  const userId = await resolveAuthedUserId(req)
  if (!userId) return new NextResponse('Unauthorized', { status: 401 })

  const json = await req.json().catch(() => null)
  const parsed = pushRequestSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_body', detail: parsed.error.flatten() }, { status: 400 })
  }

  const result = await applyPush(userId, parsed.data)
  return NextResponse.json(result)
}
