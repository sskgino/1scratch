// Provider verifiers. Each verifier runs a cheap "does this credential
// work?" probe against the provider's API and returns a normalized result.
//
// Design:
//   - Pure functions: (plaintextSecret, endpointUrl?) → VerifyResult
//   - No DB / no Clerk — callers wire those in.
//   - Timeouts are short (5s) so the slot-picker modal stays responsive.
//   - `models[]` is the list of model ids the provider reports for this key;
//     the slot picker intersects this with MODEL_REGISTRY.

import type { ProviderId, ProviderStatus } from '@1scratch/types'
import { verifyAnthropic } from './anthropic'
import { verifyOpenai } from './openai'
import { verifyGoogle } from './google'
import { verifyOpenrouter } from './openrouter'
import { verifyOllama } from './ollama'

export interface VerifyResult {
  status: ProviderStatus        // 'connected' | 'invalid' | 'unverified' | 'revoked'
  models: string[]              // provider-native model ids
  error?: string
}

export interface VerifyInput {
  provider: ProviderId
  secret: string                // API key plaintext, OR bearer for Ollama
  endpointUrl?: string          // Ollama only
}

export const VERIFY_TIMEOUT_MS = 5_000

export async function verifyProvider(input: VerifyInput): Promise<VerifyResult> {
  switch (input.provider) {
    case 'anthropic':
      return verifyAnthropic(input.secret)
    case 'openai':
      return verifyOpenai(input.secret)
    case 'google':
      return verifyGoogle(input.secret)
    case 'openrouter':
      return verifyOpenrouter(input.secret)
    case 'ollama':
      if (!input.endpointUrl) {
        return { status: 'invalid', models: [], error: 'endpoint_url_required' }
      }
      return verifyOllama(input.endpointUrl, input.secret)
    default:
      return { status: 'invalid', models: [], error: `unsupported_provider:${input.provider}` }
  }
}

// Small helper every verifier uses to time out probes.
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  ms: number = VERIFY_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
