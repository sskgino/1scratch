import { create } from 'zustand'
import { nanoid } from 'nanoid'

export interface BaseCard {
  id: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  createdAt: number
}

export interface Card extends BaseCard {
  type: 'card'
  prompt: string
  modelSlot: string
  status: 'idle' | 'streaming' | 'complete' | 'error'
  errorMessage?: string
  response: string
  model: string
  inputTokens?: number
  outputTokens?: number
}

interface CardsState {
  cards: Record<string, Card>
  maxZIndex: number
  addCard: (card: Omit<Card, 'id' | 'createdAt' | 'zIndex'>) => string
  updateCard: (id: string, patch: Partial<Card>) => void
  removeCard: (id: string) => void
  bringToFront: (id: string) => void
  clearAll: () => void
  loadCards: (cards: Record<string, Card>) => void
}

export const useCardsStore = create<CardsState>((set, get) => ({
  cards: {},
  maxZIndex: 0,

  addCard: (cardData) => {
    const id = nanoid()
    const { maxZIndex } = get()
    const newZ = maxZIndex + 1
    const card: Card = { ...cardData, id, createdAt: Date.now(), zIndex: newZ }
    set((s) => ({ cards: { ...s.cards, [id]: card }, maxZIndex: newZ }))
    return id
  },

  updateCard: (id, patch) => {
    set((s) => {
      const card = s.cards[id]
      if (!card) return s
      return { cards: { ...s.cards, [id]: { ...card, ...patch } } }
    })
  },

  removeCard: (id) => {
    set((s) => {
      const next = { ...s.cards }
      delete next[id]
      return { cards: next }
    })
  },

  bringToFront: (id) => {
    set((s) => {
      const newZ = s.maxZIndex + 1
      const card = s.cards[id]
      if (!card) return s
      return { cards: { ...s.cards, [id]: { ...card, zIndex: newZ } }, maxZIndex: newZ }
    })
  },

  clearAll: () => set({ cards: {}, maxZIndex: 0 }),

  loadCards: (cards) => {
    const maxZ = Object.values(cards).reduce((m, c) => Math.max(m, c.zIndex), 0)
    set({ cards, maxZIndex: maxZ })
  },
}))
