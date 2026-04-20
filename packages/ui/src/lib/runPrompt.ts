import { useCardsStore } from '../store/cards'
import { useSettingsStore } from '../store/settings'
import { streamPrompt } from './ai'

const abortControllers = new Map<string, AbortController>()

export async function runPrompt(cardId: string) {
  const { cards, updateCard } = useCardsStore.getState()
  const { apiKey, getModel } = useSettingsStore.getState()

  const card = cards[cardId]
  if (!card) return
  if (!card.prompt.trim()) return
  if (card.status === 'streaming') return

  if (!apiKey) {
    updateCard(cardId, { status: 'error', errorMessage: 'No API key — open Settings.' })
    return
  }

  const model = getModel(card.modelSlot)

  // Expand card to make room for the response
  const expandedHeight = Math.max(card.height + 260, 320)

  updateCard(cardId, {
    status: 'streaming',
    response: '',
    model,
    errorMessage: undefined,
    height: expandedHeight,
    inputTokens: undefined,
    outputTokens: undefined,
  })

  const abort = new AbortController()
  abortControllers.set(cardId, abort)

  await streamPrompt(
    card.prompt,
    model,
    apiKey,
    (chunk) => {
      const current = useCardsStore.getState().cards[cardId]
      if (current) {
        useCardsStore.getState().updateCard(cardId, { response: current.response + chunk })
      }
    },
    (usage) => {
      useCardsStore.getState().updateCard(cardId, {
        status: 'complete',
        inputTokens: usage.input,
        outputTokens: usage.output,
      })
      abortControllers.delete(cardId)
    },
    (err) => {
      useCardsStore.getState().updateCard(cardId, {
        status: 'error',
        errorMessage: err.message,
      })
      abortControllers.delete(cardId)
    },
    abort.signal,
  )
}

export function cancelPrompt(cardId: string) {
  const abort = abortControllers.get(cardId)
  if (abort) {
    abort.abort()
    abortControllers.delete(cardId)
    useCardsStore.getState().updateCard(cardId, { status: 'idle' })
  }
}
