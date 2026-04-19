import type { HLC } from '@1scratch/sync-engine'
import type { Mutation } from '@1scratch/sync-engine'
import type { TauriSqliteStore } from './tauri-sqlite-store'

interface LegacyTab { id: string; name: string; color?: string | null }
interface LegacySection { id: string; name: string; permanent: boolean; tabs: LegacyTab[]; color?: string | null }
interface LegacyPersisted { state: { sections: LegacySection[]; activeSectionId: string } }

export async function migrateLegacyZustand(store: TauriSqliteStore, workspaceId: string, hlc: HLC): Promise<number> {
  void workspaceId
  const done = await store.getMeta('migratedFromZustand')
  if (done === 'true') return 0
  const raw = localStorage.getItem('scratch-workspace')
  if (!raw) {
    await store.setMeta('migratedFromZustand', 'true')
    return 0
  }
  let parsed: LegacyPersisted
  try { parsed = JSON.parse(raw) } catch {
    await store.setMeta('migratedFromZustand', 'true')
    return 0
  }
  const legacy = parsed?.state?.sections ?? []
  const mutations: Mutation[] = []
  const idMap = new Map<string, string>()
  const mint = (legacyId: string) => {
    const existing = idMap.get(legacyId)
    if (existing) return existing
    const u = crypto.randomUUID()
    idMap.set(legacyId, u)
    return u
  }
  let position = 0
  for (const sec of legacy) {
    const sectionId = mint(sec.id)
    mutations.push({
      id: `mig-sec-${sectionId}`,
      entityType: 'section', entityId: sectionId, op: 'upsert',
      patch: { name: sec.name, color: sec.color ?? null, position, permanent: sec.permanent },
      clientVersion: hlc.now().toString(),
    })
    position += 1
    let canvasPosition = 0
    for (const tab of sec.tabs) {
      const canvasId = mint(tab.id)
      mutations.push({
        id: `mig-cv-${canvasId}`,
        entityType: 'canvas', entityId: canvasId, op: 'upsert',
        patch: {
          sectionId, name: tab.name, color: tab.color ?? null,
          viewport: { panX: 0, panY: 0, zoom: 1 }, position: canvasPosition,
        },
        clientVersion: hlc.now().toString(),
      })
      canvasPosition += 1
    }
  }
  for (const m of mutations) await store.enqueue(m)
  await store.setMeta('migratedFromZustand', 'true')
  return mutations.length
}
