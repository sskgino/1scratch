import {
  KMSClient,
  GenerateDataKeyCommand,
  DecryptCommand,
} from '@aws-sdk/client-kms'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const region = process.env.AWS_REGION
const keyId = process.env.AWS_KMS_KEY_ID
console.log(`[verify-kms] region=${region} keyId=${keyId}`)

const client = new KMSClient({ region })
const ctx = {
  userId: '00000000-0000-0000-0000-000000000001',
  purpose: 'provider_secret',
  rowId: 'verify-roundtrip',
}

const plaintext = 'sk-ant-api03-TEST-PLAINTEXT-VERIFY'
console.log(`[verify-kms] plaintext = ${JSON.stringify(plaintext)}`)

const dek = await client.send(
  new GenerateDataKeyCommand({
    KeyId: keyId,
    KeySpec: 'AES_256',
    EncryptionContext: ctx,
  }),
)
const iv = randomBytes(12)
const cipher = createCipheriv('aes-256-gcm', Buffer.from(dek.Plaintext), iv)
const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
const tag = cipher.getAuthTag()
console.log(`[verify-kms] sealed: ${ct.length}B ct, ${dek.CiphertextBlob.length}B wrapped-DEK`)

const unwrapped = await client.send(
  new DecryptCommand({
    CiphertextBlob: dek.CiphertextBlob,
    EncryptionContext: ctx,
  }),
)
const decipher = createDecipheriv('aes-256-gcm', Buffer.from(unwrapped.Plaintext), iv)
decipher.setAuthTag(tag)
const pt = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')

if (pt !== plaintext) {
  console.error('[verify-kms] MISMATCH:', pt)
  process.exit(1)
}
console.log('[verify-kms] round-trip OK')

try {
  await client.send(
    new DecryptCommand({
      CiphertextBlob: dek.CiphertextBlob,
      EncryptionContext: { ...ctx, rowId: 'different-row' },
    }),
  )
  console.error('[verify-kms] context binding broken — decrypt succeeded with wrong ctx')
  process.exit(1)
} catch (e) {
  console.log(`[verify-kms] context binding enforced: ${e.name}`)
}
