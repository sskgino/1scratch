// POST /api/providers/:id/verify — run the provider-specific probe, update
// the connection's status + last_verified_at, return the model list.
//
// The cached 24h verification the PLAN mentions is implicit: the client
// decides when to call /verify (slot picker re-verifies if stale).

import { auth } from '@clerk/nextjs/server'
import { z } from 'zod'
import { loadDecryptedKey, loadConnectionMeta, markVerified } from '@/lib/providers'
import { verifyProvider } from '@/lib/verifiers'
import { modelsByProvider } from '@/lib/model-registry'

export const runtime = 'nodejs'
export const maxDuration = 15

const IdSchema = z.string().uuid()

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  const { id } = await params
  const parsed = IdSchema.safeParse(id)
  if (!parsed.success) {
    return Response.json({ error: 'invalid_id' }, { status: 400 })
  }

  const meta = await loadConnectionMeta(userId, parsed.data)
  if (!meta) return Response.json({ error: 'not_found' }, { status: 404 })

  const decrypted = await loadDecryptedKey(userId, parsed.data)
  if (!decrypted) return Response.json({ error: 'not_found' }, { status: 404 })

  const result = await verifyProvider({
    provider: meta.provider,
    secret: decrypted.plaintext,
    endpointUrl: meta.endpointUrl ?? undefined,
  })

  await markVerified(userId, parsed.data, result.status)

  // Intersect provider's raw model list with the curated registry so the
  // slot picker only offers models we know how to price + fallback for.
  const registryIds = new Set(modelsByProvider(meta.provider).map((m) => m.id))
  const supported = result.models.filter((id) => registryIds.has(id))

  return Response.json({
    status: result.status,
    models: result.models,
    supportedModels: supported,
    error: result.error ?? null,
  })
}
