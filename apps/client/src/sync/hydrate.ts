// One-shot on app boot: read local SQLite into Zustand.
import type { TauriSqliteStore } from './tauri-sqlite-store'
import { useCardsStore, type Card as UiCard } from '@1scratch/ui/store/cards'
import { useWorkspaceStore, type Section, type Tab } from '@1scratch/ui/store/workspace'

export async function hydrateFromStore(store: TauriSqliteStore, workspaceId: string): Promise<void> {
  const [sections, canvases, cards] = await Promise.all([
    store.listSections(workspaceId),
    store.listCanvases(workspaceId),
    store.listCards(workspaceId),
  ])
  if (sections.length === 0 && canvases.length === 0) return // fresh install; keep in-memory defaults

  const tabsBySection = new Map<string, Tab[]>()
  for (const c of canvases) {
    const tab: Tab = { id: c.id, name: c.name, sectionId: c.sectionId, color: c.color ?? null }
    const arr = tabsBySection.get(c.sectionId) ?? []
    arr.push(tab)
    tabsBySection.set(c.sectionId, arr)
  }

  const uiSections: Section[] = sections.map((s) => ({
    id: s.id,
    name: s.name,
    permanent: s.permanent,
    tabs: tabsBySection.get(s.id) ?? [],
    activeTabId: (tabsBySection.get(s.id) ?? [])[0]?.id ?? null,
    color: s.color,
  }))

  useWorkspaceStore.setState({
    sections: uiSections,
    activeSectionId: uiSections[0]?.id ?? '',
  })

  const cardMap: Record<string, UiCard> = {}
  for (const c of cards) {
    const p = c.payload as {
      prompt?: string; modelSlot?: string; status?: UiCard['status']; response?: string;
      model?: string; inputTokens?: number; outputTokens?: number; errorMessage?: string
    }
    cardMap[c.id] = {
      id: c.id,
      type: 'card',
      x: c.x, y: c.y, width: c.width, height: c.height, zIndex: c.zIndex,
      createdAt: Date.now(),
      prompt: p.prompt ?? '',
      modelSlot: p.modelSlot ?? '0',
      status: p.status ?? 'idle',
      response: p.response ?? '',
      model: p.model ?? '',
      inputTokens: p.inputTokens,
      outputTokens: p.outputTokens,
      errorMessage: p.errorMessage,
    }
  }
  useCardsStore.getState().loadCards(cardMap)
}
