import { auth } from '@clerk/nextjs/server'
import { checkCap } from '@/lib/spend-cap'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })
  const cap = await checkCap(userId)
  return Response.json(cap)
}
