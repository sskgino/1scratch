// Anthropic probe: hit /v1/models. It's cheap (no tokens charged) and
// returns the list of models this API key can see.

import { fetchWithTimeout, type VerifyResult } from './index'

export async function verifyAnthropic(apiKey: string): Promise<VerifyResult> {
  try {
    const res = await fetchWithTimeout('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    })
    if (res.status === 401 || res.status === 403) {
      return { status: 'invalid', models: [], error: `auth_${res.status}` }
    }
    if (!res.ok) {
      return { status: 'unverified', models: [], error: `http_${res.status}` }
    }
    const body = (await res.json()) as { data?: Array<{ id?: string }> }
    const models = (body.data ?? [])
      .map((m) => m.id)
      .filter((id): id is string => typeof id === 'string')
    return { status: 'connected', models }
  } catch (err) {
    return {
      status: 'unverified',
      models: [],
      error: err instanceof Error ? err.message : 'network_error',
    }
  }
}
