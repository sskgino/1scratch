import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { BottomSheet } from '../shared/BottomSheet'
import { processCapturedImage, type ProcessedImage } from '../../../lib/image-pipeline'

export interface CameraSheetProps {
  open: boolean
  onDismiss: () => void
  onSend: (img: ProcessedImage) => void
}

type State =
  | { kind: 'idle' }
  | { kind: 'capturing' }
  | { kind: 'processing'; rawPath: string }
  | { kind: 'ready'; img: ProcessedImage }
  | { kind: 'error'; message: string }

export function CameraSheet({ open, onDismiss, onSend }: CameraSheetProps) {
  const [state, setState] = useState<State>({ kind: 'idle' })

  useEffect(() => {
    if (!open) { setState({ kind: 'idle' }); return }
    setState({ kind: 'capturing' })
    invoke<string>('mobile_camera').then(async (rawPath) => {
      setState({ kind: 'processing', rawPath })
      try {
        const cardId = crypto.randomUUID()
        const img = await processCapturedImage(rawPath, cardId)
        setState({ kind: 'ready', img })
      } catch (e) {
        setState({ kind: 'error', message: String(e) })
      }
    }).catch((e) => setState({ kind: 'error', message: String(e) }))
  }, [open])

  return (
    <BottomSheet open={open} onDismiss={onDismiss}>
      <div style={{ padding: 16 }}>
        {state.kind === 'capturing' && <p>Opening camera…</p>}
        {state.kind === 'processing' && <p>Processing image…</p>}
        {state.kind === 'error' && <p style={{ color: '#a33' }}>{state.message}</p>}
        {state.kind === 'ready' && (
          <>
            <img
              src={`asset://localhost/${state.img.thumbPath}`}
              alt="captured"
              style={{ width: '100%', borderRadius: 8 }}
            />
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                onClick={onDismiss}
                style={{ flex: 1, padding: 12, borderRadius: 8 }}
              >Cancel</button>
              <button
                onClick={() => onSend(state.img)}
                style={{ flex: 1, padding: 12, borderRadius: 8, background: '#222', color: '#fff' }}
              >Send</button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  )
}
