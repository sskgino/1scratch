// Static model registry. Canonical list of models we expose in slot picker
// and the pricing/fallback rules used by /api/ai/stream.
//
// PLAN.md §1 has Edge Config as the long-term home for this (hot-reloadable,
// no redeploy). That lands in Phase 4. Until then, a typed static table is
// the correct simple-first choice — changes ship on deploy.
//
// Pricing uses micros (1 cent = 10_000 micros) to match ai_usage.cost_micros.

import type { ProviderId } from '@1scratch/types'

export interface ModelEntry {
  id: string                        // canonical id as accepted by the provider SDK
  provider: ProviderId
  displayName: string
  displayAbbr: string               // 3-4 char pill label (Model page §7)
  contextWindow: number
  // Cost per 1M tokens, in micros. (1M input tokens × input_per_1m_micros / 1M = cost)
  inputPerMTokenMicros: bigint
  outputPerMTokenMicros: bigint
  capabilities: {
    vision: boolean
    tools: boolean
  }
  // Ordered list of model ids to try if this model's provider returns 5xx/429.
  // Empty means "no fallback — surface the error to the user".
  fallbackChain: string[]
}

// Keep additions here small + curated. The slot picker shows ALL models that
// match a user's connected providers. Deprecate/rename via the `id` being
// absent rather than mutating an entry's `id`.
export const MODEL_REGISTRY: Record<string, ModelEntry> = {
  // ─── Anthropic ────────────────────────────────────────────────────────────
  'claude-sonnet-4.6': {
    id: 'claude-sonnet-4.6',
    provider: 'anthropic',
    displayName: 'Claude Sonnet 4.6',
    displayAbbr: 'Snt',
    contextWindow: 200_000,
    inputPerMTokenMicros: 30_000_000n,
    outputPerMTokenMicros: 150_000_000n,
    capabilities: { vision: true, tools: true },
    fallbackChain: ['claude-haiku-4.5'],
  },
  'claude-haiku-4.5': {
    id: 'claude-haiku-4.5',
    provider: 'anthropic',
    displayName: 'Claude Haiku 4.5',
    displayAbbr: 'Hku',
    contextWindow: 200_000,
    inputPerMTokenMicros: 10_000_000n,
    outputPerMTokenMicros: 50_000_000n,
    capabilities: { vision: true, tools: true },
    fallbackChain: [],
  },
  'claude-opus-4.6': {
    id: 'claude-opus-4.6',
    provider: 'anthropic',
    displayName: 'Claude Opus 4.6',
    displayAbbr: 'Ops',
    contextWindow: 200_000,
    inputPerMTokenMicros: 150_000_000n,
    outputPerMTokenMicros: 750_000_000n,
    capabilities: { vision: true, tools: true },
    fallbackChain: ['claude-sonnet-4.6', 'claude-haiku-4.5'],
  },

  // ─── OpenAI ───────────────────────────────────────────────────────────────
  'gpt-5.4': {
    id: 'gpt-5.4',
    provider: 'openai',
    displayName: 'GPT-5.4',
    displayAbbr: '5.4',
    contextWindow: 400_000,
    inputPerMTokenMicros: 15_000_000n,
    outputPerMTokenMicros: 60_000_000n,
    capabilities: { vision: true, tools: true },
    fallbackChain: [],
  },

  // ─── Google ───────────────────────────────────────────────────────────────
  'gemini-2.5-pro': {
    id: 'gemini-2.5-pro',
    provider: 'google',
    displayName: 'Gemini 2.5 Pro',
    displayAbbr: 'Gm2',
    contextWindow: 1_000_000,
    inputPerMTokenMicros: 12_500_000n,
    outputPerMTokenMicros: 50_000_000n,
    capabilities: { vision: true, tools: true },
    fallbackChain: ['gemini-2.5-flash'],
  },
  'gemini-2.5-flash': {
    id: 'gemini-2.5-flash',
    provider: 'google',
    displayName: 'Gemini 2.5 Flash',
    displayAbbr: 'Flh',
    contextWindow: 1_000_000,
    inputPerMTokenMicros: 3_000_000n,
    outputPerMTokenMicros: 12_000_000n,
    capabilities: { vision: true, tools: true },
    fallbackChain: [],
  },
}

export function getModel(id: string): ModelEntry | null {
  return MODEL_REGISTRY[id] ?? null
}

export function modelsByProvider(provider: ProviderId): ModelEntry[] {
  return Object.values(MODEL_REGISTRY).filter((m) => m.provider === provider)
}

export function estimateCostMicros(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): bigint {
  const m = getModel(modelId)
  // Fall back to the spend-cap default table if the model is unknown —
  // callers should still see a non-zero cost so the cap can't be bypassed
  // by sending an off-registry model id.
  if (!m) {
    const FALLBACK_IN = 30_000_000n
    const FALLBACK_OUT = 150_000_000n
    return (
      (BigInt(inputTokens) * FALLBACK_IN) / 1_000_000n +
      (BigInt(outputTokens) * FALLBACK_OUT) / 1_000_000n
    )
  }
  return (
    (BigInt(inputTokens) * m.inputPerMTokenMicros) / 1_000_000n +
    (BigInt(outputTokens) * m.outputPerMTokenMicros) / 1_000_000n
  )
}
