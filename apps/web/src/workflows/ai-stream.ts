// Durable AI stream workflow. Wraps the per-turn provider call in
// Workflow DevKit so (a) transient provider 5xx / 429 failures move to the
// next model in the registry fallback chain, (b) usage accounting only
// writes after a successful attempt, and (c) the stream survives a
// function cold-start / redeploy.
//
// Design:
//   buildAttemptChain step → yields ordered [ {connection, model}, … ]
//   for each attempt:
//     runAttempt step streams text to getWritable() + returns usage
//       on transient failure → loop to next attempt
//       on auth/cap failure → stop (no point trying fallbacks)
//   writeUsageRow step → writes ai_usage row for the successful model
//
// The workflow function itself contains NO I/O — it's pure orchestration.

import { getWritable } from 'workflow'
import { streamText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { loadDecryptedKey, findConnectionByProvider } from '@/lib/providers'
import { resolveSlot } from '@/lib/model-slots'
import { getModel } from '@/lib/model-registry'
import { recordUsage } from '@/lib/spend-cap'
import type { ProviderId } from '@1scratch/types'

export interface StreamInput {
  userId: string
  cardId: string | null
  prompt: string
  // Resolution mode — exactly one of these three forms should produce a chain:
  slot?: number
  connectionId?: string
  provider?: ProviderId
  modelId?: string
}

export interface Attempt {
  connectionId: string
  modelId: string
  provider: ProviderId
}

export type WorkflowResult =
  | {
      modelUsed: string
      provider: ProviderId
      inputTokens: number
      outputTokens: number
    }
  | { error: string }

// ─── Steps (full Node.js access) ────────────────────────────────────────────

async function buildAttemptChain(input: StreamInput): Promise<Attempt[]> {
  'use step'

  let primary: { connectionId: string; modelId: string } | null = null

  if (input.slot !== undefined) {
    const r = await resolveSlot(input.userId, input.slot)
    if (r) primary = { connectionId: r.providerConnectionId, modelId: r.modelId }
  } else if (input.connectionId && input.modelId) {
    primary = { connectionId: input.connectionId, modelId: input.modelId }
  } else if (input.provider && input.modelId) {
    const conn = await findConnectionByProvider(input.userId, input.provider)
    if (conn) primary = { connectionId: conn.id, modelId: input.modelId }
  }
  if (!primary) return []

  const model = getModel(primary.modelId)
  if (!model) {
    // Off-registry model: single attempt, no fallback. Keep provider from
    // the stored connection so the SDK picks the right client.
    return input.provider
      ? [{ connectionId: primary.connectionId, modelId: primary.modelId, provider: input.provider }]
      : []
  }
  const chain: Attempt[] = [
    { connectionId: primary.connectionId, modelId: primary.modelId, provider: model.provider },
  ]
  // In-provider fallbacks reuse the same stored credential.
  for (const fallback of model.fallbackChain) {
    const fm = getModel(fallback)
    if (!fm) continue
    if (fm.provider === model.provider) {
      chain.push({
        connectionId: primary.connectionId,
        modelId: fallback,
        provider: fm.provider,
      })
    }
    // Cross-provider fallback deferred: would need per-provider
    // findConnectionByProvider lookup at workflow-start time.
  }
  return chain
}

type AttemptResult =
  | { ok: true; inputTokens: number; outputTokens: number }
  | { ok: false; kind: 'invalid' | 'transient' | 'no_key' | 'unsupported_provider' }

async function runAttempt(args: {
  userId: string
  attempt: Attempt
  prompt: string
}): Promise<AttemptResult> {
  'use step'

  const decrypted = await loadDecryptedKey(args.userId, args.attempt.connectionId)
  if (!decrypted) return { ok: false, kind: 'no_key' }

  let model
  switch (args.attempt.provider) {
    case 'anthropic':
      model = createAnthropic({ apiKey: decrypted.plaintext })(args.attempt.modelId)
      break
    case 'openai':
      model = createOpenAI({ apiKey: decrypted.plaintext })(args.attempt.modelId)
      break
    case 'google':
      model = createGoogleGenerativeAI({ apiKey: decrypted.plaintext })(args.attempt.modelId)
      break
    default:
      return { ok: false, kind: 'unsupported_provider' }
  }

  const writer = getWritable<string>().getWriter()
  try {
    const result = streamText({ model, prompt: args.prompt })
    try {
      for await (const chunk of result.textStream) {
        await writer.write(chunk)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (/401|403|invalid.?api.?key|unauthorized/i.test(msg)) {
        return { ok: false, kind: 'invalid' }
      }
      return { ok: false, kind: 'transient' }
    }
    const usage = await result.usage
    return {
      ok: true,
      inputTokens: usage?.inputTokens ?? 0,
      outputTokens: usage?.outputTokens ?? 0,
    }
  } finally {
    writer.releaseLock()
  }
}

async function writeUsageRow(args: {
  userId: string
  provider: ProviderId
  modelId: string
  inputTokens: number
  outputTokens: number
  cardId: string | null
}): Promise<void> {
  'use step'

  await recordUsage({
    userId: args.userId,
    provider: args.provider,
    model: args.modelId,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    cardId: args.cardId,
  })
}

// ─── Workflow (orchestration only) ──────────────────────────────────────────

export async function aiStreamWorkflow(input: StreamInput): Promise<WorkflowResult> {
  'use workflow'

  const chain = await buildAttemptChain(input)
  if (chain.length === 0) {
    return { error: 'no_connection_for_request' }
  }

  let lastError = 'unknown'
  for (const attempt of chain) {
    const res = await runAttempt({
      userId: input.userId,
      attempt,
      prompt: input.prompt,
    })
    if (res.ok) {
      await writeUsageRow({
        userId: input.userId,
        provider: attempt.provider,
        modelId: attempt.modelId,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
        cardId: input.cardId,
      })
      return {
        modelUsed: attempt.modelId,
        provider: attempt.provider,
        inputTokens: res.inputTokens,
        outputTokens: res.outputTokens,
      }
    }
    lastError = res.kind
    // Non-transient failures won't be fixed by the next model.
    if (res.kind === 'invalid' || res.kind === 'no_key') {
      break
    }
  }
  return { error: lastError }
}
