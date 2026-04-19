'use client'

// Prompt workbench. Streams via /api/ai/stream using a populated slot from
// /app/models. No inline credential management — that lives on the models
// page.

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import type { ModelSlot, ProviderConnectionPublic } from '@1scratch/types'

interface RegistryEntry {
  id: string
  displayName: string
  displayAbbr: string
}

type Props = {
  populatedSlots: ModelSlot[]
  connections: ProviderConnectionPublic[]
  registry: RegistryEntry[]
  initialCapUsedCents: number
  capCents: number
}

export function Workbench({
  populatedSlots,
  connections,
  registry,
  initialCapUsedCents,
  capCents,
}: Props) {
  const registryById = useMemo(() => new Map(registry.map((m) => [m.id, m])), [registry])
  const connById = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections])

  const [activeSlot, setActiveSlot] = useState<number | null>(populatedSlots[0]?.slot ?? null)
  const [prompt, setPrompt] = useState('')
  const [response, setResponse] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [usedCents, setUsedCents] = useState(initialCapUsedCents)
  const abortRef = useRef<AbortController | null>(null)

  const currentSlot = populatedSlots.find((s) => s.slot === activeSlot) ?? null
  const currentModel = currentSlot?.modelId ? registryById.get(currentSlot.modelId) ?? null : null

  async function runPrompt(e: React.FormEvent) {
    e.preventDefault()
    if (activeSlot === null || streaming || !prompt.trim()) return
    setStreamError(null)
    setResponse('')
    setStreaming(true)
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      const res = await fetch('/api/ai/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slot: activeSlot, prompt }),
        signal: ctrl.signal,
      })
      if (!res.ok || !res.body) {
        const err = (await res.json().catch(() => ({}))) as {
          error?: string
          capCents?: number
          usedCents?: number
        }
        if (err.error === 'daily_cap_exceeded') {
          setStreamError(
            `daily cap reached — $${((err.usedCents ?? 0) / 100).toFixed(2)} of $${((err.capCents ?? 0) / 100).toFixed(2)}`,
          )
        } else {
          setStreamError(err.error ?? 'stream_failed')
        }
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        setResponse((prev) => prev + decoder.decode(value, { stream: true }))
      }
      const capRes = await fetch('/api/cap', { cache: 'no-store' }).catch(() => null)
      if (capRes?.ok) {
        const j = (await capRes.json()) as { usedCents: number }
        setUsedCents(j.usedCents)
      }
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        setStreamError(err instanceof Error ? err.message : 'unknown_error')
      }
    } finally {
      setStreaming(false)
    }
  }

  const percent = capCents > 0 ? Math.min(100, Math.round((usedCents / capCents) * 100)) : 0
  const dollarsUsed = (usedCents / 100).toFixed(2)
  const dollarsCap = (capCents / 100).toFixed(2)

  const responseModelLabel = currentModel?.displayName ?? currentSlot?.modelId ?? '—'

  return (
    <div className="max-w-[1280px] mx-auto">
      {/* Title block */}
      <div className="lift-in mb-10" style={{ animationDelay: '120ms' }}>
        <div className="marginalia mb-3">§ session ── untitled draft</div>
        <h1
          className="leading-[0.95] tracking-[-0.02em] text-[clamp(2.5rem,6vw,4.75rem)]"
          style={{
            fontFamily: 'var(--font-fraunces)',
            fontWeight: 380,
            fontVariationSettings: '"opsz" 144, "SOFT" 50',
          }}
        >
          Draft&nbsp;
          <em
            style={{
              fontStyle: 'italic',
              fontVariationSettings: '"opsz" 144, "SOFT" 100',
              color: 'var(--accent)',
            }}
          >
            something
          </em>
          .
        </h1>
      </div>

      {/* Slot chips — pick the model for this session */}
      <div className="lift-in mb-8" style={{ animationDelay: '220ms' }}>
        <SlotBar
          slots={populatedSlots}
          connections={connById}
          registry={registryById}
          activeSlot={activeSlot}
          onPick={setActiveSlot}
        />
      </div>

      {/* Two-pane workbench */}
      <section
        className="lift-in grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-10"
        style={{ animationDelay: '360ms' }}
      >
        <form onSubmit={runPrompt} className="relative">
          <div className="flex items-baseline justify-between border-b pb-1.5 mb-3" style={{ borderColor: 'var(--rule)' }}>
            <span className="marginalia">§01 ── prompt</span>
            <span className="marginalia" style={{ color: 'var(--ink-soft)' }}>
              enter ↵ to submit
            </span>
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                ;(e.currentTarget.form as HTMLFormElement).requestSubmit()
              }
            }}
            placeholder="Draft a working theory for why customers churn between week 2 and 3."
            rows={12}
            disabled={activeSlot === null}
            className="w-full resize-none bg-transparent focus:outline-none disabled:opacity-40"
            style={{
              fontFamily: 'var(--font-fraunces)',
              fontSize: '20px',
              lineHeight: '1.45',
              color: 'var(--ink)',
            }}
          />
          <div className="mt-4 flex items-center gap-5">
            <button
              type="submit"
              disabled={activeSlot === null || streaming || !prompt.trim()}
              className="group relative inline-flex items-center gap-3 px-6 py-3 text-xs transition-colors disabled:opacity-40"
              style={{
                background: 'var(--ink)',
                color: 'var(--paper)',
                fontFamily: 'var(--font-jetbrains)',
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
              }}
            >
              <span>{streaming ? 'drafting…' : 'submit'}</span>
              <span
                className="inline-block transition-transform group-hover:translate-x-1"
                style={{ color: 'var(--accent)' }}
              >
                ──&gt;
              </span>
            </button>
            {streaming && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="text-xs underline underline-offset-4 decoration-1"
                style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
              >
                cancel (esc)
              </button>
            )}
            {activeSlot === null && (
              <Link
                href="/app/models"
                className="marginalia underline underline-offset-4 decoration-1"
                style={{ color: 'var(--accent)' }}
              >
                ── configure a slot to begin
              </Link>
            )}
          </div>
        </form>

        <div className="relative">
          <div className="flex items-baseline justify-between border-b pb-1.5 mb-3" style={{ borderColor: 'var(--rule)' }}>
            <span className="marginalia">§02 ── response</span>
            <span className="marginalia" style={{ color: 'var(--ink-soft)' }}>
              {responseModelLabel}
            </span>
          </div>
          <div
            className="relative min-h-[320px] p-4"
            style={{
              background: '#fbf8f0',
              border: '1px solid var(--rule)',
              borderStyle: streaming ? 'dashed' : 'solid',
              boxShadow: '0 1px 0 rgba(45,42,35,0.06), 0 18px 36px -22px rgba(45,42,35,0.22)',
            }}
          >
            {response ? (
              <p
                className="whitespace-pre-wrap"
                style={{
                  fontFamily: 'var(--font-newsreader)',
                  fontSize: '17px',
                  lineHeight: '1.6',
                  color: 'var(--ink)',
                }}
              >
                {response}
                {streaming && (
                  <span className="inline-block w-[0.5ch] h-[1em] align-text-bottom ml-0.5 animate-pulse" style={{ background: 'var(--accent)' }} />
                )}
              </p>
            ) : (
              <p className="marginalia" style={{ color: 'var(--ink-soft)' }}>
                {streamError ? `── ${streamError}` : '── awaiting prompt'}
              </p>
            )}
          </div>
        </div>
      </section>

      <footer className="lift-in mt-16" style={{ animationDelay: '500ms' }}>
        <div className="rule" />
        <div
          className="mt-3 flex justify-between items-center text-[10px] tracking-[0.18em] uppercase"
          style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
        >
          <span>
            daily cap ── ${dollarsUsed} / ${dollarsCap}
          </span>
          <span className="flex items-center gap-3">
            <span
              className="inline-block h-[2px] w-[120px]"
              style={{ background: 'var(--paper-deep)' }}
            >
              <span
                className="block h-full"
                style={{ width: `${percent}%`, background: 'var(--accent)' }}
              />
            </span>
            <span>{percent}%</span>
          </span>
        </div>
      </footer>
    </div>
  )
}

function SlotBar({
  slots,
  connections,
  registry,
  activeSlot,
  onPick,
}: {
  slots: ModelSlot[]
  connections: Map<string, ProviderConnectionPublic>
  registry: Map<string, RegistryEntry>
  activeSlot: number | null
  onPick: (slot: number) => void
}) {
  if (slots.length === 0) {
    return (
      <div
        className="flex items-center justify-between gap-3 border-t border-b py-4 px-5"
        style={{ borderColor: 'var(--rule)' }}
      >
        <span
          style={{
            fontFamily: 'var(--font-jetbrains)',
            fontSize: '11px',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--ink-soft)',
          }}
        >
          no model slots — set one up first
        </span>
        <Link
          href="/app/models"
          className="text-xs underline underline-offset-4 decoration-1"
          style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--accent)' }}
        >
          go to models →
        </Link>
      </div>
    )
  }
  return (
    <div
      className="flex items-center gap-3 border-t border-b py-4 px-5"
      style={{ borderColor: 'var(--rule)' }}
    >
      <span
        style={{
          fontFamily: 'var(--font-jetbrains)',
          fontSize: '11px',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          color: 'var(--ink-soft)',
        }}
      >
        slot
      </span>
      <div className="flex flex-wrap items-center gap-2">
        {slots.map((s) => {
          const active = s.slot === activeSlot
          const conn = s.providerConnectionId ? connections.get(s.providerConnectionId) : null
          const model = s.modelId ? registry.get(s.modelId) : null
          return (
            <button
              key={s.slot}
              type="button"
              onClick={() => onPick(s.slot)}
              className="px-3 py-1.5 text-xs transition-colors"
              style={{
                background: active ? 'var(--ink)' : 'transparent',
                color: active ? 'var(--paper)' : 'var(--ink)',
                border: '1px solid var(--rule)',
                fontFamily: 'var(--font-jetbrains)',
                letterSpacing: '0.04em',
              }}
            >
              <span style={{ color: active ? 'var(--paper-deep)' : 'var(--ink-soft)' }}>{s.slot}</span>
              <span className="ml-2">{s.displayLabel ?? model?.displayAbbr ?? s.modelId}</span>
              {conn && (
                <span className="ml-2 opacity-60">· {conn.provider}</span>
              )}
            </button>
          )
        })}
        <Link
          href="/app/models"
          className="px-3 py-1.5 text-xs underline underline-offset-4 decoration-1"
          style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
        >
          edit →
        </Link>
      </div>
    </div>
  )
}
