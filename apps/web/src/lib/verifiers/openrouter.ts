// OpenRouter probe: /api/v1/auth/key returns the key's status + limits in
// one call; we also fetch /api/v1/models for the model list.

import { fetchWithTimeout, type VerifyResult } from './index'

export async function verifyOpenrouter(apiKey: string): Promise<VerifyResult> {
  try {
    const authRes = await fetchWithTimeout('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (authRes.status === 401 || authRes.status === 403) {
      return { status: 'invalid', models: [], error: `auth_${authRes.status}` }
    }
    if (!authRes.ok) {
      return { status: 'unverified', models: [], error: `http_${authRes.status}` }
    }
    const modelsRes = await fetchWithTimeout('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
    })
    if (!modelsRes.ok) {
      // Auth worked but models list didn't — still mark connected.
      return { status: 'connected', models: [] }
    }
    const body = (await modelsRes.json()) as { data?: Array<{ id?: string }> }
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
