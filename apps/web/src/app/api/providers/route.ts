// POST /api/providers — save a BYOK API key for the authed user.
// GET  /api/providers — list the authed user's connections (public shape only).

import { checkBotId } from 'botid/server'
import { z } from 'zod'
import { resolveAuthedUserId } from '@/lib/auth-resolver'
import { listConnections, saveApiKey } from '@/lib/providers'
import { record } from '@/lib/audit-events'

export const runtime = 'nodejs'

const BodySchema = z
  .object({
    provider: z.enum([
      'anthropic',
      'openai',
      'google',
      'openrouter',
      'mistral',
      'cohere',
      'groq',
      'xai',
      'ollama',
    ]),
    label: z.string().max(60).nullable().optional(),
    apiKey: z.string().max(500).optional(),
    endpointUrl: z.string().url().max(500).optional(),
  })
  .refine(
    (v) => v.provider === 'ollama' ? !!v.endpointUrl : (v.apiKey?.length ?? 0) >= 10,
    { message: 'ollama requires endpointUrl; others require apiKey' },
  )

export async function GET(req: Request) {
  const userId = await resolveAuthedUserId(req)
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })
  const connections = await listConnections(userId)
  return Response.json({ connections })
}

export async function POST(req: Request) {
  const bot = await checkBotId()
  if (bot.isBot) return Response.json({ error: 'bot_detected' }, { status: 403 })

  const userId = await resolveAuthedUserId(req)
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  const parsed = BodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: 'invalid_body', issues: parsed.error.issues }, { status: 400 })
  }
  const saved = await saveApiKey({
    userId,
    provider: parsed.data.provider,
    label: parsed.data.label ?? null,
    plaintext: parsed.data.apiKey ?? '',
    endpointUrl: parsed.data.endpointUrl ?? null,
  })
  await record(userId, 'credential_add', {
    ip: req.headers.get('x-forwarded-for'),
    ua: req.headers.get('user-agent'),
    meta: { connectionId: saved.id, provider: saved.provider },
  })
  return Response.json({ connection: saved }, { status: 201 })
}
