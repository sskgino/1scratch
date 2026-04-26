import Database from '@tauri-apps/plugin-sql'

export interface CardHit {
  cardId: string
  canvasId: string
  canvasName: string
  sectionName: string | null
  snippet: string
  rank: number
}

export function rewriteQuery(q: string): string {
  const cleaned = q.replace(/[":()*]/g, ' ').trim().split(/\s+/).filter(Boolean)
  return cleaned.map((t) => `${t}*`).join(' ')
}

export async function searchCards(
  db: Database,
  query: string,
  opts: { sectionId?: string; limit?: number } = {},
): Promise<CardHit[]> {
  const q = rewriteQuery(query)
  if (!q) return []
  const limit = opts.limit ?? 50
  const rows = await db.select<{ id: string; canvas_id: string; cv: string; sn: string | null; snippet: string; rank: number }[]>(
    `SELECT c.id AS id, c.canvas_id AS canvas_id, cv.name AS cv, s.name AS sn,
            snippet(cards_fts, 1, '«', '»', '…', 32) AS snippet,
            bm25(cards_fts) AS rank
       FROM cards_fts
       JOIN cards c ON c.id = cards_fts.card_id
       JOIN canvases cv ON cv.id = c.canvas_id
       LEFT JOIN sections s ON s.id = cv.section_id
      WHERE cards_fts MATCH $1
        AND ($2 IS NULL OR cv.section_id = $3)
      ORDER BY rank
      LIMIT $4`,
    [q, opts.sectionId ?? null, opts.sectionId ?? null, limit],
  )
  return rows.map((r) => ({
    cardId: r.id, canvasId: r.canvas_id,
    canvasName: r.cv, sectionName: r.sn,
    snippet: r.snippet, rank: r.rank,
  }))
}

export function snippetSegments(snippet: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = []
  let rest = snippet
  while (rest.length) {
    const open = rest.indexOf('«')
    if (open < 0) { out.push({ text: rest, hit: false }); break }
    if (open > 0) out.push({ text: rest.slice(0, open), hit: false })
    const close = rest.indexOf('»', open)
    if (close < 0) { out.push({ text: rest.slice(open + 1), hit: true }); break }
    out.push({ text: rest.slice(open + 1, close), hit: true })
    rest = rest.slice(close + 1)
  }
  return out
}
