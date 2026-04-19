// Integration test — requires live AWS KMS + AWS_KMS_KEY_ID in env.
// Skipped when env is absent so local devs + CI without AWS creds still green.

import { describe, it, expect } from 'vitest'
import { seal, open, type EncryptionContext } from './kms'

const hasAws = !!process.env.AWS_KMS_KEY_ID && !!process.env.AWS_REGION
const d = hasAws ? describe : describe.skip

d('envelope encryption (live KMS)', () => {
  const ctx: EncryptionContext = {
    userId: 'user_test_vitest',
    purpose: 'provider_secret',
    rowId: 'row-abc-123',
  }

  it('round-trips a secret', async () => {
    const plaintext = 'sk-ant-api03-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    const sealed = await seal(plaintext, ctx)
    expect(sealed.ciphertext).toBeTruthy()
    expect(sealed.dekCiphertext).toBeTruthy()
    const opened = await open(sealed, ctx)
    expect(opened).toBe(plaintext)
  })

  it('rejects when encryption context does not match', async () => {
    const sealed = await seal('hello', ctx)
    await expect(open(sealed, { ...ctx, rowId: 'different-row' })).rejects.toThrow()
  })
})
