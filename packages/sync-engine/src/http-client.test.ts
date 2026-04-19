import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { HttpClient } from './http-client'

describe('HttpClient', () => {
  const fakeFetch = vi.fn()
  beforeEach(() => { vi.stubGlobal('fetch', fakeFetch); fakeFetch.mockReset() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('POSTs push with bearer token and body', async () => {
    fakeFetch.mockResolvedValue(new Response(JSON.stringify({
      accepted: ['a'], rejected: [], serverVersion: '1', additional: [],
    }), { status: 200 }))
    const c = new HttpClient({
      baseUrl: 'https://api.example.com',
      getAuthToken: async () => 'tok123',
    })
    const res = await c.push({ deviceId: 'd', baseVersion: '0', mutations: [] })
    expect(fakeFetch).toHaveBeenCalledOnce()
    const [url, init] = fakeFetch.mock.calls[0]!
    expect(url).toBe('https://api.example.com/api/sync/push')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok123')
    expect(res.accepted).toEqual(['a'])
  })

  it('throws typed error on 401', async () => {
    fakeFetch.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const c = new HttpClient({ baseUrl: 'https://x', getAuthToken: async () => 't' })
    await expect(c.push({ deviceId: 'd', baseVersion: '0', mutations: [] })).rejects.toMatchObject({
      kind: 'unauthorized',
    })
  })

  it('throws typed error on network failure', async () => {
    fakeFetch.mockRejectedValue(new TypeError('network'))
    const c = new HttpClient({ baseUrl: 'https://x', getAuthToken: async () => 't' })
    await expect(c.pull('0', 500)).rejects.toMatchObject({ kind: 'network' })
  })
})
