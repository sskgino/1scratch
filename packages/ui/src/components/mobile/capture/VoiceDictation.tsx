import { useEffect, useRef, useState } from 'react'
import { startDictation, type VoiceHandle, type VoiceError } from '../../../lib/voice'
import { useSettingsStore } from '../../../store/settings'

export interface VoiceDictationProps {
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  onError?: (e: VoiceError) => void
  onStateChange?: (s: 'idle' | 'listening' | 'committing') => void
}

const COUNTDOWN_AT = 50
const MAX_S = 60

export function useVoiceDictation(props: VoiceDictationProps) {
  const reduceMotion = useSettingsStore((s) => s.reduceMotion)
  const handleRef = useRef<VoiceHandle | null>(null)
  const [state, setState] = useState<'idle' | 'listening' | 'committing'>('idle')
  const [countdown, setCountdown] = useState<number | null>(null)
  const elapsedRef = useRef(0)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => { props.onStateChange?.(state) }, [state, props])

  const stop = async () => {
    if (state !== 'listening') return
    setState('committing')
    setCountdown(null)
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    try {
      const r = await handleRef.current?.stop()
      if (r?.finalText) props.onFinal(r.finalText)
    } finally {
      setState('idle')
      handleRef.current = null
    }
  }

  const start = async () => {
    if (state !== 'idle') return
    setState('listening')
    elapsedRef.current = 0
    tickRef.current = setInterval(() => {
      elapsedRef.current += 1
      if (elapsedRef.current >= COUNTDOWN_AT) setCountdown(MAX_S - elapsedRef.current)
      if (elapsedRef.current >= MAX_S) { void stop() }
    }, 1000)
    handleRef.current = await startDictation({
      onPartial: props.onPartial,
      onFinal: props.onFinal,
      onError: (e) => {
        props.onError?.(e)
        setState('idle')
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
        setCountdown(null)
      },
    })
  }

  const toggle = () => { if (state === 'listening') void stop(); else void start() }

  return { state, countdown, toggle, reduceMotion }
}
