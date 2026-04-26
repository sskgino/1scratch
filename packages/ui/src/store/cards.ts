import { create } from 'zustand'

export interface BaseCard {
  id: string
  canvasId: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  createdAt: number
  updatedAt: number
}

export interface PromptCard extends BaseCard {
  kind: 'prompt'
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

export interface ImageCard extends BaseCard {
  kind: 'image'
  type: 'card'
  fullPath?: string
  thumbPath?: string
  capturedAt: number
  originDeviceId: string
  caption?: string
}

export type Card = PromptCard | ImageCard

interface CardsState {
  cards: Record<string, Card>
  maxZIndex: number
  selectedCardId: string | null
  addCard: (card: Omit<PromptCard, 'id' | 'createdAt' | 'zIndex' | 'updatedAt'> | Omit<ImageCard, 'id' | 'createdAt' | 'zIndex' | 'updatedAt'>) => string
  updateCard: (id: string, patch: Partial<Card>) => void
  removeCard: (id: string) => void
  bringToFront: (id: string) => void
  setSelectedCard: (id: string | null) => void
  clearAll: () => void
  loadCards: (cards: Record<string, Card>) => void
}

export const useCardsStore = create<CardsState>((set, get) => ({
  cards: {},
  maxZIndex: 0,
  selectedCardId: null,

  addCard: (cardData) => {
    const id = crypto.randomUUID()
    const { maxZIndex } = get()
    const newZ = maxZIndex + 1
    const now = Date.now()
    const card = { ...cardData, id, createdAt: now, updatedAt: now, zIndex: newZ } as Card
    set((s) => ({ cards: { ...s.cards, [id]: card }, maxZIndex: newZ }))
    return id
  },

  updateCard: (id, patch) => {
    set((s) => {
      const card = s.cards[id]
      if (!card) return s
      const next = { ...card, ...patch, updatedAt: Date.now() } as Card
      return { cards: { ...s.cards, [id]: next } }
    })
  },

  removeCard: (id) => {
    set((s) => {
      const next = { ...s.cards }
      delete next[id]
      return { cards: next, selectedCardId: s.selectedCardId === id ? null : s.selectedCardId }
    })
  },

  bringToFront: (id) => {
    set((s) => {
      const newZ = s.maxZIndex + 1
      const card = s.cards[id]
      if (!card) return s
      return { cards: { ...s.cards, [id]: { ...card, zIndex: newZ } as Card }, maxZIndex: newZ }
    })
  },

  setSelectedCard: (id) => set({ selectedCardId: id }),

  clearAll: () => set({ cards: {}, maxZIndex: 0, selectedCardId: null }),

  loadCards: (cards) => {
    const normalized: Record<string, Card> = {}
    for (const [id, c] of Object.entries(cards)) {
      const raw = c as Partial<Card> & Record<string, unknown>
      const kind = (raw.kind as Card['kind'] | undefined) ?? 'prompt'
      normalized[id] = {
        ...(raw as object),
        kind,
        updatedAt: (raw.updatedAt as number | undefined) ?? (raw.createdAt as number | undefined) ?? Date.now(),
      } as Card
    }
    const maxZ = Object.values(normalized).reduce((m, c) => Math.max(m, c.zIndex), 0)
    set({ cards: normalized, maxZIndex: maxZ })
  },
}))
