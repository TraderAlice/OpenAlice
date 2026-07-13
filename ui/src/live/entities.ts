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
}

const POLL_INTERVAL_MS = 20_000

let triggerRefresh: (() => void) | null = null

export const entitiesLive = createLiveStore<EntitiesState>({
  name: 'entities',
  initialState: { entities: [], loading: true },
  subscribe: ({ apply }) => {
    let disposed = false

    async function refresh() {
      try {
        const { entities } = await api.entities.list()
        if (disposed) return
        apply((prev) => ({ ...prev, entities, loading: false }))
      } catch {
        if (disposed) return
        apply((prev) => ({ ...prev, loading: false }))
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
