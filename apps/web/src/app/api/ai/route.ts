// POST /api/ai — multipart transcribe branch (Whisper via AI Gateway).
//
// voice.ts (mobile QuickCapture) posts an audio Blob with field
// `transcribe=true`. The route authenticates, checks the daily cap,
// runs Whisper through the AI Gateway, then writes a usage row charged
// at ~/min.
//
// JSON streaming requests live at /api/ai/stream/route.ts.

import { experimental_transcribe as transcribe } from 'ai'
import { resolveAuthedUserId } from '@/lib/auth-resolver'
import { checkCap } from '@/lib/spend-cap'
import { sqlUser, withRls } from '@/db/rls'

export const runtime = 'nodejs'
export const maxDuration = 60

const MICROS_PER_SECOND = 100n // /min = 0.0001/sec = 100 micros/sec

function utcDate(): string {
  return new Date().toISOString().slice(0, 10)
}

export async function POST(req: Request) {
  const ct = req.headers.get('content-type') ?? ''
  if (!ct.includes('multipart/form-data')) {
    return Response.json({ error: 'unsupported_content_type' }, { status: 415 })
  }

  const userId = await resolveAuthedUserId(req)
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const cap = await checkCap(userId)
  if (!cap.allowed) {
    return Response.json(
      { error: 'daily_cap_exceeded', usedCents: cap.usedCents, capCents: cap.capCents },
      { status: 402 },
    )
  }

  const form = await req.formData()
  if (form.get('transcribe') !== 'true') {
    return Response.json({ error: 'unsupported_form' }, { status: 400 })
  }
  const audio = form.get('audio')
  if (!(audio instanceof Blob)) {
    return Response.json({ error: 'audio_missing' }, { status: 400 })
  }

  const audioBytes = new Uint8Array(await audio.arrayBuffer())
  const result = await transcribe({
    model: 'openai/whisper-1',
    audio: audioBytes,
    providerOptions: {
      gateway: { user: userId, tags: ['feature:transcribe'] },
    },
  })

  const seconds = Math.max(1, Math.ceil(result.durationInSeconds ?? 5))
  const costMicros = BigInt(seconds) * MICROS_PER_SECOND

  const sql = sqlUser()
  await withRls(userId, [
    sql`INSERT INTO ai_usage
        (user_id, usage_date, provider, model, input_tokens, output_tokens, cost_micros, card_id)
        VALUES (${userId}, ${utcDate()}, 'openai', 'whisper-1',
                0, 0, ${costMicros.toString()}::bigint, NULL)`,
  ])

  return Response.json({ text: result.text })
}
