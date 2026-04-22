import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import type { MemoryStrategy } from './types'
import { register, get, list, clear } from './registry'

function makeStrategy(id: string): MemoryStrategy {
  return {
    id,
    version: '1.0.0',
    ingestors: [],
    retrievers: [],
    configSchema: z.object({}),
    defaults: { enabled: true, weight: 1, params: {} },
  }
}

describe('registry', () => {
  beforeEach(() => clear())

  it('registers and retrieves strategies by id', () => {
    const a = makeStrategy('a')
    register(a)
    expect(get('a')).toBe(a)
    expect(list()).toEqual([a])
  })

  it('is idempotent on repeat register (same id overwrites)', () => {
    register(makeStrategy('x'))
    const x2 = makeStrategy('x')
    register(x2)
    expect(get('x')).toBe(x2)
    expect(list()).toHaveLength(1)
  })

  it('returns undefined for unknown id', () => {
    expect(get('nope')).toBeUndefined()
  })
})
