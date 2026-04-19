import type { PushRequest, PushResponse, PullResponse, Mutation } from '@1scratch/sync-proto'
import type { Store } from './store'
import { Reconciler } from './reconciler'

export interface SyncLoopOptions {
  store: Store
  http: { push(body: PushRequest): Promise<PushResponse>; pull(since: string, limit: number): Promise<PullResponse> }
  deviceId: string
  ownDeviceWorkspaceId: () => string
  pollIntervalMs: number
  onError?: (e: Error) => void
}

const MAX_BACKOFF_MS = 60_000
const BATCH_SIZE = 100

export class SyncLoop {
  private pushInFlight: Promise<void> | null = null
  private pullInFlight: Promise<void> | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private reconciler: Reconciler
  backoffMs = 0

  constructor(private readonly opts: SyncLoopOptions) {
    this.reconciler = new Reconciler({
      store: opts.store,
      ownDeviceId: opts.deviceId,
      workspaceIdResolver: opts.ownDeviceWorkspaceId,
    })
  }

  start(): void {
    this.pollTimer = setInterval(() => { void this.triggerNow() }, this.opts.pollIntervalMs)
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = null
  }

  async triggerNow(): Promise<void> {
    await this.doPush()
    await this.doPull()
  }

  private async doPush(): Promise<void> {
    if (this.pushInFlight) { await this.pushInFlight; return }
    this.pushInFlight = this.pushOnce().finally(() => { this.pushInFlight = null })
    await this.pushInFlight
  }

  private async doPull(): Promise<void> {
    if (this.pullInFlight) { await this.pullInFlight; return }
    this.pullInFlight = this.pullOnce().finally(() => { this.pullInFlight = null })
    await this.pullInFlight
  }

  private async pushOnce(): Promise<void> {
    const mutations: Mutation[] = await this.opts.store.peekOutbox(BATCH_SIZE)
    if (mutations.length === 0) return
    const baseVersion = (await this.opts.store.getMeta('lastServerVersion')) ?? '0'
    try {
      const res = await this.opts.http.push({
        deviceId: this.opts.deviceId,
        baseVersion,
        mutations,
      })
      await this.opts.store.removeFromOutbox(res.accepted)
      if (res.additional.length > 0) await this.reconciler.apply(res.additional)
      await this.opts.store.setMeta('lastServerVersion', res.serverVersion)
      this.backoffMs = 0
    } catch (e) {
      this.bumpBackoff()
      this.opts.onError?.(e instanceof Error ? e : new Error(String(e)))
      throw e
    }
  }

  private async pullOnce(): Promise<void> {
    const since = (await this.opts.store.getMeta('lastServerVersion')) ?? '0'
    try {
      const res = await this.opts.http.pull(since, 500)
      if (res.mutations.length > 0) await this.reconciler.apply(res.mutations)
      await this.opts.store.setMeta('lastServerVersion', res.serverVersion)
      this.backoffMs = 0
      if (res.more) await this.pullOnce()
    } catch (e) {
      this.bumpBackoff()
      this.opts.onError?.(e instanceof Error ? e : new Error(String(e)))
      throw e
    }
  }

  private bumpBackoff(): void {
    this.backoffMs = this.backoffMs === 0 ? 1000 : Math.min(this.backoffMs * 2, MAX_BACKOFF_MS)
  }
}
