import type { Mutation } from '@1scratch/sync-proto'
import type { Store } from './store'

export class Outbox {
  private readonly retries = new Map<string, number>()

  constructor(private readonly store: Store) {}

  peek(limit: number): Promise<Mutation[]> {
    return this.store.peekOutbox(limit)
  }

  confirm(ids: string[]): Promise<void> {
    for (const id of ids) this.retries.delete(id)
    return this.store.removeFromOutbox(ids)
  }

  recordFailure(id: string): void {
    this.retries.set(id, (this.retries.get(id) ?? 0) + 1)
  }

  retryCount(id: string): number {
    return this.retries.get(id) ?? 0
  }

  depth(): Promise<number> {
    return this.store.outboxDepth()
  }
}
