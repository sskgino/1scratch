// POST /api/account/delete-request
// Authed. Creates a pending deletion request + emails the user a confirm link.
// The 24-hr cool-off clock starts on confirm, not on request — so a user who
// never clicks the email never loses data.

import { auth, currentUser } from '@clerk/nextjs/server'
import { Resend } from 'resend'
import { requestDeletion, DeletionError } from '@/lib/account-deletion'
import { record } from '@/lib/audit-events'

export const runtime = 'nodejs'

function appOrigin(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.1scratch.ai'
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  const user = await currentUser()
  const email = user?.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress
  if (!email) {
    return Response.json({ error: 'no_primary_email' }, { status: 400 })
  }

  let token: string
  let requestId: string
  try {
    const result = await requestDeletion(userId)
    token = result.token
    requestId = result.request.id
  } catch (err) {
    if (err instanceof DeletionError) {
      return Response.json({ error: err.code, message: err.message }, { status: 409 })
    }
    throw err
  }

  const confirmUrl = `${appOrigin()}/account/delete-confirm?token=${encodeURIComponent(token)}`

  const key = process.env.RESEND_API_KEY
  if (key) {
    const from = process.env.RESEND_FROM_ADDRESS ?? 'support@1scratch.ai'
    const resend = new Resend(key)
    const { error } = await resend.emails.send({
      from,
      to: email,
      subject: '1Scratch — confirm account deletion',
      text: `Someone requested deletion of your 1Scratch account.\n\nTo confirm, click this link within 7 days:\n${confirmUrl}\n\nAfter confirming, your account enters a 24-hour cool-off. You can cancel from Settings during that window.\n\nIf this wasn't you, ignore this email.`,
      html: `<p>Someone requested deletion of your 1Scratch account.</p>
             <p><a href="${confirmUrl}">Confirm account deletion</a></p>
             <p>After confirming, a 24-hour cool-off starts. You can cancel from Settings during that window.</p>
             <p>If this wasn't you, ignore this email.</p>`,
    })
    if (error) {
      console.error('[account/delete-request] resend failed', error)
      return Response.json({ error: 'email_failed' }, { status: 500 })
    }
  } else {
    console.warn('[account/delete-request] RESEND_API_KEY unset — confirm link only returned in response body (dev mode)')
  }

  const ip = req.headers.get('x-forwarded-for') ?? null
  const ua = req.headers.get('user-agent')
  await record(userId, 'account_delete_request', {
    ip,
    ua,
    meta: { requestId },
  })

  return Response.json({
    ok: true,
    requestId,
    // Only echo the confirmUrl in dev (no email sent). Production response
    // reveals nothing beyond ok/requestId.
    ...(key ? {} : { confirmUrl }),
  })
}
