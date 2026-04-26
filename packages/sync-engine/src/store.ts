// Pluggable storage abstraction. Desktop uses TauriSqliteStore (apps/client/src/sync);
// tests use FakeStore. Future mobile reuses the SQLite impl; future web canvas
// would add an IndexedDBStore.

import type { Mutation, ServerMutation } from '@1scratch/sync-proto'

export interface StoredCard {
  id: string
  workspaceId: string
  canvasId: string
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  payload: Record<string, unknown>
  version: string
  deletedAt: number | null
}

export interface StoredCanvas {
  id: string
  workspaceId: string
  sectionId: string
  name: string
  color: string | null
  viewport: { panX: number; panY: number; zoom: number }
  position: number
  version: string
}

export interface StoredSection {
  id: string
  workspaceId: string
  name: string
  color: string | null
  position: number
  permanent: boolean
  version: string
}

export interface Store {
  listCards(workspaceId: string): Promise<StoredCard[]>
  listCanvases(workspaceId: string): Promise<StoredCanvas[]>
  listSections(workspaceId: string): Promise<StoredSection[]>

  upsertCard(c: StoredCard): Promise<void>
  upsertCanvas(c: StoredCanvas): Promise<void>
  upsertSection(s: StoredSection): Promise<void>
  softDeleteCard(id: string, version: string): Promise<void>
  deleteCanvas(id: string): Promise<void>
  deleteSection(id: string): Promise<void>

  enqueue(m: Mutation): Promise<void>
  peekOutbox(limit: number): Promise<Mutation[]>
  removeFromOutbox(ids: string[]): Promise<void>
  outboxDepth(): Promise<number>
  recordOutboxFailure(id: string, error: string): Promise<void>

  getFlushSnapshot(entityType: string, entityId: string): Promise<Record<string, unknown> | null>
  setFlushSnapshot(entityType: string, entityId: string, snapshot: Record<string, unknown>): Promise<void>

  getMeta(key: string): Promise<string | null>
  setMeta(key: string, value: string): Promise<void>
}

export type { Mutation, ServerMutation }
