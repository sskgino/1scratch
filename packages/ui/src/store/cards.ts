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

export type SyncState = 'synced' | 'pending' | 'conflict'

const CONFLICT_TTL_MS = 60_000

interface CardsState {
  cards: Record<string, Card>
  maxZIndex: number
  selectedCardId: string | null
  pendingIds: ReadonlySet<string>
  conflicts: Map<string, number>
  outboxCount: number
  addCard: (card: Omit<PromptCard, 'id' | 'createdAt' | 'zIndex' | 'updatedAt'> | Omit<ImageCard, 'id' | 'createdAt' | 'zIndex' | 'updatedAt'>) => string
  updateCard: (id: string, patch: Partial<Card>) => void
  removeCard: (id: string) => void
  bringToFront: (id: string) => void
  setSelectedCard: (id: string | null) => void
  setPendingIds: (ids: Iterable<string>) => void
  setOutboxCount: (n: number) => void
  markConflict: (id: string) => void
  syncState: (id: string) => SyncState
  clearAll: () => void
  loadCards: (cards: Record<string, Card>) => void
}

export const useCardsStore = create<CardsState>((set, get) => ({
  cards: {},
  maxZIndex: 0,
  selectedCardId: null,
  pendingIds: new Set<string>(),
  conflicts: new Map<string, number>(),
  outboxCount: 0,

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

  setPendingIds: (ids) => set({ pendingIds: new Set(ids) }),

  setOutboxCount: (n) => set({ outboxCount: n }),

  markConflict: (id) => set((s) => {
    const next = new Map(s.conflicts)
    next.set(id, Date.now())
    return { conflicts: next }
  }),

  syncState: (id) => {
    const s = get()
    const at = s.conflicts.get(id)
    if (at !== undefined && Date.now() - at < CONFLICT_TTL_MS) return 'conflict'
    if (s.pendingIds.has(id)) return 'pending'
    return 'synced'
  },

  clearAll: () => set({ cards: {}, maxZIndex: 0, selectedCardId: null, pendingIds: new Set(), conflicts: new Map(), outboxCount: 0 }),

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
