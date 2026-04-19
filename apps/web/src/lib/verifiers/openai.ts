// OpenAI probe: /v1/models. Free endpoint, returns accessible model ids.

import { fetchWithTimeout, type VerifyResult } from './index'

export async function verifyOpenai(apiKey: string): Promise<VerifyResult> {
  try {
    const res = await fetchWithTimeout('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${apiKey}` },
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
