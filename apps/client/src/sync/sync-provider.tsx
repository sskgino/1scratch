import { createContext, useContext, useEffect, useRef, useState } from 'react'
import {
  HLC, SyncLoop, HttpClient, DirtyTracker,
} from '@1scratch/sync-engine'
import { openSyncDb, type TauriSqliteStore } from './tauri-sqlite-store'
import { hydrateFromStore } from './hydrate'
import { migrateLegacyZustand } from './migrate-zustand'
import { apiBaseUrl, getAuthToken } from './auth-token'
import { useCardsStore } from '@1scratch/ui/store/cards'

interface SyncContextValue {
  outboxDepth: number
  lastError: string | null
  triggerNow(): Promise<void>
}

const SyncCtx = createContext<SyncContextValue | null>(null)

export function useSync(): SyncContextValue {
  const v = useContext(SyncCtx)
  if (!v) throw new Error('useSync must be used inside SyncProvider')
  return v
}

export function SyncProvider({ children, workspaceId }: { children: React.ReactNode; workspaceId: string }) {
  const [outboxDepth, setOutboxDepth] = useState(0)
  const [lastError, setLastError] = useState<string | null>(null)
  const loopRef = useRef<SyncLoop | null>(null)
  const storeRef = useRef<TauriSqliteStore | null>(null)

  useEffect(() => {
    let cancelled = false
    let dirty: DirtyTracker | null = null

    async function boot() {
      const store = await openSyncDb()
      if (cancelled) return
      storeRef.current = store

      let deviceId = await store.getMeta('deviceId')
      if (!deviceId) {
        deviceId = crypto.randomUUID()
        await store.setMeta('deviceId', deviceId)
      }

      await hydrateFromStore(store, workspaceId)

      const hlc = new HLC()
      await migrateLegacyZustand(store, workspaceId, hlc)

      const http = new HttpClient({ baseUrl: apiBaseUrl(), getAuthToken })
      const loop = new SyncLoop({
        store, http, deviceId, pollIntervalMs: 30_000,
        ownDeviceWorkspaceId: () => workspaceId,
        onError: (e) => setLastError(e.message),
        onConflicts: (entityType, ids) => {
          if (entityType !== 'card') return
          const mark = useCardsStore.getState().markConflict
          for (const id of ids) mark(id)
        },
      })
      loopRef.current = loop
      loop.start()

      dirty = new DirtyTracker({
        store, hlc,
        readEntity: async (et, id) => {
          if (et === 'card') {
            const c = useCardsStore.getState().cards[id]
            if (!c) return null
            const base = {
              canvasId: c.canvasId,
              x: c.x, y: c.y, width: c.width, height: c.height, zIndex: c.zIndex,
            }
            if (c.kind === 'prompt') {
              return {
                ...base,
                payload: {
                  kind: 'prompt' as const,
                  prompt: c.prompt, modelSlot: c.modelSlot, status: c.status,
                  response: c.response, model: c.model,
                  inputTokens: c.inputTokens, outputTokens: c.outputTokens,
                  errorMessage: c.errorMessage,
                },
              }
            }
            return {
              ...base,
              payload: {
                kind: 'image' as const,
                fullPath: c.fullPath, thumbPath: c.thumbPath,
                capturedAt: c.capturedAt, originDeviceId: c.originDeviceId,
                caption: c.caption,
              },
            }
          }
          return null
        },
      })
      dirty.start()

      // subscribe to card store: any change marks that id dirty
      const unsub = useCardsStore.subscribe((curr, prev) => {
        if (curr.cards === prev.cards) return
        for (const id of Object.keys(curr.cards)) {
          if (curr.cards[id] !== prev.cards[id]) dirty!.markDirty('card', id)
        }
        for (const id of Object.keys(prev.cards)) {
          if (!curr.cards[id]) dirty!.markDeleted('card', id)
        }
      })

      const depthTimer = setInterval(async () => {
        const [depth, pending] = await Promise.all([
          store.outboxDepth(),
          store.peekOutbox(500),
        ])
        setOutboxDepth(depth)
        const cardIds = pending.filter((m) => m.entityType === 'card').map((m) => m.entityId)
        const cs = useCardsStore.getState()
        cs.setOutboxCount(depth)
        cs.setPendingIds(cardIds)
      }, 1000)

      let kickTimer: ReturnType<typeof setTimeout> | null = null
      const kick = () => {
        if (kickTimer) return
        kickTimer = setTimeout(() => {
          kickTimer = null
          void loop.triggerNow().catch(() => {})
        }, 500)
      }
      const onOnline = () => kick()
      window.addEventListener('online', onOnline)
      let unlistenTauri: (() => void) | null = null
      if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
        const { listen } = await import('@tauri-apps/api/event')
        const off = await listen<{ online: boolean }>('network-change', (e) => { if (e.payload.online) kick() })
        unlistenTauri = off
      }

      return () => {
        unsub()
        clearInterval(depthTimer)
        if (kickTimer) clearTimeout(kickTimer)
        window.removeEventListener('online', onOnline)
        unlistenTauri?.()
      }
    }

    const cleanupPromise = boot().catch((e) => { setLastError(String(e)) })
    return () => {
      cancelled = true
      loopRef.current?.stop()
      dirty?.stop()
      cleanupPromise.then((c) => c?.())
    }
  }, [workspaceId])

  return (
    <SyncCtx.Provider value={{
      outboxDepth,
      lastError,
      triggerNow: async () => { await loopRef.current?.triggerNow() },
    }}>
      {children}
    </SyncCtx.Provider>
  )
}
