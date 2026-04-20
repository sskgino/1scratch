import { describe, it, expect, vi, beforeEach } from 'vitest'

const secureGet = vi.fn()
const secureSet = vi.fn()
const secureDelete = vi.fn()
vi.mock('../secure-store', () => ({
  secureStore: {
    get: secureGet, set: secureSet, delete: secureDelete, has: vi.fn(),
  },
}))

const fetchSpy = vi.fn()
vi.stubGlobal('fetch', fetchSpy)

beforeEach(() => { secureGet.mockReset(); secureSet.mockReset(); secureDelete.mockReset(); fetchSpy.mockReset() })

describe('loadSession', () => {
  it('returns null when no refresh stored', async () => {
    secureGet.mockResolvedValue(null)
    const { loadSession } = await import('./session')
    expect(await loadSession({ apiBase: 'https://x' })).toBeNull()
  })

  it('refreshes and persists the new refresh token', async () => {
    secureGet.mockResolvedValue('old-refresh')
    fetchSpy.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ access_jwt: 'eyJ.a.b', refresh_token: 'new-refresh', user: { id: 'u' } }),
    })
    const { loadSession } = await import('./session')
    const sess = await loadSession({ apiBase: 'https://x' })
    expect(sess).toEqual({ access: 'eyJ.a.b', userId: 'u' })
    expect(secureSet).toHaveBeenCalledWith('refresh', 'new-refresh')
  })

  it('clears refresh on 401 and returns null', async () => {
    secureGet.mockResolvedValue('bad-refresh')
    fetchSpy.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) })
    const { loadSession } = await import('./session')
    expect(await loadSession({ apiBase: 'https://x' })).toBeNull()
    expect(secureDelete).toHaveBeenCalledWith('refresh')
  })
})
