import { describe, it, expect, vi, beforeEach } from 'vitest'
import { startDictation } from './voice'

class MockRecognition {
  continuous = false
  interimResults = false
  lang = ''
  onresult: ((e: unknown) => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  start = vi.fn()
  stop = vi.fn(() => { this.onend?.() })
  abort = vi.fn()
}

describe('voice — Web Speech path', () => {
  beforeEach(() => {
    ;(window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = MockRecognition
    ;(window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = undefined
  })

  it('streams partials and resolves with final on stop', async () => {
    const mkResult = (transcript: string, isFinal: boolean) =>
      Object.assign([{ transcript }], { isFinal })
    const partials: string[] = []
    const handle = await startDictation({ onPartial: (t) => partials.push(t) })
    const inst = (handle as unknown as { _inst: MockRecognition })._inst
    inst.onresult?.({ results: [mkResult('hello', false)], resultIndex: 0 })
    inst.onresult?.({ results: [mkResult('hello world', true)], resultIndex: 0 })
    const { finalText } = await handle.stop()
    expect(partials.length).toBeGreaterThan(0)
    expect(finalText).toBe('hello world')
  })
})

describe('voice — fallback path', () => {
  beforeEach(() => {
    ;(window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = undefined
    ;(window as unknown as { webkitSpeechRecognition: unknown }).webkitSpeechRecognition = undefined

    const recorder = {
      start: vi.fn(),
      stop: vi.fn(),
      ondataavailable: null as ((e: { data: Blob }) => void) | null,
      onstop: null as (() => void) | null,
      state: 'inactive',
      stream: null as MediaStream | null,
    }
    ;(globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = vi.fn(() => recorder)
    ;(navigator as unknown as { mediaDevices: unknown }).mediaDevices = {
      getUserMedia: vi.fn(async () => ({ getTracks: () => [] })),
    }
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
      async () => new Response(JSON.stringify({ text: 'transcribed' }), { status: 200 }),
    )
  })

  it('hits /api/ai with transcribe=true and returns final text', async () => {
    const handle = await startDictation({})
    const recorder = (MediaRecorder as unknown as { mock: { results: { value: { ondataavailable: ((e: { data: Blob }) => void) | null; onstop: (() => void) | null } }[] } }).mock.results[0].value
    setTimeout(() => {
      recorder.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) })
      recorder.onstop?.()
    }, 0)
    const { finalText } = await handle.stop()
    expect(finalText).toBe('transcribed')
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/ai'),
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('surfaces 402 as cap_exceeded', async () => {
    ;(globalThis as unknown as { fetch: unknown }).fetch = vi.fn(
      async () => new Response('cap', { status: 402 }),
    )
    const errors: { kind: string }[] = []
    const handle = await startDictation({ onError: (e) => errors.push(e) })
    const recorder = (MediaRecorder as unknown as { mock: { results: { value: { ondataavailable: ((e: { data: Blob }) => void) | null; onstop: (() => void) | null } }[] } }).mock.results[0].value
    setTimeout(() => {
      recorder.ondataavailable?.({ data: new Blob(['x'], { type: 'audio/webm' }) })
      recorder.onstop?.()
    }, 0)
    await handle.stop()
    expect(errors).toContainEqual({ kind: 'cap_exceeded' })
  })
})
