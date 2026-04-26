import { useRef, useEffect, useCallback, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CardShell from './CardShell'
import CardControls from './CardControls'
import { useCardsStore } from '../../store/cards'
import { useSettingsStore } from '../../store/settings'
import { runPrompt, cancelPrompt } from '../../lib/runPrompt'
import type { PromptCard } from '../../store/cards'

const PAD = 5

interface Props {
  card: PromptCard
}

export default function NoteCard({ card }: Props) {
  const { updateCard } = useCardsStore()
  const fontCss = useSettingsStore((s) => s.getFontCss())
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [promptCollapsed, setPromptCollapsed] = useState(false)

  const hasResponse = !!card.response || card.status === 'streaming'
  const isStreaming = card.status === 'streaming'

  // Autofocus new empty cards. Wait one frame so layout settles inside Rnd
  // before focusing — avoids losing focus on quick successive clicks.
  useEffect(() => {
    if (!card.prompt) {
      const raf = requestAnimationFrame(() => {
        textareaRef.current?.focus({ preventScroll: true })
      })
      return () => cancelAnimationFrame(raf)
    }
  }, [])

  // Auto-grow card height to match textarea — only when no response yet
  const autoResize = useCallback(() => {
    if (hasResponse) return
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    const contentH = el.scrollHeight
    el.style.height = contentH + 'px'
    const newCardH = contentH + PAD * 2
    if (newCardH !== card.height) {
      updateCard(card.id, { height: newCardH })
    }
  }, [card.id, card.height, hasResponse, updateCard])

  useEffect(() => { autoResize() }, [card.prompt])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      runPrompt(card.id)
      return
    }
    if (e.key === 'Escape' && isStreaming) {
      cancelPrompt(card.id)
    }
  }

  const handleRetry = () => {
    updateCard(card.id, { response: '', status: 'idle' })
    runPrompt(card.id)
  }

  const handleClearResponse = () => {
    // Collapse back to prompt-only size
    const el = textareaRef.current
    const promptH = el ? el.scrollHeight + PAD * 2 : 42
    updateCard(card.id, {
      response: '',
      status: 'idle',
      model: '',
      inputTokens: undefined,
      outputTokens: undefined,
      errorMessage: undefined,
      height: promptH,
    })
    setPromptCollapsed(false)
  }

  return (
    <CardShell card={card}>
      <CardControls card={card} />

      <div style={{
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* ── Prompt section ── */}
        {!promptCollapsed && (
          <textarea
            ref={textareaRef}
            value={card.prompt}
            onChange={(e) => {
              updateCard(card.id, { prompt: e.target.value })
              autoResize()
            }}
            onKeyDown={handleKeyDown}
            placeholder="…"
            rows={1}
            style={{
              flexShrink: 0,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              overflow: 'hidden',
              fontFamily: fontCss,
              fontSize: 18,
              lineHeight: 1.5,
              color: card.status === 'error' && !hasResponse ? '#c53030' : '#1a1a1a',
              padding: `${PAD}px ${PAD + 26}px ${PAD}px ${PAD}px`,
              margin: 0,
              cursor: 'text',
              caretColor: '#555',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              width: '100%',
            }}
          />
        )}

        {/* ── Divider — only when response exists ── */}
        {hasResponse && (
          <div
            className="no-drag"
            style={{
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '0 4px',
              borderTop: promptCollapsed ? 'none' : '1px solid rgba(0,0,0,0.08)',
            }}
          >
            {/* Collapse / expand prompt toggle */}
            <button
              onClick={() => setPromptCollapsed((v) => !v)}
              title={promptCollapsed ? 'Show prompt' : 'Hide prompt'}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 9,
                color: '#bbb',
                padding: '1px 3px',
                lineHeight: 1,
                fontFamily: 'system-ui',
              }}
            >
              {promptCollapsed ? '▾ prompt' : '▴'}
            </button>

            <div style={{ flex: 1, height: 1, background: 'rgba(0,0,0,0.06)' }} />

            {/* Model label */}
            {card.model && (
              <span style={{ fontSize: 9, color: '#ccc', fontFamily: 'system-ui', whiteSpace: 'nowrap' }}>
                {card.model.replace('claude-', '').replace('-20251001', '')}
              </span>
            )}

            {/* Retry */}
            {!isStreaming && card.response && (
              <button
                onClick={handleRetry}
                title="Retry"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, color: '#bbb', padding: '1px 3px', lineHeight: 1,
                }}
              >
                ↺
              </button>
            )}

            {/* Clear */}
            {!isStreaming && (
              <button
                onClick={handleClearResponse}
                title="Clear response"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 11, color: '#bbb', padding: '1px 3px', lineHeight: 1,
                }}
              >
                ×
              </button>
            )}

            {/* Stop streaming */}
            {isStreaming && (
              <button
                onClick={() => cancelPrompt(card.id)}
                title="Stop"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 9, color: '#f59e0b', padding: '1px 4px', lineHeight: 1,
                  fontFamily: 'system-ui',
                }}
              >
                ■ stop
              </button>
            )}
          </div>
        )}

        {/* ── Response section ── */}
        {hasResponse && (
          <div
            className="no-drag"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              overflowX: 'hidden',
              padding: `6px ${PAD}px 20px ${PAD}px`,
              fontFamily: fontCss,
              fontSize: 17,
            }}
          >
            {card.response ? (
              <div className={`prose${isStreaming ? ' streaming-cursor' : ''}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {card.response}
                </ReactMarkdown>
              </div>
            ) : (
              <span style={{ color: '#bbb', fontFamily: 'system-ui', fontSize: 12 }}>
                <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
                {' '}generating…
              </span>
            )}
          </div>
        )}

        {/* ── Error (no response yet) ── */}
        {card.status === 'error' && !hasResponse && (
          <div style={{
            flexShrink: 0,
            fontSize: 10,
            color: '#c53030',
            padding: '2px 6px 4px',
            fontFamily: 'system-ui',
          }}>
            {card.errorMessage}
          </div>
        )}

        {/* ── Token count footer ── */}
        {card.inputTokens != null && (
          <div style={{
            position: 'absolute',
            bottom: 3,
            left: PAD,
            fontSize: 9,
            color: '#ccc',
            fontFamily: 'system-ui',
            pointerEvents: 'none',
          }}>
            {card.inputTokens} → {card.outputTokens} tokens
          </div>
        )}

      </div>
    </CardShell>
  )
}
