// Unit test for the ai-stream workflow orchestrator. The "use workflow" /
// "use step" directives are no-ops outside the Workflow DevKit compiler, so
// the function runs as plain JS — we stub the step-level I/O modules and
// assert the fallback chain + usage accounting.

import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── module stubs ──────────────────────────────────────────────────────────

const writtenChunks: string[] = []
vi.mock('workflow', () => ({
  getWritable: () => ({
    getWriter: () => ({
      write: async (c: string) => {
        writtenChunks.push(c)
      },
      releaseLock: () => {},
    }),
  }),
}))

// streamText branches on model.modelId: primary fails transient, fallback succeeds.
vi.mock('ai', () => ({
  streamText: vi.fn(({ model }: { model: { modelId: string } }) => {
    if (model.modelId === 'claude-sonnet-4.6') {
      return {
        textStream: {
          [Symbol.asyncIterator]() {
            return {
              next(): Promise<IteratorResult<string>> {
                return Promise.reject(new Error('503 upstream error'))
              },
            }
          },
        },
        usage: Promise.resolve({ inputTokens: 0, outputTokens: 0 }),
      }
    }
    return {
      textStream: (async function* () {
        yield 'hello '
        yield 'world'
      })(),
      usage: Promise.resolve({ inputTokens: 100, outputTokens: 50 }),
    }
  }),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: () => (modelId: string) => ({ modelId }),
}))
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => (modelId: string) => ({ modelId }),
}))
vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: () => (modelId: string) => ({ modelId }),
}))

vi.mock('@/lib/providers', () => ({
  loadDecryptedKey: vi.fn(async () => ({ plaintext: 'sk-test' })),
  findConnectionByProvider: vi.fn(async () => ({ id: 'conn-xyz' })),
}))

vi.mock('@/lib/model-slots', () => ({
  resolveSlot: vi.fn(),
}))

const recordUsage = vi.fn(async () => {})
vi.mock('@/lib/spend-cap', () => ({
  recordUsage: (...args: unknown[]) => recordUsage(...args),
}))

// ── tests ─────────────────────────────────────────────────────────────────

describe('aiStreamWorkflow', () => {
  beforeEach(() => {
    writtenChunks.length = 0
    recordUsage.mockClear()
  })

  it('falls back to claude-haiku-4.5 when claude-sonnet-4.6 throws transient, records usage for fallback', async () => {
    const { aiStreamWorkflow } = await import('../src/workflows/ai-stream')

    const result = await aiStreamWorkflow({
      userId: 'user-test',
      cardId: null,
      prompt: 'hi',
      provider: 'anthropic',
      modelId: 'claude-sonnet-4.6',
    })

    if ('error' in result) throw new Error(`unexpected error: ${result.error}`)
    expect(result.modelUsed).toBe('claude-haiku-4.5')
    expect(result.provider).toBe('anthropic')
    expect(result.inputTokens).toBe(100)
    expect(result.outputTokens).toBe(50)

    expect(recordUsage).toHaveBeenCalledTimes(1)
    expect(recordUsage).toHaveBeenCalledWith({
      userId: 'user-test',
      provider: 'anthropic',
      model: 'claude-haiku-4.5',
      inputTokens: 100,
      outputTokens: 50,
      cardId: null,
    })

    expect(writtenChunks).toEqual(['hello ', 'world'])
  })

  it('returns no_connection_for_request when resolution yields nothing', async () => {
    const { aiStreamWorkflow } = await import('../src/workflows/ai-stream')
    const { findConnectionByProvider } = await import('@/lib/providers')
    ;(findConnectionByProvider as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const result = await aiStreamWorkflow({
      userId: 'user-test',
      cardId: null,
      prompt: 'hi',
      provider: 'anthropic',
      modelId: 'claude-sonnet-4.6',
    })

    expect(result).toEqual({ error: 'no_connection_for_request' })
    expect(recordUsage).not.toHaveBeenCalled()
  })

  it('stops on no_key (non-transient) and does not try fallback', async () => {
    const { aiStreamWorkflow } = await import('../src/workflows/ai-stream')
    const { loadDecryptedKey } = await import('@/lib/providers')
    ;(loadDecryptedKey as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const result = await aiStreamWorkflow({
      userId: 'user-test',
      cardId: null,
      prompt: 'hi',
      provider: 'anthropic',
      modelId: 'claude-sonnet-4.6',
    })

    expect(result).toEqual({ error: 'no_key' })
    expect(recordUsage).not.toHaveBeenCalled()
  })
})
