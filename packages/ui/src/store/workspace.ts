import { create } from 'zustand'
import { nextSwatchId } from '../lib/colors'

export interface Tab {
  id: string
  name: string
  sectionId: string
  color?: string | null  // swatch id from PASTEL_PALETTE, or 'none' / null
}

export interface Section {
  id: string
  name: string
  permanent: boolean
  tabs: Tab[]
  activeTabId: string | null
  color?: string | null
}

interface WorkspaceState {
  sections: Section[]
  activeSectionId: string
  sidebarCollapsed: boolean
  colorsEnabled: boolean

  // Sections
  addSection: (name: string) => string
  removeSection: (id: string) => void
  renameSection: (id: string, name: string) => void
  setSectionColor: (id: string, color: string | null) => void

  // Tabs
  addTab: (sectionId: string, name: string) => string
  removeTab: (sectionId: string, tabId: string) => void
  renameTab: (sectionId: string, tabId: string, name: string) => void
  setActiveTab: (sectionId: string, tabId: string) => void
  setTabColor: (sectionId: string, tabId: string, color: string | null) => void

  // Navigation & prefs
  setActiveSection: (id: string) => void
  toggleSidebar: () => void
  setColorsEnabled: (enabled: boolean) => void
}

const DEFAULT_SECTION_ID = crypto.randomUUID()
const DEFAULT_TAB_ID = crypto.randomUUID()

const defaultSection: Section = {
  id: DEFAULT_SECTION_ID,
  name: 'General',
  permanent: true,
  tabs: [{ id: DEFAULT_TAB_ID, name: 'Canvas 1', sectionId: DEFAULT_SECTION_ID, color: nextSwatchId([]) }],
  activeTabId: DEFAULT_TAB_ID,
  color: nextSwatchId([]),
}

export const useWorkspaceStore = create<WorkspaceState>()((set, get) => ({
  sections: [defaultSection],
  activeSectionId: DEFAULT_SECTION_ID,
  sidebarCollapsed: false,
  colorsEnabled: true,

  addSection: (name) => {
    const id = crypto.randomUUID()
    const tabId = crypto.randomUUID()
    const usedTabColors = get().sections.flatMap((s) => s.tabs.map((t) => t.color))
    const tab: Tab = { id: tabId, name: 'Canvas 1', sectionId: id, color: nextSwatchId(usedTabColors) }
    const usedSectionColors = get().sections.map((s) => s.color)
    const section: Section = {
      id,
      name,
      permanent: false,
      tabs: [tab],
      activeTabId: tabId,
      color: nextSwatchId(usedSectionColors),
    }
    set((s) => ({
      sections: [...s.sections, section],
      activeSectionId: id,
    }))
    return id
  },

  removeSection: (id) => {
    const { sections, activeSectionId } = get()
    const section = sections.find((s) => s.id === id)
    if (!section || section.permanent) return
    const next = sections.filter((s) => s.id !== id)
    set({
      sections: next,
      activeSectionId: activeSectionId === id ? next[0]?.id ?? '' : activeSectionId,
    })
  },

  renameSection: (id, name) => {
    set((s) => ({
      sections: s.sections.map((sec) =>
        sec.id === id ? { ...sec, name } : sec,
      ),
    }))
  },

  setSectionColor: (id, color) => {
    set((s) => ({
      sections: s.sections.map((sec) =>
        sec.id === id ? { ...sec, color } : sec,
      ),
    }))
  },

  addTab: (sectionId, name) => {
    const tabId = crypto.randomUUID()
    const usedColors = get().sections.flatMap((s) => s.tabs.map((t) => t.color))
    const tab: Tab = { id: tabId, name, sectionId, color: nextSwatchId(usedColors) }
    set((s) => ({
      sections: s.sections.map((sec) =>
        sec.id === sectionId
          ? { ...sec, tabs: [...sec.tabs, tab], activeTabId: tabId }
          : sec,
      ),
    }))
    return tabId
  },

  removeTab: (sectionId, tabId) => {
    set((s) => ({
      sections: s.sections.map((sec) => {
        if (sec.id !== sectionId) return sec
        const tabs = sec.tabs.filter((t) => t.id !== tabId)
        let activeTabId = sec.activeTabId
        if (activeTabId === tabId) {
          activeTabId = tabs.length > 0 ? tabs[tabs.length - 1]!.id : null
        }
        return { ...sec, tabs, activeTabId }
      }),
    }))
  },

  renameTab: (sectionId, tabId, name) => {
    set((s) => ({
      sections: s.sections.map((sec) =>
        sec.id === sectionId
          ? {
              ...sec,
              tabs: sec.tabs.map((t) =>
                t.id === tabId ? { ...t, name } : t,
              ),
            }
          : sec,
      ),
    }))
  },

  setActiveTab: (sectionId, tabId) => {
    set((s) => ({
      sections: s.sections.map((sec) =>
        sec.id === sectionId ? { ...sec, activeTabId: tabId } : sec,
      ),
    }))
  },

  setTabColor: (sectionId, tabId, color) => {
    set((s) => ({
      sections: s.sections.map((sec) =>
        sec.id === sectionId
          ? {
              ...sec,
              tabs: sec.tabs.map((t) =>
                t.id === tabId ? { ...t, color } : t,
              ),
            }
          : sec,
      ),
    }))
  },

  setActiveSection: (id) => set({ activeSectionId: id }),

  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  setColorsEnabled: (enabled) => set({ colorsEnabled: enabled }),
}))
