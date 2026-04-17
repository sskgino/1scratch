// Soft pastel palette used to tint sidebar sections & horizontal tabs.
// Each entry pairs a base swatch (used as the chip fill) with darker text/border
// shades so the same color reads on both the dark sidebar and the light tab bar.

export interface PastelSwatch {
  id: string
  label: string
  base: string       // pill background on light surfaces
  baseDark: string   // pill background on dark surfaces (sidebar)
  ink: string        // text color on the base swatch
  edge: string       // 1px border on light surfaces
}

export const PASTEL_PALETTE: PastelSwatch[] = [
  { id: 'peach',     label: 'Peach',     base: '#FFD9C7', baseDark: '#9A6A55', ink: '#5C3A2A', edge: '#F0BFA5' },
  { id: 'butter',    label: 'Butter',    base: '#FFE9B0', baseDark: '#9A8A4E', ink: '#5C4A1F', edge: '#EFD68B' },
  { id: 'mint',      label: 'Mint',      base: '#C7EBD8', baseDark: '#5E8E7A', ink: '#2C5746', edge: '#A8D8BD' },
  { id: 'sky',       label: 'Sky',       base: '#C9E4F2', baseDark: '#5E8AA0', ink: '#27506B', edge: '#A6CFE3' },
  { id: 'lavender',  label: 'Lavender',  base: '#DCD4F0', baseDark: '#7B72A0', ink: '#3F3868', edge: '#BFB3DD' },
  { id: 'rose',      label: 'Rose',      base: '#F2D4DC', baseDark: '#A06E7C', ink: '#693745', edge: '#DEB3BD' },
  { id: 'sage',      label: 'Sage',      base: '#D5E2C9', baseDark: '#7A8A68', ink: '#3D4A2D', edge: '#B8CAA6' },
  { id: 'clay',      label: 'Clay',      base: '#E8D5C0', baseDark: '#9A7E63', ink: '#5A3F28', edge: '#CDB69B' },
]

export const NEUTRAL_SWATCH: PastelSwatch = {
  id: 'none',
  label: 'None',
  base: 'transparent',
  baseDark: 'transparent',
  ink: 'inherit',
  edge: 'transparent',
}

export function getSwatch(id: string | null | undefined): PastelSwatch | null {
  if (!id || id === 'none') return null
  return PASTEL_PALETTE.find((s) => s.id === id) ?? null
}

// Deterministic pick used when seeding new tabs/sections so colors cycle
// predictably instead of clustering.
export function nextSwatchId(usedIds: (string | null | undefined)[]): string {
  // Count usage per swatch and prefer least-used (then earliest in palette).
  const counts = new Map<string, number>()
  for (const id of usedIds) {
    if (!id) continue
    counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  let best = PASTEL_PALETTE[0].id
  let bestCount = counts.get(best) ?? 0
  for (const s of PASTEL_PALETTE) {
    const c = counts.get(s.id) ?? 0
    if (c < bestCount) {
      best = s.id
      bestCount = c
    }
  }
  return best
}
