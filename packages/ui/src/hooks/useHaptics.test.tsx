import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useHaptics } from './useHaptics'
import { useSettingsStore } from '../store/settings'

describe('useHaptics', () => {
  it('no-ops when reduceMotion is true', () => {
    useSettingsStore.setState({ hapticsEnabled: true, reduceMotion: true })
    const invoke = vi.fn()
    vi.stubGlobal('__TAURI_INVOKE__', invoke)
    const { result } = renderHook(() => useHaptics())
    result.current.light()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('no-ops when hapticsEnabled is false', () => {
    useSettingsStore.setState({ hapticsEnabled: false, reduceMotion: false })
    const invoke = vi.fn()
    vi.stubGlobal('__TAURI_INVOKE__', invoke)
    const { result } = renderHook(() => useHaptics())
    result.current.medium()
    expect(invoke).not.toHaveBeenCalled()
  })
})
