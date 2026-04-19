// Import a legacy `.scratch` canvas file into the cloud DB.
//
// Legacy file shape (apps/client/src/lib/persistence.ts):
//   { version: 1, id, name, cards: Record<string, Card>, viewport, lastModified }
// Legacy Card shape (apps/client/src/store/cards.ts):
//   { id, x, y, width, height, zIndex, createdAt,
//     type:'card', prompt, modelSlot, status, response, model,
//     inputTokens?, outputTokens?, errorMessage? }
//
// The cloud schema (PLAN.md §3) splits that into a canvases row + one cards
// row per card. We insert both inside a single withRls() transaction so
// RLS scope + atomicity hold.

import { z } from 'zod'
import { sqlUser, withRls } from '@/db/rls'
import { ensureDefaultWorkspaceAndSection } from './workspace'
import { nextHlc } from './hlc'

const ViewportSchema = z.object({
  panX: z.number(),
  panY: z.number(),
  zoom: z.number(),
})

const LegacyCardSchema = z.object({
  id: z.string().min(1).max(64),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  zIndex: z.number().int(),
  createdAt: z.number().int().optional(),
  type: z.literal('card'),
  prompt: z.string().default(''),
  modelSlot: z.string().default(''),
  status: z.enum(['idle', 'streaming', 'complete', 'error']).default('idle'),
  errorMessage: z.string().optional(),
  response: z.string().default(''),
  model: z.string().default(''),
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
})

export const ScratchFileSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  cards: z.record(z.string(), LegacyCardSchema),
  viewport: ViewportSchema,
  lastModified: z.number().int().optional(),
})

export type ScratchFile = z.infer<typeof ScratchFileSchema>

export class ImportError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export interface ImportResult {
  canvasId: string
  cardCount: number
  workspaceId: string
  sectionId: string
}

export async function importScratchFile(
  userId: string,
  file: ScratchFile,
): Promise<ImportResult> {
  const { workspaceId, sectionId } = await ensureDefaultWorkspaceAndSection(userId)

  const sql = sqlUser()
  const canvasVersion = nextHlc()

  // Find next position in section (append to end).
  const [posRows] = await withRls<[Array<{ next_pos: number | null }>]>(userId, [
    sql`SELECT COALESCE(MAX(position), 0) + 1 AS next_pos
        FROM canvases
        WHERE section_id = ${sectionId} AND deleted_at IS NULL`,
  ])
  const position = posRows[0]?.next_pos ?? 1

  const [canvasRows] = await withRls<[Array<{ id: string }>]>(userId, [
    sql`INSERT INTO canvases (user_id, workspace_id, section_id, name, viewport, position, version)
        VALUES (${userId}, ${workspaceId}, ${sectionId}, ${file.name}, ${JSON.stringify(file.viewport)}::jsonb, ${position}, ${canvasVersion.toString()}::bigint)
        RETURNING id`,
  ])
  const canvasId = canvasRows[0]!.id

  const cardList = Object.values(file.cards)
  if (cardList.length > 0) {
    const cardQueries = cardList.map((c) => {
      const payload = {
        prompt: c.prompt,
        modelSlot: c.modelSlot,
        status: c.status,
        response: c.response,
        model: c.model,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
        errorMessage: c.errorMessage,
      }
      const version = nextHlc()
      return sql`INSERT INTO cards (user_id, workspace_id, canvas_id, x, y, width, height, z_index, payload, version)
                 VALUES (${userId}, ${workspaceId}, ${canvasId}, ${c.x}, ${c.y}, ${c.width}, ${c.height}, ${c.zIndex}, ${JSON.stringify(payload)}::jsonb, ${version.toString()}::bigint)`
    })
    await withRls(userId, cardQueries)
  }

  return { canvasId, cardCount: cardList.length, workspaceId, sectionId }
}
