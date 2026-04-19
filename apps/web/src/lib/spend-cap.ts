// Per-user daily spend cap. PLAN.md §2 threat "runaway AI cost" — every
// proxy call checks today's ai_usage sum against users.daily_ai_cap_cents.
//
// Units: cost_micros column stores cost in millionths of a cent — i.e.
// 1 cent = 10_000 micros. Cap is stored in cents.

import { sqlUser, withRls } from '@/db/rls'
import { estimateCostMicros as registryEstimate } from './model-registry'

const MICROS_PER_CENT = 10_000n

// Kept for backwards compatibility with existing tests. Prefer the
// registry-aware estimator on the `model-registry` module for new callers.
export function estimateCostMicros(input: number, output: number, modelId?: string): bigint {
  return registryEstimate(modelId ?? '', input, output)
}

export interface CapStatus {
  allowed: boolean
  usedCents: number
  capCents: number
}

function utcDate(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD
}

export async function checkCap(userId: string): Promise<CapStatus> {
  const sql = sqlUser()
  const [userRows, usageRows] = await withRls<
    [Array<{ daily_ai_cap_cents: number }>, Array<{ used_micros: string | null }>]
  >(userId, [
    sql`SELECT daily_ai_cap_cents FROM users WHERE id = ${userId}`,
    sql`SELECT coalesce(sum(cost_micros), 0)::text AS used_micros
        FROM ai_usage
        WHERE user_id = ${userId} AND usage_date = ${utcDate()}`,
  ])
  const capCents = userRows[0]?.daily_ai_cap_cents ?? 0
  const usedMicros = BigInt(usageRows[0]?.used_micros ?? '0')
  const usedCents = Number(usedMicros / MICROS_PER_CENT)
  return {
    allowed: usedCents < capCents,
    usedCents,
    capCents,
  }
}

export async function recordUsage(args: {
  userId: string
  provider: string
  model: string
  inputTokens: number
  outputTokens: number
  cardId?: string | null
}): Promise<void> {
  const cost = registryEstimate(args.model, args.inputTokens, args.outputTokens)
  const sql = sqlUser()
  await withRls(args.userId, [
    sql`INSERT INTO ai_usage
        (user_id, usage_date, provider, model, input_tokens, output_tokens, cost_micros, card_id)
        VALUES (${args.userId}, ${utcDate()}, ${args.provider}, ${args.model},
                ${args.inputTokens}, ${args.outputTokens},
                ${cost.toString()}::bigint, ${args.cardId ?? null})`,
  ])
}
