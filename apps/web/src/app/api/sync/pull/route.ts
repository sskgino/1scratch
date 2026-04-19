import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { fetchSince } from '@/lib/sync/fetch-since'
import { pullQuerySchema } from '@/lib/sync/validate'

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return new NextResponse('Unauthorized', { status: 401 })

  const url = new URL(req.url)
  const parsed = pullQuerySchema.safeParse({
    since: url.searchParams.get('since') ?? '',
    limit: url.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_query', detail: parsed.error.flatten() }, { status: 400 })
  }

  const result = await fetchSince(userId, parsed.data.since, parsed.data.limit)
  return NextResponse.json(result)
}
