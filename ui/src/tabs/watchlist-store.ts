import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ViewSpec } from './types'
import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('tabs/watchlist-store')

type AssetClass = Extract<ViewSpec, { kind: 'market-detail' }>['params']['assetClass']

export interface WatchlistEntry {
  assetClass: AssetClass
  symbol: string
  /** ms since epoch — used for sort order. Newest pinned first. */
  addedAt: number
}

interface WatchlistState {
  entries: WatchlistEntry[]
}

interface WatchlistActions {
  add: (assetClass: AssetClass, symbol: string) => void
  remove: (assetClass: AssetClass, symbol: string) => void
  has: (assetClass: AssetClass, symbol: string) => boolean
}

/**
 * Pinned market assets the user wants quick access to. Persisted in
 * localStorage. Phase-2 minimal — just an unordered list, no folders or
 * tags. Sort is newest-first so freshly pinned assets jump to the top.
 *
 * Backed by `openalice.watchlist.v1`. Phase 3+ may sync to the backend
 * once the persistence story for personal config solidifies.
 */
export const useWatchlist = create<WatchlistState & WatchlistActions>()(
  persist(
    (set, get) => ({
      entries: [],
      add: (assetClass, symbol) => {
        set((state) => {
          if (state.entries.some((e) => e.assetClass === assetClass && e.symbol === symbol)) {
            return state
          }
          return {
            entries: [{ assetClass, symbol, addedAt: Date.now() }, ...state.entries],
          }
        })
      },
      remove: (assetClass, symbol) => {
        set((state) => ({
          entries: state.entries.filter((e) => !(e.assetClass === assetClass && e.symbol === symbol)),
        }))
      },
      has: (assetClass, symbol) =>
        get().entries.some((e) => e.assetClass === assetClass && e.symbol === symbol),
    }),
    {
      name: 'openalice.watchlist.v1',
      version: 1,
    },
  ),
)
