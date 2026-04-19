// POST /api/ai/stream — durable AI stream via Workflow DevKit.
//
// The route's only job is: auth gate → cap check → start workflow →
// return the workflow's default readable stream as the HTTP body. All
// provider selection, BYOK decryption, streaming, fallback, and usage
// accounting live in src/workflows/ai-stream.ts.
//
// The workflow survives cold-starts and per-attempt retries; the request
// itself stays open via the Readable piped from `run.getReadable()`.

import { auth } from '@clerk/nextjs/server'
import { start } from 'workflow/api'
import { checkBotId } from 'botid/server'
import { z } from 'zod'
import { checkCap } from '@/lib/spend-cap'
import { aiStreamWorkflow } from '@/workflows/ai-stream'

export const runtime = 'nodejs'
export const maxDuration = 300

const BodySchema = z
  .object({
    prompt: z.string().min(1).max(10_000),
    cardId: z.string().uuid().optional(),
    // Resolution — one of the following three forms must be present:
    slot: z.number().int().min(0).max(9).optional(),
    connectionId: z.string().uuid().optional(),
    provider: z
      .enum(['anthropic', 'openai', 'google', 'openrouter'])
      .optional(),
    modelId: z.string().min(1).max(120).optional(),
  })
  .refine(
    (v) =>
      v.slot !== undefined ||
      (v.connectionId && v.modelId) ||
      (v.provider && v.modelId),
    { message: 'must supply slot, {connectionId, modelId}, or {provider, modelId}' },
  )

export async function POST(req: Request) {
  const bot = await checkBotId()
  if (bot.isBot) return Response.json({ error: 'bot_detected' }, { status: 403 })

  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }
  const body = parsed.data

  const cap = await checkCap(userId)
  if (!cap.allowed) {
    return Response.json(
      { error: 'daily_cap_exceeded', usedCents: cap.usedCents, capCents: cap.capCents },
      { status: 402 },
    )
  }

  const run = await start(aiStreamWorkflow, [
    {
      userId,
      cardId: body.cardId ?? null,
      prompt: body.prompt,
      slot: body.slot,
      connectionId: body.connectionId,
      provider: body.provider,
      modelId: body.modelId,
    },
  ])

  return new Response(run.getReadable(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Workflow-Run-Id': run.runId,
      'Cache-Control': 'no-store',
    },
  })
}
