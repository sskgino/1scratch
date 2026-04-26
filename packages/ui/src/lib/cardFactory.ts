import type { PromptCard } from '../store/cards'

export function makeCard(
  canvasId: string,
  x: number,
  y: number,
  overrides: Partial<PromptCard> = {},
): Omit<PromptCard, 'id' | 'createdAt' | 'zIndex' | 'updatedAt'> {
  return {
    kind: 'prompt',
    type: 'card',
    canvasId,
    x,
    y,
    width: 130,
    height: 42,
    prompt: '',
    modelSlot: '0',
    status: 'idle',
    response: '',
    model: '',
    ...overrides,
  }
}
