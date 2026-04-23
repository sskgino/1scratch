import { describe, it, expect, vi, beforeEach } from 'vitest'

const onOpenUrl = vi.fn()
const getCurrent = vi.fn()
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl, getCurrent }))

beforeEach(() => { onOpenUrl.mockReset(); getCurrent.mockReset() })

describe('deep-link', () => {
  it('getColdStartUrl returns a matching desktop-scheme URL', async () => {
    getCurrent.mockResolvedValue(['https://example.com/x', '1scratch://auth/done?refresh=abc'])
    const { getColdStartUrl } = await import('./deep-link')
    const url = await getColdStartUrl()
    expect(url?.toString()).toBe('1scratch://auth/done?refresh=abc')
  })

  it('getColdStartUrl returns a matching mobile App Link URL', async () => {
    getCurrent.mockResolvedValue(['https://app.1scratch.ai/m/auth/done?refresh=xyz'])
    const { getColdStartUrl } = await import('./deep-link')
    const url = await getColdStartUrl()
    expect(url?.toString()).toBe('https://app.1scratch.ai/m/auth/done?refresh=xyz')
  })

  it('getColdStartUrl returns null when no match', async () => {
    getCurrent.mockResolvedValue([])
    const { getColdStartUrl } = await import('./deep-link')
    expect(await getColdStartUrl()).toBeNull()
  })

  it('listenForAuthCallback fires for both matching patterns, ignores others', async () => {
    let cb: (urls: string[]) => void = () => {}
    onOpenUrl.mockImplementation((c: typeof cb) => { cb = c; return () => {} })
    const { listenForAuthCallback } = await import('./deep-link')
    const seen: URL[] = []
    listenForAuthCallback((u) => seen.push(u))
    cb([
      'https://nope.com',
      '1scratch://auth/done?x=1',
      '1scratch://other/path',
      'https://app.1scratch.ai/m/auth/done?y=2',
      'https://app.1scratch.ai/m/other',
    ])
    expect(seen.length).toBe(2)
    expect(seen[0]!.toString()).toBe('1scratch://auth/done?x=1')
    expect(seen[1]!.toString()).toBe('https://app.1scratch.ai/m/auth/done?y=2')
  })
})
