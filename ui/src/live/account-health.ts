import { api } from '../api'
import type { BrokerHealthInfo } from '../api/types'
import { createLiveStore } from './createLiveStore'
import { connectSSE } from './connectSSE'

/**
 * Live broker-health map: accountId → BrokerHealthInfo.
 *
 * First LiveStore consumer. Replaces the previous per-page `useSSE` that
 * opened a fresh EventSource for each of TradingPage / PortfolioPage /
 * UTADetailPage — three components mounted concurrently used to mean
 * three connections to the same `/api/events/stream`. Now there's one,
 * shared across all subscribers, and it tears down when nothing's
 * watching.
 */

type State = Record<string, BrokerHealthInfo>

interface HealthEvent {
  type?: string
  payload?: { accountId?: string } & Partial<BrokerHealthInfo>
}

export const accountHealthLive = createLiveStore<State>({
  name: 'account-health',
  initialState: {},
  subscribe: ({ apply }) => {
    // Initial snapshot — the SSE stream only emits diffs going forward,
    // so we still need a one-shot fetch to populate steady state.
    api.trading.listUTASummaries().then(({ utas }) => {
      const map: State = {}
      for (const u of utas) map[u.id] = u.health
      apply(() => map)
    }).catch(() => {
      /* surface via ignored network errors — not worth a notification */
    })

    // Live diffs.
    return connectSSE<HealthEvent>('/api/events/stream', (entry) => {
      if (entry.type !== 'account.health' || !entry.payload?.accountId) return
      const { accountId, ...health } = entry.payload
      apply((prev) => ({ ...prev, [accountId]: health as BrokerHealthInfo }))
    })
  },
})
