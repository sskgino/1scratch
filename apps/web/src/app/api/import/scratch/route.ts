// POST /api/import/scratch — import a legacy `.scratch` file into the caller's
// default workspace. Body is the JSON from the file; see lib/import-scratch.ts
// for shape. Cap body at 5 MB so a malicious/corrupt upload can't DOS the
// parser.

import { resolveAuthedUserId } from '@/lib/auth-resolver'
import { importScratchFile, ScratchFileSchema, ImportError } from '@/lib/import-scratch'
import { record } from '@/lib/audit-events'

export const runtime = 'nodejs'

const MAX_BYTES = 5 * 1024 * 1024

export async function POST(req: Request) {
  const userId = await resolveAuthedUserId(req)
  if (!userId) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  const contentLength = Number(req.headers.get('content-length') ?? 0)
  if (contentLength > MAX_BYTES) {
    return Response.json({ error: 'payload_too_large' }, { status: 413 })
  }

  const text = await req.text()
  if (text.length > MAX_BYTES) {
    return Response.json({ error: 'payload_too_large' }, { status: 413 })
  }

  let json
  try {
    json = JSON.parse(text)
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = ScratchFileSchema.safeParse(json)
  if (!parsed.success) {
    return Response.json(
      { error: 'invalid_file', issues: parsed.error.issues },
      { status: 400 },
    )
  }

  try {
    const result = await importScratchFile(userId, parsed.data)
    await record(userId, 'scratch_imported', {
      meta: {
        canvasId: result.canvasId,
        cardCount: result.cardCount,
        sourceName: parsed.data.name,
      },
    })
    return Response.json(result)
  } catch (err) {
    if (err instanceof ImportError) {
      return Response.json({ error: err.code, message: err.message }, { status: 400 })
    }
    console.error('[api/import/scratch] failed', err)
    return Response.json({ error: 'import_failed' }, { status: 500 })
  }
}
