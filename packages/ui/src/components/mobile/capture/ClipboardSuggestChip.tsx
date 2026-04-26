import type { SuggestionDescriptor } from '../../../lib/clipboard-suggest'
import { markSuggestionSeen } from '../../../lib/clipboard-suggest'

export interface ClipboardSuggestChipProps {
  suggestion: SuggestionDescriptor | null
  onAccept: (preview: string) => void
  onDismiss: () => void
}

export function ClipboardSuggestChip({ suggestion, onAccept, onDismiss }: ClipboardSuggestChipProps) {
  if (!suggestion) return null
  const accept = () => { markSuggestionSeen(suggestion.hash); onAccept(suggestion.preview) }
  const dismiss = () => { markSuggestionSeen(suggestion.hash); onDismiss() }
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px', background: '#f3f6fa', borderTop: '1px solid #e0e6ee',
    }}>
      <span style={{ fontSize: 16 }}>{suggestion.kind === 'url' ? '🔗' : '✎'}</span>
      <button
        onClick={accept}
        style={{
          flex: 1, textAlign: 'left', background: 'transparent', border: 0,
          fontSize: 14, color: '#246', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}
      >
        {suggestion.preview}
      </button>
      <button
        aria-label="Dismiss" onClick={dismiss}
        style={{ width: 24, height: 24, border: 0, background: 'transparent', fontSize: 16, color: '#888' }}
      >×</button>
    </div>
  )
}
