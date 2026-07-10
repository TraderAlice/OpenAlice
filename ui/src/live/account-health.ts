import { api } from '../api'
import type { BrokerHealthInfo } from '../api/types'
import { createLiveStore } from './createLiveStore'
import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('live/account-health')

/**
 * Live broker-health map: accountId → BrokerHealthInfo.
 *
 * Shared by TradingPage, PortfolioPage, and UTADetailPage. Health lives in the
 * separate UTA process, so Alice refreshes the authoritative UTA summaries
 * instead of pretending its retired event stream carries UTA-local records.
 */

type State = Record<string, BrokerHealthInfo>

export const accountHealthLive = createLiveStore<State>({
  name: 'account-health',
  initialState: {},
  subscribe: ({ apply }) => {
    let disposed = false
    let refreshing = false
    const refresh = () => {
      if (refreshing) return
      refreshing = true
      api.trading.listUTASummaries().then(({ utas }) => {
        if (disposed) return
        const map: State = {}
        for (const u of utas) map[u.id] = u.health
        apply(map)
      }).catch(() => {
        /* A transient UTA outage should preserve the last known snapshot. */
      }).finally(() => {
        refreshing = false
      })
    }

    refresh()
    const timer = setInterval(refresh, 5_000)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  },
  staleAfterMs: 15_000,
})
