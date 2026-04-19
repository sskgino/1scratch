// Cron: purge confirmed deletion requests whose 24-hr window elapsed.
// Scheduled daily via vercel.ts. Protected by CRON_SECRET header check
// (Vercel injects `Authorization: Bearer <CRON_SECRET>` automatically).

import { clerkClient } from '@clerk/nextjs/server'
import { executeDeletion, listDueForExecution } from '@/lib/account-deletion'
import { recordAdmin } from '@/lib/audit-events'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = req.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) {
      return Response.json({ error: 'unauthorized' }, { status: 401 })
    }
  }

  const due = await listDueForExecution()
  const results: Array<{ userId: string; ok: boolean; error?: string }> = []
  const clerk = await clerkClient()

  for (const r of due) {
    try {
      await executeDeletion(r.id, r.userId)
      await recordAdmin(r.userId, 'account_delete_executed', { meta: { requestId: r.id } })
      // Delete the Clerk identity after the DB cascade. Clerk webhook
      // `user.deleted` would also delete the users row — but we already did,
      // so the webhook becomes a no-op.
      try {
        await clerk.users.deleteUser(r.userId)
      } catch (err) {
        console.error('[cron/purge-deletions] clerk deleteUser failed', r.userId, err)
      }
      results.push({ userId: r.userId, ok: true })
    } catch (err) {
      console.error('[cron/purge-deletions] execute failed', r.userId, err)
      results.push({
        userId: r.userId,
        ok: false,
        error: err instanceof Error ? err.message : 'unknown',
      })
    }
  }

  return Response.json({ processed: due.length, results })
}
