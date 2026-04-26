import { create } from 'zustand'
import { useViewport } from '../hooks/useViewport'
import { useSettingsStore } from './settings'

interface CanvasState {
  panX: number
  panY: number
  zoom: number
  viewModes: Record<string, 'stack' | 'spatial'>
  setPan: (x: number, y: number) => void
  setZoom: (zoom: number, originX?: number, originY?: number) => void
  setViewMode: (canvasId: string, mode: 'stack' | 'spatial') => void
  resetViewport: () => void
  loadViewport: (v: { panX: number; panY: number; zoom: number }) => void
}

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4.0

export const useCanvasStore = create<CanvasState>((set, get) => ({
  panX: 0,
  panY: 0,
  zoom: 1,
  viewModes: {},

  setPan: (x, y) => set({ panX: x, panY: y }),

  setZoom: (zoom, originX = 0, originY = 0) => {
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))
    const { panX, panY, zoom: oldZoom } = get()
    // zoom toward the origin point
    const scale = clamped / oldZoom
    const newPanX = originX - scale * (originX - panX)
    const newPanY = originY - scale * (originY - panY)
    set({ zoom: clamped, panX: newPanX, panY: newPanY })
  },

  setViewMode: (canvasId, mode) =>
    set((s) => ({ viewModes: { ...s.viewModes, [canvasId]: mode } })),

  resetViewport: () => set({ panX: 0, panY: 0, zoom: 1 }),

  loadViewport: (v) => set({ panX: v.panX, panY: v.panY, zoom: v.zoom }),
}))

export function useEffectiveViewMode(canvasId: string): 'stack' | 'spatial' {
  const explicit = useCanvasStore((s) => s.viewModes[canvasId])
  const { isMobile } = useViewport()
  const spatialDefault = useSettingsStore((s) => s.spatialOnMobile)
  if (explicit) return explicit
  return isMobile && !spatialDefault ? 'stack' : 'spatial'
}
