export type VoiceError =
  | { kind: 'permission_denied' }
  | { kind: 'no_speech' }
  | { kind: 'network' }
  | { kind: 'transcribe_failed'; status: number }
  | { kind: 'cap_exceeded' }
  | { kind: 'unsupported' }

export interface VoiceHandle {
  stop: () => Promise<{ finalText: string }>
  abort: () => void
}

export interface StartOpts {
  onPartial?: (text: string) => void
  onFinal?: (text: string) => void
  onError?: (e: VoiceError) => void
}

declare global {
  interface Window {
    SpeechRecognition?: unknown
    webkitSpeechRecognition?: unknown
  }
}

const MAX_RECORD_MS = 60_000

function getSR(): unknown {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

export async function startDictation(opts: StartOpts): Promise<VoiceHandle> {
  const SR = getSR()
  if (SR) return webSpeech(SR as new () => unknown, opts)
  return fallback(opts)
}

function webSpeech(SR: new () => unknown, opts: StartOpts): VoiceHandle {
  const inst = new SR() as {
    continuous: boolean
    interimResults: boolean
    lang: string
    onresult: ((e: { results: { 0: { transcript: string }; isFinal: boolean }[]; resultIndex: number }) => void) | null
    onerror: ((e: { error: string }) => void) | null
    onend: (() => void) | null
    start: () => void
    stop: () => void
    abort: () => void
  }
  inst.continuous = true
  inst.interimResults = true
  inst.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'

  let cumulative = ''
  inst.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const result = e.results[i]
      if (!result) continue
      const r = result[0]
      if (!r) continue
      if (result.isFinal) cumulative += r.transcript
      else interim += r.transcript
    }
    if (interim) opts.onPartial?.(cumulative + interim)
    else opts.onFinal?.(cumulative)
  }
  inst.onerror = (e) => {
    if (e.error === 'not-allowed') opts.onError?.({ kind: 'permission_denied' })
    else if (e.error === 'no-speech') opts.onError?.({ kind: 'no_speech' })
    else if (e.error === 'network') opts.onError?.({ kind: 'network' })
  }

  let resolveStop: ((v: { finalText: string }) => void) | null = null
  inst.onend = () => { resolveStop?.({ finalText: cumulative }) }
  inst.start()

  const handle = {
    _inst: inst,
    stop: () => new Promise<{ finalText: string }>((res) => { resolveStop = res; inst.stop() }),
    abort: () => { try { inst.abort() } catch { /* ignore */ } },
  }
  return handle as unknown as VoiceHandle
}

async function fallback(opts: StartOpts): Promise<VoiceHandle> {
  let stream: MediaStream | null = null
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch {
    opts.onError?.({ kind: 'permission_denied' })
    return { stop: async () => ({ finalText: '' }), abort: () => {} }
  }

  const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
  const chunks: Blob[] = []
  recorder.ondataavailable = (e: BlobEvent) => { if (e.data?.size > 0) chunks.push(e.data) }

  let stopResolve: ((v: { finalText: string }) => void) | null = null

  const finishUpload = async () => {
    const blob = new Blob(chunks, { type: 'audio/webm' })
    const fd = new FormData()
    fd.append('audio', blob, 'capture.webm')
    fd.append('transcribe', 'true')
    try {
      const apiBase = (globalThis as unknown as { API_BASE_URL?: string }).API_BASE_URL ?? ''
      const res = await fetch(`${apiBase}/api/ai`, { method: 'POST', body: fd })
      if (res.status === 402) {
        opts.onError?.({ kind: 'cap_exceeded' })
        stopResolve?.({ finalText: '' })
        return
      }
      if (!res.ok) {
        opts.onError?.({ kind: 'transcribe_failed', status: res.status })
        stopResolve?.({ finalText: '' })
        return
      }
      const body = await res.json() as { text: string }
      opts.onFinal?.(body.text)
      stopResolve?.({ finalText: body.text })
    } catch {
      opts.onError?.({ kind: 'network' })
      stopResolve?.({ finalText: '' })
    } finally {
      stream?.getTracks().forEach((t) => t.stop())
    }
  }

  recorder.onstop = () => { void finishUpload() }
  recorder.start(250)

  const cap = setTimeout(() => { try { recorder.stop() } catch { /* ignore */ } }, MAX_RECORD_MS)

  return {
    stop: () => new Promise<{ finalText: string }>((res, rej) => {
      stopResolve = res
      clearTimeout(cap)
      try { recorder.stop() } catch (e) { rej(e) }
    }),
    abort: () => {
      clearTimeout(cap)
      try { recorder.stop() } catch { /* ignore */ }
      stream?.getTracks().forEach((t) => t.stop())
    },
  }
}
