import { useState } from 'react'
import { useSettingsStore, FONTS, DEFAULT_MODEL_SLOTS } from '../../store/settings'
import { useWorkspaceStore } from '../../store/workspace'

interface Props {
  onClose: () => void
}

const KNOWN_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-6',
  'claude-haiku-4-5-20251001',
]

export default function SettingsPanel({ onClose }: Props) {
  const { apiKey, setApiKey, modelSlots, setModelSlot, fontFamily, setFontFamily } = useSettingsStore()
  const colorsEnabled = useWorkspaceStore((s) => s.colorsEnabled)
  const setColorsEnabled = useWorkspaceStore((s) => s.setColorsEnabled)
  const [draftKey, setDraftKey] = useState(apiKey)
  const [draftSlots, setDraftSlots] = useState<Record<string, string>>({ ...modelSlots })

  const save = () => {
    setApiKey(draftKey.trim())
    Object.entries(draftSlots).forEach(([slot, model]) => setModelSlot(slot, model.trim()))
    onClose()
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.25)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 9999,
        fontFamily: 'system-ui, sans-serif',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: '#fff',
        border: '1px solid rgba(0,0,0,0.1)',
        borderRadius: 12,
        padding: 24,
        width: 460,
        maxHeight: '80vh',
        overflowY: 'auto',
        boxShadow: '0 8px 40px rgba(0,0,0,0.12)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Settings</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#999' }}>×</button>
        </div>

        {/* API Key */}
        <Section label="Anthropic API Key">
          <input
            type="password"
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') save() }}
            placeholder="sk-ant-…"
            style={inputStyle}
          />
          <p style={hintStyle}>Stored locally. Used only to call Anthropic's API directly from this app.</p>
        </Section>

        {/* Tab colors */}
        <Section label="Tab Colors">
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, color: '#333' }}>
            <span
              role="switch"
              aria-checked={colorsEnabled}
              onClick={() => setColorsEnabled(!colorsEnabled)}
              style={{
                width: 34,
                height: 20,
                borderRadius: 999,
                background: colorsEnabled ? '#1a1a1a' : 'rgba(0,0,0,0.18)',
                position: 'relative',
                transition: 'background 0.2s ease',
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: colorsEnabled ? 16 : 2,
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: '#fff',
                  transition: 'left 0.2s cubic-bezier(0.32, 0.72, 0, 1)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            </span>
            <span onClick={() => setColorsEnabled(!colorsEnabled)}>
              Color sidebar sections & tabs with a soft palette
            </span>
          </label>
          <p style={hintStyle}>
            Right-click any section or tab to pick its color. New tabs cycle through the palette automatically.
          </p>
        </Section>

        {/* Font */}
        <Section label="Handwriting Font">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {FONTS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFontFamily(f.id)}
                style={{
                  background: fontFamily === f.id ? '#1a1a1a' : 'rgba(0,0,0,0.05)',
                  border: '1px solid rgba(0,0,0,0.1)',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: 15,
                  cursor: 'pointer',
                  color: fontFamily === f.id ? '#fff' : '#333',
                  fontFamily: f.css,
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </Section>

        {/* Model Slots */}
        <Section label="Model Slots (0–9)">
          <p style={hintStyle}>Assign any model ID to each number. Use the number badge on a prompt card to switch slots.</p>
          {['0','1','2','3','4','5','6','7','8','9'].map((slot) => (
            <div key={slot} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, width: 14, color: '#333' }}>{slot}</span>
              <input
                value={draftSlots[slot] ?? ''}
                onChange={(e) => setDraftSlots((s) => ({ ...s, [slot]: e.target.value }))}
                placeholder="model-id or leave blank"
                list="known-models"
                style={{ ...inputStyle, flex: 1, fontSize: 12, padding: '5px 8px' }}
              />
            </div>
          ))}
          <datalist id="known-models">
            {KNOWN_MODELS.map((m) => <option key={m} value={m} />)}
          </datalist>
          <button
            onClick={() => setDraftSlots({ ...DEFAULT_MODEL_SLOTS })}
            style={{ fontSize: 11, color: '#999', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginTop: 4 }}
          >
            Reset to defaults
          </button>
        </Section>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
          <button onClick={onClose} style={{ ...btnStyle, background: 'rgba(0,0,0,0.05)', color: '#333' }}>Cancel</button>
          <button onClick={save} style={{ ...btnStyle, background: '#1a1a1a', color: '#fff' }}>Save</button>
        </div>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: '#f7f7f7',
  border: '1px solid rgba(0,0,0,0.1)',
  borderRadius: 6,
  color: '#1a1a1a',
  fontSize: 13,
  padding: '7px 10px',
  outline: 'none',
}

const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#aaa',
  margin: '4px 0 0',
}

const btnStyle: React.CSSProperties = {
  border: 'none',
  borderRadius: 6,
  fontSize: 13,
  fontWeight: 500,
  padding: '7px 18px',
  cursor: 'pointer',
}
