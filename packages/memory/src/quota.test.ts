import { describe, it, expect, vi } from 'vitest'
import { QuotaError } from './types'
import { enforceQuota, QuotaSnapshot } from './quota'

function snapshot(tier: 'free' | 'pro', items: number, bytes: number): QuotaSnapshot {
  return { tier, itemCount: items, bytesCount: bytes }
}

describe('enforceQuota', () => {
  it('rejects non-pro users', () => {
    expect(() => enforceQuota(snapshot('free', 0, 0), 100)).toThrow(QuotaError)
    try { enforceQuota(snapshot('free', 0, 0), 100) } catch (e) {
      expect((e as QuotaError).which).toBe('not_pro')
    }
  })

  it('rejects at item cap (50k)', () => {
    expect(() => enforceQuota(snapshot('pro', 50_000, 0), 100)).toThrow(QuotaError)
    try { enforceQuota(snapshot('pro', 50_000, 0), 100) } catch (e) {
      expect((e as QuotaError).which).toBe('item_cap')
    }
  })

  it('rejects at byte cap (200MB)', () => {
    expect(() => enforceQuota(snapshot('pro', 0, 200_000_000), 1)).toThrow(QuotaError)
  })

  it('allows under caps', () => {
    expect(() => enforceQuota(snapshot('pro', 49_999, 199_999_000), 100)).not.toThrow()
  })
})
