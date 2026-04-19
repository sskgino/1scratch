'use client'

// Settings panel: audit log viewer (§2), .scratch import (Phase 2 step 7),
// and the account-deletion request/cancel flow (§5).

import { useRef, useState, useTransition } from 'react'
import type { AuthEventRow } from '@/lib/audit-events'
import type { DeletionRequestPublic } from '@/lib/account-deletion'

interface Props {
  initialEvents: AuthEventRow[]
  initialDeletion: DeletionRequestPublic | null
}

export function SettingsPanel({ initialEvents, initialDeletion }: Props) {
  return (
    <div className="max-w-[960px] mx-auto space-y-16">
      <header className="lift-in">
        <div className="marginalia mb-3">§ settings ── security & data</div>
        <h1
          className="leading-[0.95] tracking-[-0.02em] text-[clamp(2rem,5vw,3.75rem)]"
          style={{
            fontFamily: 'var(--font-fraunces)',
            fontWeight: 380,
            fontVariationSettings: '"opsz" 144, "SOFT" 50',
          }}
        >
          Settings.
        </h1>
      </header>

      <ImportSection />
      <AuditSection initialEvents={initialEvents} />
      <DangerSection initialDeletion={initialDeletion} />
    </div>
  )
}

// ── Import .scratch ─────────────────────────────────────────────────────────

function ImportSection() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<'idle' | 'uploading' | 'ok' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  async function handleFile(file: File) {
    setStatus('uploading')
    setMessage(null)
    try {
      const text = await file.text()
      const res = await fetch('/api/import/scratch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: text,
      })
      const j = (await res.json().catch(() => ({}))) as {
        error?: string
        canvasId?: string
        cardCount?: number
      }
      if (!res.ok) {
        setStatus('error')
        setMessage(j.error ?? 'import_failed')
        return
      }
      setStatus('ok')
      setMessage(`imported canvas ${j.canvasId} · ${j.cardCount} card(s)`)
    } catch (err) {
      setStatus('error')
      setMessage(err instanceof Error ? err.message : 'unknown')
    }
  }

  return (
    <section className="lift-in">
      <SectionHeader label="§01 ── import .scratch" />
      <p className="mb-4 text-sm opacity-80" style={{ fontFamily: 'var(--font-newsreader)' }}>
        Upload a legacy local `.scratch` canvas file. A new canvas lands in your default workspace
        under the “Imported” section.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".scratch,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleFile(f)
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={status === 'uploading'}
        className="px-5 py-2 text-xs uppercase tracking-[0.06em] disabled:opacity-40"
        style={{
          background: 'var(--ink)',
          color: 'var(--paper)',
          fontFamily: 'var(--font-jetbrains)',
        }}
      >
        {status === 'uploading' ? 'uploading…' : 'pick a .scratch file'}
      </button>
      {message && (
        <p className="mt-3 text-xs" style={{ color: status === 'error' ? 'crimson' : 'var(--ink-soft)' }}>
          {message}
        </p>
      )}
    </section>
  )
}

// ── Audit log ───────────────────────────────────────────────────────────────

function AuditSection({ initialEvents }: { initialEvents: AuthEventRow[] }) {
  const [events, setEvents] = useState(initialEvents)
  const [isPending, startTransition] = useTransition()

  function refresh() {
    startTransition(async () => {
      const res = await fetch('/api/audit-events', { cache: 'no-store' })
      if (res.ok) {
        const j = (await res.json()) as { events: AuthEventRow[] }
        setEvents(j.events)
      }
    })
  }

  return (
    <section className="lift-in">
      <div className="flex items-baseline justify-between mb-3">
        <SectionHeader label="§02 ── security log" />
        <button
          type="button"
          onClick={refresh}
          disabled={isPending}
          className="text-xs underline underline-offset-4 decoration-1 disabled:opacity-40"
          style={{ fontFamily: 'var(--font-jetbrains)', color: 'var(--ink-soft)' }}
        >
          {isPending ? 'refreshing…' : 'refresh'}
        </button>
      </div>
      {events.length === 0 ? (
        <p className="text-sm opacity-70">no events yet.</p>
      ) : (
        <ul className="divide-y" style={{ borderColor: 'var(--rule)' }}>
          {events.map((e) => (
            <li key={e.id} className="py-2 flex items-baseline gap-4 text-xs" style={{ fontFamily: 'var(--font-jetbrains)' }}>
              <time className="shrink-0 opacity-70" dateTime={e.ts}>
                {new Date(e.ts).toISOString().slice(0, 19).replace('T', ' ')}
              </time>
              <span className="font-semibold">{e.kind}</span>
              {e.ip && <span className="opacity-60">ip {e.ip}</span>}
              {Object.keys(e.meta).length > 0 && (
                <span className="opacity-60 truncate">{JSON.stringify(e.meta)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// ── Danger zone ─────────────────────────────────────────────────────────────

function DangerSection({
  initialDeletion,
}: {
  initialDeletion: DeletionRequestPublic | null
}) {
  const [deletion, setDeletion] = useState(initialDeletion)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [confirmUrl, setConfirmUrl] = useState<string | null>(null)

  async function requestDelete() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/account/delete-request', { method: 'POST' })
      const j = (await res.json().catch(() => ({}))) as {
        error?: string
        requestId?: string
        confirmUrl?: string
      }
      if (!res.ok) {
        setMessage(j.error ?? 'failed')
      } else {
        setMessage('email sent. click the confirm link to start the 24-hr cool-off.')
        if (j.confirmUrl) setConfirmUrl(j.confirmUrl)
      }
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/account/delete-cancel', { method: 'POST' })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setMessage(j.error ?? 'failed')
      } else {
        setDeletion(null)
        setMessage('deletion cancelled.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="lift-in pb-20">
      <SectionHeader label="§03 ── danger zone" />
      {deletion ? (
        <div>
          <p className="text-sm mb-2" style={{ fontFamily: 'var(--font-newsreader)' }}>
            Deletion request is <strong>{deletion.status}</strong>.
            {deletion.status === 'confirmed' && (
              <>
                {' '}Executes after{' '}
                <span className="font-mono">{deletion.executesAfter}</span>.
              </>
            )}
          </p>
          <button
            type="button"
            onClick={cancel}
            disabled={busy}
            className="px-5 py-2 text-xs uppercase tracking-[0.06em] disabled:opacity-40"
            style={{
              background: 'transparent',
              color: 'var(--ink)',
              border: '1px solid var(--rule)',
              fontFamily: 'var(--font-jetbrains)',
            }}
          >
            {busy ? 'cancelling…' : 'cancel deletion'}
          </button>
        </div>
      ) : (
        <div>
          <p className="text-sm mb-3 opacity-80" style={{ fontFamily: 'var(--font-newsreader)' }}>
            Delete the account. We email a confirmation link; once you click it, a 24-hour
            cool-off begins and you can cancel anytime during it. After that window closes, all
            data is permanently removed.
          </p>
          <button
            type="button"
            onClick={requestDelete}
            disabled={busy}
            className="px-5 py-2 text-xs uppercase tracking-[0.06em] disabled:opacity-40"
            style={{
              background: 'crimson',
              color: 'var(--paper)',
              fontFamily: 'var(--font-jetbrains)',
            }}
          >
            {busy ? 'sending…' : 'delete account'}
          </button>
        </div>
      )}
      {message && (
        <p className="mt-3 text-xs" style={{ color: 'var(--ink-soft)' }}>
          {message}
        </p>
      )}
      {confirmUrl && (
        <p className="mt-2 text-xs break-all opacity-70" style={{ fontFamily: 'var(--font-jetbrains)' }}>
          dev confirm link: {confirmUrl}
        </p>
      )}
    </section>
  )
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div
      className="mb-4 pb-1.5 border-b flex items-baseline justify-between"
      style={{ borderColor: 'var(--rule)' }}
    >
      <span className="marginalia">{label}</span>
    </div>
  )
}
