import { QuotaError } from './types'

export interface QuotaSnapshot {
  tier: 'free' | 'pro'
  itemCount: number
  bytesCount: number
}

export const PRO_ITEM_CAP = 50_000
export const PRO_BYTE_CAP = 200_000_000

export function enforceQuota(snapshot: QuotaSnapshot, incomingTextLen: number): void {
  if (snapshot.tier !== 'pro') throw new QuotaError('not_pro')
  if (snapshot.itemCount >= PRO_ITEM_CAP) throw new QuotaError('item_cap')
  if (snapshot.bytesCount + incomingTextLen >= PRO_BYTE_CAP) throw new QuotaError('byte_cap')
}
