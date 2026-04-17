import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const FONTS = [
  { id: 'Caveat', label: 'Caveat', css: "'Caveat', cursive" },
  { id: 'Kalam', label: 'Kalam', css: "'Kalam', cursive" },
  { id: 'Patrick Hand', label: 'Patrick Hand', css: "'Patrick Hand', cursive" },
  { id: 'Dancing Script', label: 'Dancing Script', css: "'Dancing Script', cursive" },
  { id: 'Permanent Marker', label: 'Permanent Marker', css: "'Permanent Marker', cursive" },
  { id: 'Inter', label: 'Inter (Sans)', css: "'Inter', system-ui, sans-serif" },
  { id: 'system', label: 'System UI', css: "system-ui, sans-serif" },
  { id: 'serif', label: 'Serif', css: "Georgia, serif" },
]

export const DEFAULT_MODEL_SLOTS: Record<string, string> = {
  '0': 'claude-sonnet-4-6',
  '1': 'claude-opus-4-6',
  '2': 'claude-haiku-4-5-20251001',
  '3': '',
  '4': '',
  '5': '',
  '6': '',
  '7': '',
  '8': '',
  '9': '',
}

interface SettingsState {
  apiKey: string
  fontFamily: string          // font id, e.g. 'Caveat'
  modelSlots: Record<string, string>
  setApiKey: (key: string) => void
  setFontFamily: (f: string) => void
  setModelSlot: (slot: string, model: string) => void
  getFontCss: () => string
  getModel: (slot: string) => string
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      apiKey: '',
      fontFamily: 'Caveat',
      modelSlots: { ...DEFAULT_MODEL_SLOTS },

      setApiKey: (apiKey) => set({ apiKey }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setModelSlot: (slot, model) =>
        set((s) => ({ modelSlots: { ...s.modelSlots, [slot]: model } })),

      getFontCss: () => {
        const { fontFamily } = get()
        return FONTS.find((f) => f.id === fontFamily)?.css ?? "'Caveat', cursive"
      },

      getModel: (slot) => {
        const { modelSlots } = get()
        return modelSlots[slot] || modelSlots['0'] || 'claude-sonnet-4-6'
      },
    }),
    { name: 'scratch-settings' },
  ),
)
