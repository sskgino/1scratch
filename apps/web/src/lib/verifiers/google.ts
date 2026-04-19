// Google AI Studio probe: /v1beta/models?key=… Returns model list without tokens.

import { fetchWithTimeout, type VerifyResult } from './index'

export async function verifyGoogle(apiKey: string): Promise<VerifyResult> {
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
    const res = await fetchWithTimeout(url)
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { status: 'invalid', models: [], error: `auth_${res.status}` }
    }
    if (!res.ok) {
      return { status: 'unverified', models: [], error: `http_${res.status}` }
    }
    const body = (await res.json()) as { models?: Array<{ name?: string }> }
    // name format: "models/gemini-2.5-pro". Strip prefix.
    const models = (body.models ?? [])
      .map((m) => (typeof m.name === 'string' ? m.name.replace(/^models\//, '') : null))
      .filter((id): id is string => id !== null)
    return { status: 'connected', models }
  } catch (err) {
    return {
      status: 'unverified',
      models: [],
      error: err instanceof Error ? err.message : 'network_error',
    }
  }
}
