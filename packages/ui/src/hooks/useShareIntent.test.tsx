import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

vi.mock('../lib/share-intent-link', () => ({
  getColdStartShareUrl: vi.fn(async () => null),
  listenForShareIntent: vi.fn(() => () => {}),
}))

import { useShareIntent } from './useShareIntent'

/**
 * WHATWG URL rejects schemes starting with a digit ('1scratch:').
 * The real isShareIntent() substitutes 'onescratch:' for parsing and overrides
 * toString() to return the original string. Mirror that here so parse() in the
 * hook receives the same shape of object it gets at runtime.
 */
function makeShareUrl(raw: string): URL {
  const u = new URL(raw.replace(/^1scratch:/, 'onescratch:'))
  Object.defineProperty(u, 'toString', { value: () => raw })
  return u
}

describe('useShareIntent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('starts with null pendingPayload', () => {
    const { result } = renderHook(() => useShareIntent())
    expect(result.current.pendingPayload).toBeNull()
  })

  it('parses 1scratch://capture as capture payload', async () => {
    const mod = await import('../lib/share-intent-link')
    ;(mod.getColdStartShareUrl as any).mockResolvedValueOnce(makeShareUrl('1scratch://capture'))
    const { result } = renderHook(() => useShareIntent())
    await waitFor(() => expect(result.current.pendingPayload).toEqual({ kind: 'capture' }))
  })

  it('parses 1scratch://share?text=hi as share payload with raw URL', async () => {
    const mod = await import('../lib/share-intent-link')
    ;(mod.getColdStartShareUrl as any).mockResolvedValueOnce(makeShareUrl('1scratch://share?text=hi'))
    const { result } = renderHook(() => useShareIntent())
    await waitFor(() => expect(result.current.pendingPayload).toEqual({
      kind: 'share',
      raw: '1scratch://share?text=hi',
    }))
  })

  it('consume clears pendingPayload', async () => {
    const mod = await import('../lib/share-intent-link')
    ;(mod.getColdStartShareUrl as any).mockResolvedValueOnce(makeShareUrl('1scratch://capture'))
    const { result } = renderHook(() => useShareIntent())
    await waitFor(() => expect(result.current.pendingPayload).not.toBeNull())
    act(() => result.current.consume())
    expect(result.current.pendingPayload).toBeNull()
  })
})
