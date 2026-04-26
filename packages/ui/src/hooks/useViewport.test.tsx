import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useViewport } from './useViewport'

describe('useViewport', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth',  { configurable: true, value: 800 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 })
  })

  it('returns initial dimensions and isMobile flag', () => {
    const { result } = renderHook(() => useViewport())
    expect(result.current.width).toBe(800)
    expect(result.current.height).toBe(600)
    expect(result.current.isMobile).toBe(false)
  })

  it('flips isMobile when width drops below 600', async () => {
    const { result } = renderHook(() => useViewport())
    act(() => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 })
      window.dispatchEvent(new Event('resize'))
    })
    await waitFor(() => {
      expect(result.current.isMobile).toBe(true)
      expect(result.current.width).toBe(375)
    })
  })

  it('parses safe-area insets from a probe', () => {
    const { result } = renderHook(() => useViewport())
    expect(result.current.safeAreaTop).toBeGreaterThanOrEqual(0)
    expect(result.current.safeAreaBottom).toBeGreaterThanOrEqual(0)
  })
})
