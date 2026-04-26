import { describe, it, expect, beforeEach, vi } from 'vitest'

const mockGetCurrent = vi.fn<() => Promise<string[] | null>>()
const mockOnOpenUrl = vi.fn<(cb: (urls: string[]) => void) => Promise<() => void>>()

vi.mock('@tauri-apps/plugin-deep-link', () => ({
  getCurrent: () => mockGetCurrent(),
  onOpenUrl: (cb: (urls: string[]) => void) => mockOnOpenUrl(cb),
}))

import {
  getColdStartShareUrl,
  listenForShareIntent,
} from './share-intent-link'

describe('share-intent-link', () => {
  beforeEach(() => {
    mockGetCurrent.mockReset()
    mockOnOpenUrl.mockReset()
  })

  it('cold-start: returns capture URL when present', async () => {
    mockGetCurrent.mockResolvedValueOnce(['1scratch://capture'])
    const u = await getColdStartShareUrl()
    expect(u?.toString()).toBe('1scratch://capture')
  })

  it('cold-start: ignores auth URLs', async () => {
    mockGetCurrent.mockResolvedValueOnce(['1scratch://auth/done?code=abc'])
    const u = await getColdStartShareUrl()
    expect(u).toBeNull()
  })

  it('cold-start: empty when no URLs', async () => {
    mockGetCurrent.mockResolvedValueOnce(null)
    expect(await getColdStartShareUrl()).toBeNull()
  })

  it('runtime listener: forwards share intents only', async () => {
    let captured: ((urls: string[]) => void) | null = null
    mockOnOpenUrl.mockImplementationOnce(async (cb) => {
      captured = cb
      return () => {}
    })
    const handler = vi.fn()
    listenForShareIntent(handler)
    await Promise.resolve()
    captured!(['1scratch://auth/done', '1scratch://share?text=hi', '1scratch://capture'])
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler.mock.calls[0]![0].toString()).toBe('1scratch://share?text=hi')
    expect(handler.mock.calls[1]![0].toString()).toBe('1scratch://capture')
  })

  it('unsubscribe: cancels before listener resolves without leak', async () => {
    let resolveListen!: (fn: () => void) => void
    const stopFn = vi.fn()
    mockOnOpenUrl.mockImplementationOnce(
      () => new Promise<() => void>((res) => { resolveListen = res })
    )
    const off = listenForShareIntent(() => {})
    off()
    resolveListen(stopFn)
    await Promise.resolve()
    expect(stopFn).toHaveBeenCalledTimes(1)
  })
})
