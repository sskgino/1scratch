'use client'

// Models page §7 — ten slot pills, connected providers list, and the two
// modals (slot editor + connect provider). Aesthetic matches the Workbench
// drafting-vellum sheet.

import { useMemo, useState, useTransition } from 'react'
import type { ModelSlot, ProviderConnectionPublic, ProviderId, ProviderStatus } from '@1scratch/types'

// ─── Types ──────────────────────────────────────────────────────────────────

interface RegistryEntry {
  id: string
  provider: ProviderId
  displayName: string
  displayAbbr: string
}

interface Connection extends ProviderConnectionPublic {}

type SlotEditorState =
  | { open: false }
  | { open: true; slot: number }

type ConnectModalState =
  | { open: false }
  | { open: true }

// Small palette — each provider gets a distinct tint for pill identity.
const PROVIDER_COLOR: Record<string, string> = {
  anthropic: '#c2410c',
  openai: '#0f766e',
  google: '#1d4ed8',
  openrouter: '#7c3aed',
  ollama: '#4b5563',
  mistral: '#ea580c',
  cohere: '#0e7490',
  groq: '#b45309',
  xai: '#374151',
}

const STATUS_COLOR: Record<ProviderStatus, string> = {
  connected: '#166534',
  unverified: '#a16207',
  invalid: '#b91c1c',
  revoked: '#4b5563',
}

// ─── Component ──────────────────────────────────────────────────────────────

export function ModelsPage({
  initialConnections,
  initialSlots,
  registry,
}: {
  initialConnections: Connection[]
  initialSlots: ModelSlot[]
  registry: RegistryEntry[]
}) {
  const [connections, setConnections] = useState<Connection[]>(initialConnections)
  const [slots, setSlots] = useState<ModelSlot[]>(initialSlots)
  const [slotEditor, setSlotEditor] = useState<SlotEditorState>({ open: false })
  const [connectModal, setConnectModal] = useState<ConnectModalState>({ open: false })

  const registryById = useMemo(() => new Map(registry.map((m) => [m.id, m])), [registry])
  const connById = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections])

  function refreshSlot(next: ModelSlot) {
    setSlots((cur) => cur.map((s) => (s.slot === next.slot ? next : s)))
  }
  function refreshCleared(slot: number) {
    setSlots((cur) =>
      cur.map((s) =>
        s.slot === slot
          ? { slot, providerConnectionId: null, modelId: null, displayLabel: null }
          : s,
      ),
    )
  }

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="lift-in mb-10" style={{ animationDelay: '120ms' }}>
        <div className="marginalia mb-3">§ settings ── models</div>
        <h1
          className="leading-[0.95] tracking-[-0.02em] text-[clamp(2rem,5vw,3.75rem)]"
          style={{
            fontFamily: 'var(--font-fraunces)',
            fontWeight: 380,
            fontVariationSettings: '"opsz" 144, "SOFT" 50',
          }}
        >
          Ten&nbsp;
          <em
            style={{
              fontStyle: 'italic',
              fontVariationSettings: '"opsz" 144, "SOFT" 100',
              color: 'var(--accent)',
            }}
          >
            slots
          </em>
          .
        </h1>
      </div>

      {/* Slot grid */}
      <section className="lift-in mb-14" style={{ animationDelay: '220ms' }}>
        <div className="flex items-baseline justify-between border-b pb-1.5 mb-5" style={{ borderColor: 'var(--rule)' }}>
          <span className="marginalia">§01 ── slots 0 – 9</span>
          <span className="marginalia" style={{ color: 'var(--ink-soft)' }}>
            click a slot to assign a model
          </span>
        </div>
        <div className="grid grid-cols-5 gap-3 md:gap-4">
          {slots.map((s) => (
            <SlotPill
              key={s.slot}
              slot={s}
              model={s.modelId ? registryById.get(s.modelId) ?? null : null}
              connection={s.providerConnectionId ? connById.get(s.providerConnectionId) ?? null : null}
              onClick={() => setSlotEditor({ open: true, slot: s.slot })}
            />
          ))}
        </div>
      </section>

      {/* Connected providers */}
      <section className="lift-in mb-10" style={{ animationDelay: '360ms' }}>
        <div className="flex items-baseline justify-between border-b pb-1.5 mb-5" style={{ borderColor: 'var(--rule)' }}>
          <span className="marginalia">§02 ── connected providers</span>
          <button
            type="button"
            onClick={() => setConnectModal({ open: true })}
            className="text-xs underline underline-offset-4 decoration-1"
            style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--accent)' }}
          >
            + connect a provider
          </button>
        </div>

        {connections.length === 0 ? (
          <p className="marginalia" style={{ color: 'var(--ink-soft)' }}>
            ── no providers connected. add one to unlock the slots above.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {connections.map((c) => (
              <ProviderRow
                key={c.id}
                conn={c}
                onVerified={(next) =>
                  setConnections((cur) => cur.map((x) => (x.id === c.id ? { ...x, ...next } : x)))
                }
                onRemoved={() => {
                  setConnections((cur) => cur.filter((x) => x.id !== c.id))
                  // Any slots pointing at this connection are now orphaned on server (SET NULL).
                  setSlots((cur) =>
                    cur.map((s) =>
                      s.providerConnectionId === c.id
                        ? { slot: s.slot, providerConnectionId: null, modelId: null, displayLabel: null }
                        : s,
                    ),
                  )
                }}
              />
            ))}
          </ul>
        )}
      </section>

      {slotEditor.open && (
        <SlotEditor
          slot={slotEditor.slot}
          current={slots.find((s) => s.slot === slotEditor.slot)!}
          connections={connections}
          registry={registry}
          onClose={() => setSlotEditor({ open: false })}
          onSaved={(next) => {
            refreshSlot(next)
            setSlotEditor({ open: false })
          }}
          onCleared={() => {
            refreshCleared(slotEditor.slot)
            setSlotEditor({ open: false })
          }}
        />
      )}

      {connectModal.open && (
        <ConnectModal
          onClose={() => setConnectModal({ open: false })}
          onConnected={(conn) => {
            setConnections((cur) => [conn, ...cur])
            setConnectModal({ open: false })
          }}
        />
      )}
    </div>
  )
}

// ─── Slot pill ──────────────────────────────────────────────────────────────

function SlotPill({
  slot,
  model,
  connection,
  onClick,
}: {
  slot: ModelSlot
  model: RegistryEntry | null
  connection: Connection | null
  onClick: () => void
}) {
  const empty = !slot.modelId || !slot.providerConnectionId
  const providerColor = model ? PROVIDER_COLOR[model.provider] ?? 'var(--ink)' : 'var(--ink-soft)'
  const statusColor = connection ? STATUS_COLOR[connection.status] : 'transparent'
  const label = slot.displayLabel ?? model?.displayAbbr ?? '+'

  return (
    <button
      type="button"
      onClick={onClick}
      className="relative flex flex-col items-center justify-center h-[88px] px-3 text-center transition-all"
      style={{
        background: empty ? 'transparent' : '#fbf8f0',
        border: empty ? '1px dashed var(--rule)' : '1px solid var(--rule)',
        boxShadow: empty ? 'none' : '0 1px 0 rgba(45,42,35,0.06), 0 10px 20px -14px rgba(45,42,35,0.2)',
      }}
    >
      <span
        className="absolute top-1.5 left-2 text-[9px] tracking-[0.18em] uppercase"
        style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
      >
        {slot.slot}
      </span>
      {connection && (
        <span
          className="absolute top-1.5 right-2 inline-block h-1.5 w-1.5 rounded-full"
          style={{ background: statusColor }}
          title={connection.status}
        />
      )}
      <span
        className="text-lg"
        style={{
          fontFamily: 'var(--font-fraunces)',
          fontWeight: 400,
          color: empty ? 'var(--ink-soft)' : 'var(--ink)',
        }}
      >
        {label}
      </span>
      {model && (
        <span
          className="inline-block mt-0.5 h-1 w-6 rounded-full"
          style={{ background: providerColor }}
        />
      )}
    </button>
  )
}

// ─── Provider row ───────────────────────────────────────────────────────────

function ProviderRow({
  conn,
  onVerified,
  onRemoved,
}: {
  conn: Connection
  onVerified: (next: Partial<Connection>) => void
  onRemoved: () => void
}) {
  const [testing, startTest] = useTransition()
  const [removing, startRemove] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function test() {
    setError(null)
    startTest(async () => {
      const res = await fetch(`/api/providers/${conn.id}/verify`, { method: 'POST' })
      if (!res.ok) {
        setError('verify_failed')
        return
      }
      const j = (await res.json()) as { status: ProviderStatus; error?: string | null }
      onVerified({ status: j.status, lastVerifiedAt: new Date().toISOString() })
      if (j.error) setError(j.error)
    })
  }
  function remove() {
    if (!confirm(`remove ${conn.provider}${conn.label ? ` (${conn.label})` : ''}?`)) return
    startRemove(async () => {
      const res = await fetch(`/api/providers/${conn.id}`, { method: 'DELETE' })
      if (res.ok) onRemoved()
      else setError('delete_failed')
    })
  }

  const verifiedAt = conn.lastVerifiedAt ? new Date(conn.lastVerifiedAt) : null
  const verifiedLabel = verifiedAt ? humanAgo(verifiedAt) : 'never'

  return (
    <li
      className="flex items-center justify-between gap-4 py-3 px-4"
      style={{ background: '#fbf8f0', border: '1px solid var(--rule)' }}
    >
      <div className="flex items-center gap-3 min-w-0">
        <span
          className="inline-block h-2 w-2 rounded-full flex-none"
          style={{ background: STATUS_COLOR[conn.status] }}
          title={conn.status}
        />
        <div className="min-w-0">
          <div
            style={{
              fontFamily: 'var(--font-jetbrains)',
              fontSize: '11px',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--ink-soft)',
            }}
          >
            {conn.provider}{conn.kind === 'oauth' ? ' (oauth)' : ''}
          </div>
          <div
            className="truncate"
            style={{ fontFamily: 'var(--font-fraunces)', fontSize: '14px', color: 'var(--ink)' }}
          >
            {conn.label ?? '—'} · verified {verifiedLabel}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {error && (
          <span className="marginalia" style={{ color: 'var(--accent)' }}>
            ── {error}
          </span>
        )}
        <button
          type="button"
          onClick={test}
          disabled={testing}
          className="text-xs underline underline-offset-4 decoration-1 disabled:opacity-40"
          style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
        >
          {testing ? 'testing…' : 'test'}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={removing}
          className="text-xs underline underline-offset-4 decoration-1 disabled:opacity-40"
          style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--accent)' }}
        >
          {removing ? 'removing…' : 'remove'}
        </button>
      </div>
    </li>
  )
}

// ─── Slot editor modal ──────────────────────────────────────────────────────

function SlotEditor({
  slot,
  current,
  connections,
  registry,
  onClose,
  onSaved,
  onCleared,
}: {
  slot: number
  current: ModelSlot
  connections: Connection[]
  registry: RegistryEntry[]
  onClose: () => void
  onSaved: (next: ModelSlot) => void
  onCleared: () => void
}) {
  const [connectionId, setConnectionId] = useState<string>(current.providerConnectionId ?? connections[0]?.id ?? '')
  const selectedConn = connections.find((c) => c.id === connectionId) ?? null
  const availableModels = registry.filter((m) => m.provider === selectedConn?.provider)
  const [modelId, setModelId] = useState<string>(
    current.modelId && availableModels.some((m) => m.id === current.modelId)
      ? current.modelId
      : availableModels[0]?.id ?? '',
  )
  const [label, setLabel] = useState<string>(current.displayLabel ?? '')
  const [saving, startSave] = useTransition()
  const [clearing, startClear] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startSave(async () => {
      const res = await fetch('/api/model-slots', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slot,
          providerConnectionId: connectionId,
          modelId,
          displayLabel: label.trim() || null,
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? 'save_failed')
        return
      }
      const j = (await res.json()) as { slot: ModelSlot }
      onSaved(j.slot)
    })
  }
  function clear() {
    if (!current.modelId) {
      onClose()
      return
    }
    startClear(async () => {
      const res = await fetch(`/api/model-slots/${slot}`, { method: 'DELETE' })
      if (res.ok) onCleared()
      else setError('clear_failed')
    })
  }

  return (
    <Modal onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-5">
        <div>
          <div className="marginalia mb-1">§ slot {slot}</div>
          <h2
            style={{
              fontFamily: 'var(--font-fraunces)',
              fontWeight: 400,
              fontSize: '28px',
            }}
          >
            Assign a <em style={{ color: 'var(--accent)' }}>model</em>.
          </h2>
        </div>

        {connections.length === 0 ? (
          <p className="marginalia" style={{ color: 'var(--ink-soft)' }}>
            ── no providers connected. close this and add one first.
          </p>
        ) : (
          <>
            <Field label="provider">
              <select
                value={connectionId}
                onChange={(e) => {
                  setConnectionId(e.target.value)
                  const conn = connections.find((c) => c.id === e.target.value)
                  const next = registry.find((m) => m.provider === conn?.provider)
                  setModelId(next?.id ?? '')
                }}
                className="w-full bg-transparent px-3 py-2"
                style={{ border: '1px solid var(--rule)', fontFamily: 'var(--font-jetbrains)', fontSize: '13px' }}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.provider}{c.label ? ` · ${c.label}` : ''}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="model">
              <select
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
                disabled={availableModels.length === 0}
                className="w-full bg-transparent px-3 py-2 disabled:opacity-40"
                style={{ border: '1px solid var(--rule)', fontFamily: 'var(--font-jetbrains)', fontSize: '13px' }}
              >
                {availableModels.length === 0 ? (
                  <option value="">— no registry models for this provider —</option>
                ) : (
                  availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))
                )}
              </select>
            </Field>

            <Field label="label (optional)">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                placeholder={availableModels.find((m) => m.id === modelId)?.displayAbbr ?? ''}
                className="w-full bg-transparent px-3 py-2"
                style={{ border: '1px solid var(--rule)', fontFamily: 'var(--font-jetbrains)', fontSize: '13px' }}
              />
            </Field>
          </>
        )}

        {error && (
          <span className="marginalia" style={{ color: 'var(--accent)' }}>
            ── {error}
          </span>
        )}

        <div className="flex items-center justify-between gap-4 pt-2">
          <button
            type="button"
            onClick={clear}
            disabled={clearing || saving}
            className="text-xs underline underline-offset-4 decoration-1 disabled:opacity-40"
            style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
          >
            {clearing ? 'clearing…' : current.modelId ? 'clear slot' : 'cancel'}
          </button>
          <button
            type="submit"
            disabled={saving || !modelId || !connectionId}
            className="px-5 py-2 text-xs disabled:opacity-40"
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              fontFamily: 'var(--font-jetbrains)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            {saving ? 'saving…' : 'save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ─── Connect modal ──────────────────────────────────────────────────────────

type ConnectableProvider = ProviderId & ('anthropic' | 'openai' | 'google' | 'openrouter' | 'ollama')

const PROVIDER_OPTIONS: Array<{
  id: ConnectableProvider
  label: string
  hint: string
  supportsOAuth: boolean
}> = [
  { id: 'anthropic', label: 'Anthropic', hint: 'sk-ant-api03-…', supportsOAuth: false },
  { id: 'openai', label: 'OpenAI', hint: 'sk-…', supportsOAuth: false },
  { id: 'google', label: 'Google AI Studio', hint: 'AIza…', supportsOAuth: false },
  { id: 'openrouter', label: 'OpenRouter', hint: 'sk-or-…', supportsOAuth: true },
  { id: 'ollama', label: 'Ollama (local)', hint: 'http://localhost:11434', supportsOAuth: false },
]

function ConnectModal({
  onClose,
  onConnected,
}: {
  onClose: () => void
  onConnected: (conn: Connection) => void
}) {
  const [picked, setPicked] = useState<ConnectableProvider | null>(null)
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [endpointUrl, setEndpointUrl] = useState('')
  const [saving, startSave] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const opt = picked ? PROVIDER_OPTIONS.find((p) => p.id === picked)! : null

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!picked) return
    setError(null)
    const body: Record<string, unknown> = {
      provider: picked,
      label: label.trim() || null,
    }
    if (picked === 'ollama') body.endpointUrl = endpointUrl.trim()
    else body.apiKey = apiKey.trim()

    startSave(async () => {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? 'save_failed')
        return
      }
      const j = (await res.json()) as { connection: Connection }
      onConnected(j.connection)
    })
  }

  function connectOauth() {
    if (!picked) return
    // Persist optional label in query so the callback can apply it.
    const u = new URL(`/oauth/start/${picked}`, window.location.origin)
    if (label.trim()) u.searchParams.set('label', label.trim())
    window.location.href = u.toString()
  }

  return (
    <Modal onClose={onClose}>
      <div className="flex flex-col gap-5">
        <div>
          <div className="marginalia mb-1">§ connect</div>
          <h2
            style={{ fontFamily: 'var(--font-fraunces)', fontWeight: 400, fontSize: '28px' }}
          >
            Add a <em style={{ color: 'var(--accent)' }}>provider</em>.
          </h2>
        </div>

        {!picked ? (
          <ul className="flex flex-col gap-2">
            {PROVIDER_OPTIONS.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(p.id)
                    setError(null)
                  }}
                  className="w-full flex items-center justify-between py-3 px-4 text-left transition-colors"
                  style={{ background: '#fbf8f0', border: '1px solid var(--rule)' }}
                >
                  <span
                    style={{ fontFamily: 'var(--font-fraunces)', fontSize: '16px', color: 'var(--ink)' }}
                  >
                    {p.label}
                  </span>
                  <span
                    className="text-[10px] tracking-[0.15em] uppercase"
                    style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
                  >
                    {p.supportsOAuth ? 'byok / oauth' : 'byok'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <form onSubmit={save} className="flex flex-col gap-4">
            <Field label="label (optional)">
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={60}
                placeholder="Personal key"
                className="w-full bg-transparent px-3 py-2"
                style={{ border: '1px solid var(--rule)', fontFamily: 'var(--font-jetbrains)', fontSize: '13px' }}
              />
            </Field>

            {picked === 'ollama' ? (
              <Field label="endpoint url">
                <input
                  value={endpointUrl}
                  onChange={(e) => setEndpointUrl(e.target.value)}
                  placeholder={opt!.hint}
                  required
                  className="w-full bg-transparent px-3 py-2"
                  style={{ border: '1px solid var(--rule)', fontFamily: 'var(--font-jetbrains)', fontSize: '13px' }}
                />
              </Field>
            ) : (
              <Field label="api key">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={opt!.hint}
                  required
                  minLength={10}
                  className="w-full bg-transparent px-3 py-2"
                  style={{ border: '1px solid var(--rule)', fontFamily: 'var(--font-jetbrains)', fontSize: '13px' }}
                />
              </Field>
            )}

            {error && (
              <span className="marginalia" style={{ color: 'var(--accent)' }}>
                ── {error}
              </span>
            )}

            <div className="flex items-center justify-between gap-4 pt-2">
              <button
                type="button"
                onClick={() => setPicked(null)}
                className="text-xs underline underline-offset-4 decoration-1"
                style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
              >
                back
              </button>
              <div className="flex items-center gap-3">
                {opt!.supportsOAuth && (
                  <button
                    type="button"
                    onClick={connectOauth}
                    className="px-5 py-2 text-xs"
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--rule)',
                      color: 'var(--ink)',
                      fontFamily: 'var(--font-jetbrains)',
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                    }}
                  >
                    sign in instead
                  </button>
                )}
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-xs disabled:opacity-40"
                  style={{
                    background: 'var(--ink)',
                    color: 'var(--paper)',
                    fontFamily: 'var(--font-jetbrains)',
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                  }}
                >
                  {saving ? 'saving…' : 'save'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </Modal>
  )
}

// ─── Primitives ─────────────────────────────────────────────────────────────

function Modal({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(26,24,20,0.4)' }}
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[520px] p-8"
        style={{
          background: 'var(--paper)',
          border: '1px solid var(--rule)',
          boxShadow: '0 30px 60px -20px rgba(45,42,35,0.35)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span
        className="text-[10px] tracking-[0.18em] uppercase"
        style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
      >
        {label}
      </span>
      {children}
    </label>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function humanAgo(then: Date): string {
  const s = Math.floor((Date.now() - then.getTime()) / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
