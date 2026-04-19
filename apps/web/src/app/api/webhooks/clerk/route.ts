// Clerk webhook handler. Uses verifyWebhook from @clerk/nextjs/webhooks
// which reads CLERK_WEBHOOK_SECRET automatically and validates the svix
// signature. Handles:
//   - user.created  → upsert users row (admin connection — signing user
//                     hasn't made an authed request yet)
//   - user.deleted  → cascade via users FK
//   - email.created → forward to Resend so transactional mail flows
//                     through our own sender (Clerk dashboard removed
//                     Custom SMTP; see PLAN.md build log 2026-04-17)

import { verifyWebhook } from '@clerk/nextjs/webhooks'
import { Resend } from 'resend'
import type { NextRequest } from 'next/server'
import { sqlAdmin } from '@/db/rls'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type EmailAddr = { email_address: string }

export async function POST(req: NextRequest) {
  let evt
  try {
    evt = await verifyWebhook(req)
  } catch (err) {
    console.error('[webhooks/clerk] verification failed', err)
    return Response.json({ error: 'invalid_signature' }, { status: 400 })
  }

  try {
    if (evt.type === 'user.created') {
      const d = evt.data
      const email = (d.email_addresses as EmailAddr[]).find(
        (e) => e.email_address,
      )?.email_address
      if (!email) {
        console.error('[webhooks/clerk] user.created without email', d.id)
        return Response.json({ ok: true })
      }
      const displayName =
        [d.first_name, d.last_name].filter(Boolean).join(' ') || null
      const sql = sqlAdmin()
      await sql`
        INSERT INTO users (id, email, display_name)
        VALUES (${d.id}, ${email}, ${displayName})
        ON CONFLICT (id) DO UPDATE
          SET email = EXCLUDED.email,
              display_name = EXCLUDED.display_name,
              updated_at = now()
      `
    }

    if (evt.type === 'user.deleted') {
      const id = evt.data.id
      if (!id) return Response.json({ ok: true })
      const sql = sqlAdmin()
      await sql`DELETE FROM users WHERE id = ${id}`
    }

    if (evt.type === 'email.created') {
      const key = process.env.RESEND_API_KEY
      const from = process.env.RESEND_FROM_ADDRESS ?? 'support@1scratch.ai'
      if (!key) {
        console.error('[webhooks/clerk] RESEND_API_KEY not set; dropping email')
        return Response.json({ ok: true })
      }
      const d = evt.data as {
        to_email_address: string
        subject: string
        body: string
        body_plain?: string
      }
      // Use the Svix delivery id as the idempotency key so Svix retries
      // don't produce duplicate sends within Resend's 24h window.
      const svixId = req.headers.get('svix-id') ?? undefined
      const resend = new Resend(key)
      const { error } = await resend.emails.send(
        {
          from,
          to: d.to_email_address,
          subject: d.subject,
          html: d.body,
          ...(d.body_plain ? { text: d.body_plain } : {}),
        },
        svixId ? { idempotencyKey: `clerk-email/${svixId}` } : undefined,
      )
      if (error) {
        console.error('[webhooks/clerk] resend send failed', error)
        return Response.json({ error: 'resend_failed' }, { status: 500 })
      }
    }

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[webhooks/clerk] handler failed', evt.type, err)
    // 500 so Svix retries per at-least-once delivery semantics.
    return Response.json({ error: 'handler_error' }, { status: 500 })
  }
}
