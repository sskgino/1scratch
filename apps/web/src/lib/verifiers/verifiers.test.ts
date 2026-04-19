// Unit tests for provider verifiers. fetch is mocked globally — no live
// API calls. Every verifier must classify the same four cases the same way:
//   - 200 OK with models   → connected
//   - 401 / 403            → invalid
//   - 500 / network error  → unverified
//   - auth OK, models 404  → connected, empty list (OpenRouter only)

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { verifyAnthropic } from './anthropic'
import { verifyOpenai } from './openai'
import { verifyGoogle } from './google'
import { verifyOpenrouter } from './openrouter'
import { verifyOllama, isServerVerifiable } from './ollama'

type FetchArgs = Parameters<typeof fetch>

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('verifyAnthropic', () => {
  it('returns connected + model list on 200', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: [{ id: 'claude-sonnet-4.6' }, { id: 'claude-haiku-4.5' }] }),
    )
    const result = await verifyAnthropic('sk-ant-xxx')
    expect(result.status).toBe('connected')
    expect(result.models).toEqual(['claude-sonnet-4.6', 'claude-haiku-4.5'])
  })

  it('returns invalid on 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))
    const result = await verifyAnthropic('sk-ant-bad')
    expect(result.status).toBe('invalid')
  })

  it('returns unverified on 500', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 500 }))
    const result = await verifyAnthropic('sk-ant-xxx')
    expect(result.status).toBe('unverified')
  })

  it('returns unverified on network error', async () => {
    fetchMock.mockRejectedValueOnce(new Error('econn reset'))
    const result = await verifyAnthropic('sk-ant-xxx')
    expect(result.status).toBe('unverified')
    expect(result.error).toBe('econn reset')
  })
})

describe('verifyOpenai', () => {
  it('returns connected + model list on 200', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'gpt-5.4' }, { id: 'gpt-4o' }] }))
    const result = await verifyOpenai('sk-openai-xxx')
    expect(result.status).toBe('connected')
    expect(result.models).toEqual(['gpt-5.4', 'gpt-4o'])
  })

  it('returns invalid on 403', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 403 }))
    const result = await verifyOpenai('sk-openai-bad')
    expect(result.status).toBe('invalid')
  })
})

describe('verifyGoogle', () => {
  it('strips "models/" prefix from names', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        models: [{ name: 'models/gemini-2.5-pro' }, { name: 'models/gemini-2.5-flash' }],
      }),
    )
    const result = await verifyGoogle('AIzaSy-xxx')
    expect(result.status).toBe('connected')
    expect(result.models).toEqual(['gemini-2.5-pro', 'gemini-2.5-flash'])
  })

  it('returns invalid on 400 (Google uses 400 for bad keys)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 400 }))
    const result = await verifyGoogle('bad')
    expect(result.status).toBe('invalid')
  })
})

describe('verifyOpenrouter', () => {
  it('returns connected when both /auth/key and /models succeed', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: { label: 'test', usage: 0 } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'anthropic/claude-sonnet-4.6' }] }))
    const result = await verifyOpenrouter('sk-or-xxx')
    expect(result.status).toBe('connected')
    expect(result.models).toEqual(['anthropic/claude-sonnet-4.6'])
  })

  it('returns invalid if /auth/key returns 401', async () => {
    fetchMock.mockResolvedValueOnce(new Response('', { status: 401 }))
    const result = await verifyOpenrouter('sk-or-bad')
    expect(result.status).toBe('invalid')
  })

  it('returns connected with empty list if auth OK but models list fails', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: {} }))
      .mockResolvedValueOnce(new Response('', { status: 500 }))
    const result = await verifyOpenrouter('sk-or-xxx')
    expect(result.status).toBe('connected')
    expect(result.models).toEqual([])
  })
})

describe('verifyOllama — SSRF guard', () => {
  it.each([
    'http://localhost:11434',
    'http://127.0.0.1:11434',
    'http://0.0.0.0:11434',
    'http://10.0.0.5:11434',
    'http://192.168.1.50:11434',
    'http://172.16.0.1:11434',
    'http://172.31.255.255:11434',
    'http://169.254.169.254:11434',     // AWS metadata
    'http://100.64.0.1:11434',           // Tailscale CGNAT
    'http://my-box.local:11434',         // mDNS
    'http://[::1]:11434',
    'http://[fe80::1]:11434',
    'http://[fc00::1]:11434',
    'http://host.docker.internal:11434',
  ])('refuses to probe %s', async (url) => {
    expect(isServerVerifiable(url)).toBe(false)
    const result = await verifyOllama(url)
    expect(result.status).toBe('unverified')
    expect(result.error).toBe('client_side_only')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('probes public hostnames', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ models: [{ name: 'llama3.2:3b' }, { name: 'gemma2:2b' }] }),
    )
    const result = await verifyOllama('https://ollama.example.com')
    expect(result.status).toBe('connected')
    expect(result.models).toEqual(['llama3.2:3b', 'gemma2:2b'])
  })

  it('passes bearer token when provided', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ models: [] }))
    await verifyOllama('https://ollama.example.com', 'secret-bearer')
    const call = fetchMock.mock.calls[0] as FetchArgs
    const init = call[1] as RequestInit
    expect(init.headers).toMatchObject({ Authorization: 'Bearer secret-bearer' })
  })

  it('rejects non-http(s) schemes', async () => {
    expect(isServerVerifiable('ftp://example.com')).toBe(false)
    expect(isServerVerifiable('file:///etc/passwd')).toBe(false)
  })

  it('rejects malformed URLs', async () => {
    expect(isServerVerifiable('not a url')).toBe(false)
  })
})
