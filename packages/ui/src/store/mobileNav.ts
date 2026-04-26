import { create } from 'zustand'

export type MobileTab = 'capture' | 'canvas' | 'library' | 'you'
export type SheetKind = 'tab-switcher' | 'sync-diagnostics' | 'context-menu' | 'camera' | 'search' | 'settings'

export interface SheetDescriptor {
  id: string
  kind: SheetKind
  props?: Record<string, unknown>
}

interface MobileNavState {
  tab: MobileTab
  sheetStack: SheetDescriptor[]
  setTab: (tab: MobileTab) => void
  pushSheet: (s: SheetDescriptor) => void
  popSheet: () => void
}

const STORAGE_KEY = '1scratch:mobileNav.tab'

function readInitialTab(): MobileTab {
  if (typeof localStorage === 'undefined') return 'capture'
  const v = localStorage.getItem(STORAGE_KEY)
  if (v === 'capture' || v === 'canvas' || v === 'library' || v === 'you') return v
  return 'capture'
}

export const useMobileNav = create<MobileNavState>((set) => ({
  tab: readInitialTab(),
  sheetStack: [],
  setTab: (tab) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, tab)
    set({ tab })
  },
  pushSheet: (s) => set((st) => ({ sheetStack: [...st.sheetStack, s] })),
  popSheet:  () => set((st) => ({ sheetStack: st.sheetStack.slice(0, -1) })),
}))
