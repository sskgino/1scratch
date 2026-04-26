import { useEffect, useState } from 'react'
import { Composer } from './Composer'
import { RecentStack } from './RecentStack'
import { ClipboardSuggestChip } from './ClipboardSuggestChip'
import { CameraSheet } from './CameraSheet'
import { useVoiceDictation } from './VoiceDictation'
import { useShareIntent } from '../../../hooks/useShareIntent'
import { useCardsStore } from '../../../store/cards'
import { useWorkspaceStore } from '../../../store/workspace'
import { evaluateClipboard, type SuggestionDescriptor } from '../../../lib/clipboard-suggest'

export function QuickCapture() {
  const [draft, setDraft] = useState('')
  const [cameraOpen, setCameraOpen] = useState(false)
  const [suggestion, setSuggestion] = useState<SuggestionDescriptor | null>(null)
  const addCard = useCardsStore((s) => s.addCard)
  const activeCanvasId = useWorkspaceStore((s) => {
    const sec = s.sections.find((x) => x.id === s.activeSectionId)
    return sec?.activeTabId ?? null
  })

  const { state: micState, countdown, toggle: toggleMic } = useVoiceDictation({
    onPartial: (t) => setDraft(t),
    onFinal: (t) => setDraft(t),
  })

  const { pendingPayload, consume } = useShareIntent()
  useEffect(() => {
    if (pendingPayload?.kind === 'capture') consume()
  }, [pendingPayload, consume])

  useEffect(() => {
    const refresh = () => { void evaluateClipboard().then(setSuggestion) }
    refresh()
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [])

  const send = () => {
    if (!draft.trim() || !activeCanvasId) return
    addCard({
      kind: 'prompt',
      type: 'card',
      canvasId: activeCanvasId,
      x: 100, y: 100, width: 280, height: 200,
      prompt: draft, modelSlot: 'default',
      status: 'idle', response: '', model: '',
    })
    setDraft('')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <RecentStack />
      </div>
      <ClipboardSuggestChip
        suggestion={suggestion}
        onAccept={(p) => { setDraft((d) => d ? `${d}\n${p}` : p); setSuggestion(null) }}
        onDismiss={() => setSuggestion(null)}
      />
      <Composer
        value={draft}
        onChange={setDraft}
        onSend={send}
        onMicTap={toggleMic}
        onCameraTap={() => setCameraOpen(true)}
        micState={micState}
        countdown={countdown}
      />
      <CameraSheet
        open={cameraOpen}
        onDismiss={() => setCameraOpen(false)}
        onSend={(img) => {
          if (!activeCanvasId) return
          addCard({
            kind: 'image',
            type: 'card',
            canvasId: activeCanvasId,
            x: 100, y: 100, width: 280, height: 200,
            fullPath: img.fullPath, thumbPath: img.thumbPath,
            capturedAt: Date.now(),
            originDeviceId: localStorage.getItem('1scratch:device_id') ?? 'unknown',
          })
          setCameraOpen(false)
        }}
      />
    </div>
  )
}
