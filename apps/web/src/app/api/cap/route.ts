import { resolveAuthedUserId } from '@/lib/auth-resolver'
import { checkCap } from '@/lib/spend-cap'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const userId = await resolveAuthedUserId(req)
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })
  const cap = await checkCap(userId)
  return Response.json(cap)
}
