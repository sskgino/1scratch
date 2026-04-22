import type { z } from 'zod'

export type ScopeKind = 'user' | 'workspace' | 'section' | 'canvas'
export type SourceKind =
  | 'card_pair'
  | 'note'
  | 'canvas_snapshot'
  | 'section_snapshot'
  | (string & {})
export type Tier = 'short' | 'long'

export interface ScopeRef {
  kind: ScopeKind
  refId: string | null
}

export interface MemoryItem {
  id: string
  userId: string
  scope: ScopeRef
  sourceKind: SourceKind
  sourceRefId: string | null
  text: string
  tags: string[]
  metadata: Record<string, unknown>
  tier: Tier
  expiresAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type MemoryItemDraft = Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'>

export interface IngestEvent {
  userId: string
  scope: ScopeRef
  trigger:
    | 'card_completed'
    | 'card_saved'
    | 'canvas_saved'
    | 'section_saved'
    | 'note_added'
    | (string & {})
  payload: unknown
}

export interface RetrievalContext {
  userId: string
  currentScope: ScopeRef
  queryText: string
  queryEmbedding?: Float32Array
  filter: {
    tags?: string[]
    sourceKinds?: SourceKind[]
    strategies?: string[]
    excludeItemIds?: string[]
  }
  budget: { topK: number; tokenBudget: number }
}

export interface ScoredItem {
  item: MemoryItem
  score: number
  strategy: string
  rationale?: string
}

export type InjectFormat = 'system-message' | 'user-xml-block'

export interface InjectionPolicy {
  format: InjectFormat
  topK: number
  tokenBudget: number
}

export interface InjectedMemory {
  format: InjectFormat
  content: string
  itemIds: string[]
}

export interface DbClient {
  query: <T>(strings: TemplateStringsArray, ...values: unknown[]) => Promise<T[]>
  withTx: <T>(fn: (tx: DbClient) => Promise<T>) => Promise<T>
}

export interface EmbedClient {
  readonly providerId: 'gateway' | 'byok' | 'local'
  readonly modelId: string
  readonly dim: number
  embed(text: string[]): Promise<Float32Array[]>
}

export interface LlmClient {
  summarize(texts: string[], opts?: { maxTokens?: number }): Promise<string>
}

export interface Logger {
  info: (event: string, data?: Record<string, unknown>) => void
  warn: (event: string, data?: Record<string, unknown>) => void
  error: (event: string, data?: Record<string, unknown>) => void
}

export interface StrategyCtx {
  db: DbClient
  embed: EmbedClient
  llm?: LlmClient
  logger: Logger
}

export interface Ingestor {
  triggers: readonly string[]
  produce(event: IngestEvent, ctx: StrategyCtx): Promise<MemoryItemDraft[]>
}

export interface Retriever {
  retrieve(ctx: RetrievalContext, strategyCtx: StrategyCtx): Promise<ScoredItem[]>
}

export interface MemoryStrategy {
  id: string
  version: string
  ingestors: Ingestor[]
  retrievers: Retriever[]
  configSchema: z.ZodType
  defaults: { enabled: boolean; weight: number; params: Record<string, unknown> }
}

export class QuotaError extends Error {
  constructor(public readonly which: 'not_pro' | 'item_cap' | 'byte_cap') {
    super(`memory_quota_exceeded:${which}`)
  }
}

export class LocalEmbedRequired extends Error {
  constructor() {
    super('local_embed_required')
  }
}
