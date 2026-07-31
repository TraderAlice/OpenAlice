import { api } from '../api'
import type { EntityListItem } from '../api/entities'
import { createLiveStore } from './createLiveStore'
import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('live/entities')

/**
 * Live tracked-entity feed. 20s polling against `/api/entities`. Same
 * rationale as the inbox live store — a passive, low-frequency feed where
 * SSE isn't worth the kept-open connection. One shared timer via the
 * LiveStore refcount; sidebar + page subscribe to the same store.
 */

export interface EntitiesState {
  entities: EntityListItem[]
  /** True until the initial list fetch resolves. */
  loading: boolean
  /** The latest list request failed. Existing entities remain usable as stale data. */
  error: string | null
  /** An initial, scheduled, or user-requested refresh is currently in flight. */
  refreshing: boolean
}

const POLL_INTERVAL_MS = 20_000

let triggerRefresh: (() => void) | null = null

export const entitiesLive = createLiveStore<EntitiesState>({
  name: 'entities',
  initialState: { entities: [], loading: true, error: null, refreshing: false },
  subscribe: ({ apply }) => {
    let disposed = false

    async function refresh() {
      apply((prev) => ({ ...prev, refreshing: true }))
      try {
        const { entities } = await api.entities.list()
        if (disposed) return
        apply((prev) => ({
          ...prev,
          entities,
          loading: false,
          error: null,
          refreshing: false,
        }))
      } catch (error) {
        if (disposed) return
        apply((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : 'Tracked entities are unavailable.',
          refreshing: false,
        }))
      }
    }

    triggerRefresh = refresh
    void refresh()
    const intervalId = setInterval(refresh, POLL_INTERVAL_MS)

    return () => {
      disposed = true
      clearInterval(intervalId)
      triggerRefresh = null
    }
  },
})

/** Force an immediate refresh from /api/entities. */
export function refreshEntities(): void {
  triggerRefresh?.()
}
