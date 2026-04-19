// Public surface for @1scratch/sync-engine.

export { HLC, decodeHLC } from '@1scratch/sync-proto'
export type { Mutation, ServerMutation, PushRequest, PushResponse, PullResponse } from '@1scratch/sync-proto'

export { DirtyTracker } from './dirty-tracker'
export type { DirtyTrackerOptions } from './dirty-tracker'

export { Outbox } from './outbox'
export { Reconciler } from './reconciler'
export type { ReconcilerOptions } from './reconciler'

export { HttpClient } from './http-client'
export type { HttpClientError, HttpClientOptions } from './http-client'

export { SyncLoop } from './sync-loop'
export type { SyncLoopOptions } from './sync-loop'

export type {
  Store,
  StoredCard,
  StoredCanvas,
  StoredSection,
} from './store'
