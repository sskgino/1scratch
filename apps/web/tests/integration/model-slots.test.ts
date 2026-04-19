// Integration test — model_slots CRUD via the library surface.
// Covers: empty list → 10 nulls, upsert, list → filled, clear, cross-tenant
// isolation, provider mismatch rejection, unknown-model rejection.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'

const hasDb = !!process.env.DATABASE_URL && !!process.env.DATABASE_URL_ADMIN
const d = hasDb ? describe : describe.skip

d('model_slots CRUD + RLS', () => {
  const adminSql = hasDb
    ? neon(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL!)
    : (null as never)
  const sql = hasDb ? neon(process.env.DATABASE_URL!) : (null as never)

  const userA = `user_slot_A_${randomUUID().slice(0, 8)}`
  const userB = `user_slot_B_${randomUUID().slice(0, 8)}`
  const connA = randomUUID()
  const connB = randomUUID()

  beforeAll(async () => {
    await adminSql`INSERT INTO users (id, email) VALUES
      (${userA}, ${userA + '@test.local'}),
      (${userB}, ${userB + '@test.local'})`
    // Seed two connections — Anthropic for A, OpenAI for B.
    await adminSql`INSERT INTO provider_connections
      (id, user_id, provider, kind, dek_ciphertext, secret_ciphertext, secret_iv, secret_tag)
      VALUES
      (${connA}, ${userA}, 'anthropic', 'api_key', 'stub', 'stub', 'stub', 'stub'),
      (${connB}, ${userB}, 'openai',    'api_key', 'stub', 'stub', 'stub', 'stub')`
  })

  afterAll(async () => {
    await adminSql`DELETE FROM users WHERE id IN (${userA}, ${userB})`
  })

  async function importSlots() {
    // Route through the actual library so withRls is exercised.
    return await import('../../src/lib/model-slots')
  }

  it('list returns 10 slots with nulls when none set', async () => {
    const { listSlots } = await importSlots()
    const slots = await listSlots(userA)
    expect(slots).toHaveLength(10)
    expect(slots.every((s) => s.modelId === null)).toBe(true)
    expect(slots.map((s) => s.slot)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
  })

  it('upsert then list reflects the slot', async () => {
    const { upsertSlot, listSlots } = await importSlots()
    await upsertSlot({
      userId: userA,
      slot: 3,
      providerConnectionId: connA,
      modelId: 'claude-sonnet-4.6',
      displayLabel: 'Primary',
    })
    const slots = await listSlots(userA)
    const s3 = slots.find((s) => s.slot === 3)!
    expect(s3.modelId).toBe('claude-sonnet-4.6')
    expect(s3.providerConnectionId).toBe(connA)
    expect(s3.displayLabel).toBe('Primary')
  })

  it('upsert is idempotent (update-in-place on same slot)', async () => {
    const { upsertSlot, listSlots } = await importSlots()
    await upsertSlot({
      userId: userA,
      slot: 3,
      providerConnectionId: connA,
      modelId: 'claude-haiku-4.5',
      displayLabel: null,
    })
    const s3 = (await listSlots(userA)).find((s) => s.slot === 3)!
    expect(s3.modelId).toBe('claude-haiku-4.5')
    expect(s3.displayLabel).toBeNull()
  })

  it('clearSlot removes the row', async () => {
    const { clearSlot, listSlots } = await importSlots()
    await clearSlot(userA, 3)
    const s3 = (await listSlots(userA)).find((s) => s.slot === 3)!
    expect(s3.modelId).toBeNull()
    expect(s3.providerConnectionId).toBeNull()
  })

  it('rejects slot out of range', async () => {
    const { upsertSlot, clearSlot, SlotValidationError } = await importSlots()
    await expect(
      upsertSlot({
        userId: userA,
        slot: 99,
        providerConnectionId: connA,
        modelId: 'claude-sonnet-4.6',
        displayLabel: null,
      }),
    ).rejects.toBeInstanceOf(SlotValidationError)
    await expect(clearSlot(userA, -1)).rejects.toBeInstanceOf(SlotValidationError)
  })

  it('rejects unknown model_id', async () => {
    const { upsertSlot, SlotValidationError } = await importSlots()
    await expect(
      upsertSlot({
        userId: userA,
        slot: 1,
        providerConnectionId: connA,
        modelId: 'gpt-9000-fantasy',
        displayLabel: null,
      }),
    ).rejects.toBeInstanceOf(SlotValidationError)
  })

  it('rejects provider/model mismatch', async () => {
    const { upsertSlot, SlotValidationError } = await importSlots()
    // connA is Anthropic; gpt-5.4 is OpenAI.
    await expect(
      upsertSlot({
        userId: userA,
        slot: 2,
        providerConnectionId: connA,
        modelId: 'gpt-5.4',
        displayLabel: null,
      }),
    ).rejects.toBeInstanceOf(SlotValidationError)
  })

  it('cross-tenant: user A cannot target user B\'s connection', async () => {
    const { upsertSlot, SlotValidationError } = await importSlots()
    // connB belongs to userB. userA's RLS-scoped SELECT returns zero rows,
    // so upsertSlot throws unknown_connection.
    await expect(
      upsertSlot({
        userId: userA,
        slot: 4,
        providerConnectionId: connB,
        modelId: 'gpt-5.4',
        displayLabel: null,
      }),
    ).rejects.toBeInstanceOf(SlotValidationError)
  })

  it('cross-tenant read: user A does not see user B\'s slots', async () => {
    const { upsertSlot, listSlots } = await importSlots()
    await upsertSlot({
      userId: userB,
      slot: 7,
      providerConnectionId: connB,
      modelId: 'gpt-5.4',
      displayLabel: null,
    })
    const aSlots = await listSlots(userA)
    expect(aSlots.find((s) => s.slot === 7)?.modelId).toBeNull()
    const bSlots = await listSlots(userB)
    expect(bSlots.find((s) => s.slot === 7)?.modelId).toBe('gpt-5.4')
  })

  // Keep the vi import used even if future flakes nuke a case.
  void vi
})
