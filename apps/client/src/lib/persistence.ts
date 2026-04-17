import type { Card } from '../store/cards'

export interface CanvasFileState {
  version: 1
  id: string
  name: string
  cards: Record<string, Card>
  viewport: { panX: number; panY: number; zoom: number }
  lastModified: number
}

export function serializeCanvas(
  cards: Record<string, Card>,
  viewport: { panX: number; panY: number; zoom: number },
  name = 'Untitled',
  id: string,
): CanvasFileState {
  return {
    version: 1,
    id,
    name,
    cards,
    viewport,
    lastModified: Date.now(),
  }
}

export function deserializeCanvas(raw: string): CanvasFileState {
  const data = JSON.parse(raw)
  if (data.version !== 1) throw new Error('Unsupported file version')
  return data as CanvasFileState
}
