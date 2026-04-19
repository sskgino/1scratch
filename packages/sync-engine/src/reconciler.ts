import type { ServerMutation } from '@1scratch/sync-proto'
import type { Store, StoredCanvas, StoredCard, StoredSection } from './store'

export interface ReconcilerOptions {
  store: Store
  ownDeviceId: string
  workspaceIdResolver: () => string
  onApply?: (m: ServerMutation) => void
}

export class Reconciler {
  constructor(private readonly opts: ReconcilerOptions) {}

  async apply(mutations: ServerMutation[]): Promise<void> {
    const sorted = [...mutations].sort((a, b) => (BigInt(a.version) < BigInt(b.version) ? -1 : 1))
    for (const m of sorted) {
      if (m.deviceId === this.opts.ownDeviceId) continue
      if (m.entityType === 'card') await this.applyCard(m)
      else if (m.entityType === 'canvas') await this.applyCanvas(m)
      else if (m.entityType === 'section') await this.applySection(m)
      this.opts.onApply?.(m)
    }
  }

  private async applyCard(m: ServerMutation): Promise<void> {
    const workspaceId = this.opts.workspaceIdResolver()
    if (m.op === 'delete') {
      await this.opts.store.softDeleteCard(m.entityId, m.version)
      return
    }
    const existing = (await this.opts.store.listCards(workspaceId)).find((c) => c.id === m.entityId)
    if (existing && BigInt(existing.version) >= BigInt(m.version)) return
    const next: StoredCard = {
      id: m.entityId,
      workspaceId,
      canvasId: (m.patch.canvasId as string | undefined) ?? existing?.canvasId ?? '',
      x: (m.patch.x as number | undefined) ?? existing?.x ?? 0,
      y: (m.patch.y as number | undefined) ?? existing?.y ?? 0,
      width: (m.patch.width as number | undefined) ?? existing?.width ?? 300,
      height: (m.patch.height as number | undefined) ?? existing?.height ?? 200,
      zIndex: (m.patch.zIndex as number | undefined) ?? existing?.zIndex ?? 0,
      payload: mergePayload(existing?.payload, m.patch.payload as Record<string, unknown> | undefined),
      version: m.version,
      deletedAt: null,
    }
    await this.opts.store.upsertCard(next)
  }

  private async applyCanvas(m: ServerMutation): Promise<void> {
    const workspaceId = this.opts.workspaceIdResolver()
    if (m.op === 'delete') { await this.opts.store.deleteCanvas(m.entityId); return }
    const existing = (await this.opts.store.listCanvases(workspaceId)).find((c) => c.id === m.entityId)
    if (existing && BigInt(existing.version) >= BigInt(m.version)) return
    const next: StoredCanvas = {
      id: m.entityId,
      workspaceId,
      sectionId: (m.patch.sectionId as string | undefined) ?? existing?.sectionId ?? '',
      name: (m.patch.name as string | undefined) ?? existing?.name ?? '',
      color: (m.patch.color as string | null | undefined) ?? existing?.color ?? null,
      viewport:
        (m.patch.viewport as StoredCanvas['viewport'] | undefined) ??
        existing?.viewport ?? { panX: 0, panY: 0, zoom: 1 },
      position: (m.patch.position as number | undefined) ?? existing?.position ?? 0,
      version: m.version,
    }
    await this.opts.store.upsertCanvas(next)
  }

  private async applySection(m: ServerMutation): Promise<void> {
    const workspaceId = this.opts.workspaceIdResolver()
    if (m.op === 'delete') { await this.opts.store.deleteSection(m.entityId); return }
    const existing = (await this.opts.store.listSections(workspaceId)).find((s) => s.id === m.entityId)
    if (existing && BigInt(existing.version) >= BigInt(m.version)) return
    const next: StoredSection = {
      id: m.entityId,
      workspaceId,
      name: (m.patch.name as string | undefined) ?? existing?.name ?? '',
      color: (m.patch.color as string | null | undefined) ?? existing?.color ?? null,
      position: (m.patch.position as number | undefined) ?? existing?.position ?? 0,
      permanent: (m.patch.permanent as boolean | undefined) ?? existing?.permanent ?? false,
      version: m.version,
    }
    await this.opts.store.upsertSection(next)
  }
}

function mergePayload(
  prev: Record<string, unknown> | undefined,
  incoming: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!prev && !incoming) return {}
  if (!prev) return { ...incoming }
  if (!incoming) return prev
  return { ...prev, ...incoming }
}
