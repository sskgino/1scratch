// POST /api/account/delete-confirm  { token }
// Public — the token is the proof of identity. Flips pending → confirmed and
// starts the 24-hr countdown.

import { z } from 'zod'
import { confirmDeletion, DeletionError } from '@/lib/account-deletion'
import { recordAdmin } from '@/lib/audit-events'

export const runtime = 'nodejs'

const Body = z.object({ token: z.string().min(10).max(200) })

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  try {
    const { userId, request } = await confirmDeletion(parsed.data.token)
    const ip = req.headers.get('x-forwarded-for') ?? null
    const ua = req.headers.get('user-agent')
    await recordAdmin(userId, 'account_delete_confirm', {
      ip,
      ua,
      meta: { requestId: request.id, executesAfter: request.executesAfter },
    })
    return Response.json({
      ok: true,
      executesAfter: request.executesAfter,
    })
  } catch (err) {
    if (err instanceof DeletionError) {
      return Response.json({ error: err.code }, { status: 400 })
    }
    throw err
  }
}
