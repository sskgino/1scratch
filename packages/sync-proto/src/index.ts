// Sync protocol shared by client and server.
// Wire format for push/pull, plus the Hybrid Logical Clock used for versioning.
// Design: PLAN.md §4.

// ─── Hybrid Logical Clock ──────────────────────────────────────────────────
//
// Encodes (physical ms, logical counter) into a single bigint so ordering is
// a straight numeric comparison. Top 48 bits = ms since epoch; low 16 bits =
// logical counter that bumps on collisions within the same ms.

const LOGICAL_BITS = 16n
const LOGICAL_MASK = (1n << LOGICAL_BITS) - 1n

export class HLC {
  private lastPhysical = 0n
  private logical = 0n

  now(): bigint {
    const physical = BigInt(Date.now())
    if (physical > this.lastPhysical) {
      this.lastPhysical = physical
      this.logical = 0n
    } else {
      this.logical += 1n
      if (this.logical > LOGICAL_MASK) {
        // Counter overflow — step physical forward by 1ms.
        this.lastPhysical += 1n
        this.logical = 0n
      }
    }
    return (this.lastPhysical << LOGICAL_BITS) | this.logical
  }

  // Update state after observing a remote HLC value — keeps us ahead of peers.
  observe(remote: bigint): void {
    const remotePhysical = remote >> LOGICAL_BITS
    const remoteLogical = remote & LOGICAL_MASK
    const local = BigInt(Date.now())
    const newPhysical =
      local > remotePhysical && local > this.lastPhysical
        ? local
        : remotePhysical > this.lastPhysical
        ? remotePhysical
        : this.lastPhysical
    if (newPhysical === this.lastPhysical && newPhysical === remotePhysical) {
      this.logical = (this.logical > remoteLogical ? this.logical : remoteLogical) + 1n
    } else if (newPhysical === remotePhysical) {
      this.logical = remoteLogical + 1n
    } else if (newPhysical === this.lastPhysical) {
      this.logical += 1n
    } else {
      this.logical = 0n
    }
    this.lastPhysical = newPhysical
  }
}

export function decodeHLC(v: bigint): { physicalMs: bigint; logical: bigint } {
  return {
    physicalMs: v >> LOGICAL_BITS,
    logical: v & LOGICAL_MASK,
  }
}

// ─── Mutations ─────────────────────────────────────────────────────────────

export type EntityType = 'card' | 'canvas' | 'section'
export type MutationOp = 'upsert' | 'delete'

export interface Mutation {
  // Client-generated id for idempotency across retries.
  id: string
  entityType: EntityType
  entityId: string
  op: MutationOp
  // Minimal patch — empty object for deletes, partial field set for upserts.
  patch: Record<string, unknown>
  // HLC at the time the client created this mutation.
  clientVersion: string  // bigint serialized as decimal string over the wire
}

export interface RejectedMutation {
  id: string
  reason: 'stale' | 'forbidden' | 'invalid' | 'quota_exceeded'
  message?: string
}

// ─── Wire messages ─────────────────────────────────────────────────────────

export interface PushRequest {
  deviceId: string
  baseVersion: string           // last server version this device has seen
  mutations: Mutation[]
}

export interface PushResponse {
  accepted: string[]            // mutation ids
  rejected: RejectedMutation[]
  serverVersion: string
  // Server may include mutations from *other* devices that have committed
  // since baseVersion — saves a separate pull round-trip.
  additional: ServerMutation[]
}

export interface PullRequest {
  since: string                 // last server version seen
  limit?: number                // default 500
}

export interface PullResponse {
  mutations: ServerMutation[]
  serverVersion: string
  more: boolean
}

export interface ServerMutation {
  id: string                    // server-assigned (bigserial)
  entityType: EntityType
  entityId: string
  op: MutationOp
  patch: Record<string, unknown>
  version: string               // server-assigned HLC
  deviceId: string              // origin device (so a device can skip its own echoes)
  createdAt: string             // ISO-8601
}
