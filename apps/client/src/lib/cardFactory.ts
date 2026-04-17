import type { Card } from '../store/cards'

export function makeCard(
  x: number,
  y: number,
  overrides: Partial<Card> = {},
): Omit<Card, 'id' | 'createdAt' | 'zIndex'> {
  return {
    type: 'card',
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
