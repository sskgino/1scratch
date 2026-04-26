import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { SafeArea } from '../shared/SafeArea'
import { useHaptics } from '../../../hooks/useHaptics'

export interface ComposerProps {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  onMicTap: () => void
  onCameraTap: () => void
  micState?: 'idle' | 'listening' | 'committing'
  countdown?: number | null
  disabled?: boolean
}

const LINE_HEIGHT = 22
const MIN_LINES = 1
const MAX_LINES = 6

export function Composer(p: ComposerProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null)
  const [translateY, setTranslateY] = useState(0)
  const haptics = useHaptics()
  const onSend = () => { haptics.success(); p.onSend() }

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => {
      const offset = window.innerHeight - vv.height - vv.offsetTop
      setTranslateY(Math.max(0, offset))
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    const lines = Math.min(MAX_LINES, Math.max(MIN_LINES, Math.ceil(el.scrollHeight / LINE_HEIGHT)))
    el.style.height = `${lines * LINE_HEIGHT + 16}px`
  }, [p.value])

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => p.onChange(e.target.value)
  const canSend = p.value.trim().length > 0 && !p.disabled

  return (
    <SafeArea
      edges={['bottom', 'left', 'right']}
      style={{
        position: 'sticky', bottom: 0,
        transform: `translateY(${-translateY}px)`,
        background: '#fff', borderTop: '1px solid #eee',
      }}
    >
      <div style={{ padding: 8 }}>
        <textarea
          ref={ref}
          value={p.value}
          onChange={onChange}
          placeholder="Type or speak…"
          rows={1}
          style={{
            width: '100%', padding: 12, fontSize: 16, borderRadius: 12,
            border: '1px solid #ddd', resize: 'none', lineHeight: `${LINE_HEIGHT}px`,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <button
            aria-label="Camera" onClick={p.onCameraTap}
            style={{ width: 44, height: 44, fontSize: 22, border: 0, background: 'transparent' }}
          >📷</button>
          <button
            aria-label="Mic" onClick={p.onMicTap}
            style={{
              width: 56, height: 56, fontSize: 24, border: 0,
              background: p.micState === 'listening' ? '#f44' : 'transparent',
              color: p.micState === 'listening' ? '#fff' : '#000',
              borderRadius: 28, position: 'relative',
            }}
          >
            🎙
            {p.countdown != null && (
              <span style={{
                position: 'absolute', top: -6, right: -6, fontSize: 11,
                background: '#000', color: '#fff', borderRadius: 8, padding: '2px 6px',
              }}>{p.countdown}s</span>
            )}
          </button>
          <div style={{ flex: 1 }} />
          <button
            aria-label="Send" disabled={!canSend} onClick={onSend}
            style={{
              width: 44, height: 44, fontSize: 20, border: 0,
              background: canSend ? '#222' : '#ccc', color: '#fff', borderRadius: 22,
            }}
          >→</button>
        </div>
      </div>
    </SafeArea>
  )
}
