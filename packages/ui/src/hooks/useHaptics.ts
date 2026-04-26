import { useMemo } from 'react'
import { useSettingsStore } from '../store/settings'

export interface Haptics {
  light:   () => void
  medium:  () => void
  success: () => void
  warning: () => void
}

const NOOP: Haptics = { light: () => {}, medium: () => {}, success: () => {}, warning: () => {} }

async function invokeHaptic(kind: 'light' | 'medium' | 'success' | 'warning'): Promise<void> {
  if (typeof window === 'undefined') return
  if (!(window as any).__TAURI_INTERNALS__) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('mobile_haptic', { kind }).catch(() => {})
}

export function useHaptics(): Haptics {
  const hapticsEnabled = useSettingsStore((s) => s.hapticsEnabled)
  const reduceMotion   = useSettingsStore((s) => s.reduceMotion)
  return useMemo<Haptics>(() => {
    if (!hapticsEnabled || reduceMotion) return NOOP
    return {
      light:   () => { void invokeHaptic('light') },
      medium:  () => { void invokeHaptic('medium') },
      success: () => { void invokeHaptic('success') },
      warning: () => { void invokeHaptic('warning') },
    }
  }, [hapticsEnabled, reduceMotion])
}
