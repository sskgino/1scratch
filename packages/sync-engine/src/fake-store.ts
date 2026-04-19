// In-memory Store for engine unit tests.
import type { Mutation } from '@1scratch/sync-proto'
import type { Store, StoredCanvas, StoredCard, StoredSection } from './store'

export class FakeStore implements Store {
  cards = new Map<string, StoredCard>()
  canvases = new Map<string, StoredCanvas>()
  sections = new Map<string, StoredSection>()
  outbox: Mutation[] = []
  snapshots = new Map<string, Record<string, unknown>>()
  meta = new Map<string, string>()

  async listCards(workspaceId: string) {
    return [...this.cards.values()].filter((c) => c.workspaceId === workspaceId && !c.deletedAt)
  }
  async listCanvases(workspaceId: string) {
    return [...this.canvases.values()].filter((c) => c.workspaceId === workspaceId)
  }
  async listSections(workspaceId: string) {
    return [...this.sections.values()].filter((s) => s.workspaceId === workspaceId)
  }

  async upsertCard(c: StoredCard) { this.cards.set(c.id, c) }
  async upsertCanvas(c: StoredCanvas) { this.canvases.set(c.id, c) }
  async upsertSection(s: StoredSection) { this.sections.set(s.id, s) }
  async softDeleteCard(id: string, version: string) {
    const c = this.cards.get(id)
    if (c) this.cards.set(id, { ...c, deletedAt: Date.now(), version })
  }
  async deleteCanvas(id: string) { this.canvases.delete(id) }
  async deleteSection(id: string) { this.sections.delete(id) }

  async enqueue(m: Mutation) { this.outbox.push(m) }
  async peekOutbox(limit: number) { return this.outbox.slice(0, limit) }
  async removeFromOutbox(ids: string[]) {
    const s = new Set(ids)
    this.outbox = this.outbox.filter((m) => !s.has(m.id))
  }
  async outboxDepth() { return this.outbox.length }

  async getFlushSnapshot(et: string, id: string) {
    return this.snapshots.get(`${et}:${id}`) ?? null
  }
  async setFlushSnapshot(et: string, id: string, snap: Record<string, unknown>) {
    this.snapshots.set(`${et}:${id}`, snap)
  }

  async getMeta(k: string) { return this.meta.get(k) ?? null }
  async setMeta(k: string, v: string) { this.meta.set(k, v) }
}
