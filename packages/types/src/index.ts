// Shared types between client (apps/client) and server (apps/web).
// Mirrors the Postgres schema in PLAN.md §3 — keep in sync if the schema changes.

export type Tier = 'free' | 'pro'

export interface User {
  id: string
  email: string
  displayName: string | null
  tier: Tier
  dailyAiCapCents: number
}

export interface Workspace {
  id: string
  ownerId: string
  name: string
}

export interface Section {
  id: string
  workspaceId: string
  name: string
  color: string | null
  position: number
  permanent: boolean
}

export interface Viewport {
  panX: number
  panY: number
  zoom: number
}

export interface Canvas {
  id: string
  workspaceId: string
  sectionId: string
  name: string
  color: string | null
  viewport: Viewport
  position: number
  version: bigint
}

export type CardStatus = 'idle' | 'streaming' | 'complete' | 'error'

export interface CardPayload {
  prompt: string
  modelSlot: string
  status: CardStatus
  errorMessage?: string
  response: string
  model: string
  inputTokens?: number
  outputTokens?: number
}

export interface Card {
  id: string
  workspaceId: string
  canvasId: string
  type: 'card'
  x: number
  y: number
  width: number
  height: number
  zIndex: number
  payload: CardPayload
  version: bigint
  deletedAt: string | null
}

// Provider connections (encrypted credentials live server-side).
export type ProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'mistral'
  | 'cohere'
  | 'groq'
  | 'xai'
  | 'vercel-gateway'
  | 'ollama'

export type ProviderKind = 'api_key' | 'oauth'

export type ProviderStatus = 'unverified' | 'connected' | 'invalid' | 'revoked'

// Public-safe shape — never includes ciphertext.
export interface ProviderConnectionPublic {
  id: string
  provider: ProviderId
  kind: ProviderKind
  label: string | null
  status: ProviderStatus
  lastVerifiedAt: string | null
  endpointUrl?: string
}

export interface ModelSlot {
  slot: number              // 0–9
  providerConnectionId: string | null
  modelId: string | null
  displayLabel: string | null
}
