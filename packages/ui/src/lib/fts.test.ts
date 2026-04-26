import { describe, it, expect } from 'vitest'
import { rewriteQuery } from './fts'

describe('fts.rewriteQuery', () => {
  it('appends * to each token', () => { expect(rewriteQuery('foo bar')).toBe('foo* bar*') })
  it('strips FTS5 special chars', () => { expect(rewriteQuery('foo:"bar(baz)')).toBe('foo* bar* baz*') })
  it('returns empty for whitespace', () => { expect(rewriteQuery('   ')).toBe('') })
})
