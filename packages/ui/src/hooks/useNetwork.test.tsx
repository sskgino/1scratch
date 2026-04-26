import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useNetwork } from './useNetwork'

describe('useNetwork', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  })

  it('reports online from navigator.onLine when no Tauri runtime', () => {
    const { result } = renderHook(() => useNetwork())
    expect(result.current.online).toBe(true)
  })

  it('flips on offline event', () => {
    const { result } = renderHook(() => useNetwork())
    act(() => {
      Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current.online).toBe(false)
    expect(result.current.type).toBe('offline')
  })
})
