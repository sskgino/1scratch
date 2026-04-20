import { describe, it, expect, vi, beforeEach } from 'vitest'

const onOpenUrl = vi.fn()
const getCurrent = vi.fn()
vi.mock('@tauri-apps/plugin-deep-link', () => ({ onOpenUrl, getCurrent }))

beforeEach(() => { onOpenUrl.mockReset(); getCurrent.mockReset() })

describe('deep-link', () => {
  it('getColdStartUrl returns the matching URL when present', async () => {
    getCurrent.mockResolvedValue(['https://example.com/x', '1scratch://auth/done?refresh=abc'])
    const { getColdStartUrl } = await import('./deep-link')
    const url = await getColdStartUrl()
    expect(url?.toString()).toBe('1scratch://auth/done?refresh=abc')
  })

  it('getColdStartUrl returns null when no match', async () => {
    getCurrent.mockResolvedValue([])
    const { getColdStartUrl } = await import('./deep-link')
    expect(await getColdStartUrl()).toBeNull()
  })

  it('listenForAuthCallback only fires for matching scheme/path', async () => {
    let cb: (urls: string[]) => void = () => {}
    onOpenUrl.mockImplementation((c: typeof cb) => { cb = c; return () => {} })
    const { listenForAuthCallback } = await import('./deep-link')
    const seen: URL[] = []
    listenForAuthCallback((u) => seen.push(u))
    cb(['https://nope.com', '1scratch://auth/done?x=1', '1scratch://other/path'])
    expect(seen.length).toBe(1)
    expect(seen[0]!.toString()).toBe('1scratch://auth/done?x=1')
  })
})
