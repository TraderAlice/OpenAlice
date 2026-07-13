import { api } from '../api'
import { createLiveStore } from './createLiveStore'
import { reloadOnHotUpdate } from '../lib/hmr'
import { filterAccountTierUTAs } from '../lib/uta-account-filter'

reloadOnHotUpdate('live/trading-push')

/**
 * Live count of staged-but-unpushed trading operations, for the
 * Trading-as-Git activity-bar badge. Mirrors the Inbox unread badge:
 * pending pushes are an attention state the user must be reminded of,
 * otherwise a staged order sits forgotten because nothing surfaces it
 * outside the Trading-as-Git panel.
 *
 * Polls `listUTAs` + per-account `walletStatus` (the same data the
 * PushApprovalPanel reads, summed). 15s cadence: this is a passive
 * reminder, not the live panel — the panel itself polls faster (3s)
 * while it's open. Single shared timer via the LiveStore refcount, so
 * the always-mounted ActivityBar carries one background poll regardless
 * of how many subscribers read the count.
 *
 * Zero trading accounts → zero `walletStatus` calls (listUTAs returns
 * empty), so the badge is free for users who haven't configured a broker.
 */

export interface TradingPushState {
  /** Total staged operations across every account, awaiting push. */
  stagedCount: number
}

const POLL_INTERVAL_MS = 15_000

export const tradingPushLive = createLiveStore<TradingPushState>({
  name: 'trading-push',
  initialState: { stagedCount: 0 },
  subscribe: ({ apply }) => {
    let disposed = false

    async function refresh() {
      try {
        const { utas } = await api.trading.listUTASummaries()
        if (disposed) return
        const accounts = filterAccountTierUTAs(utas)
        if (accounts.length === 0) {
          apply({ stagedCount: 0 })
          return
        }
        const statuses = await Promise.all(
          accounts.map((a) =>
            api.trading.walletStatus(a.id).catch(() => null),
          ),
        )
        if (disposed) return
        const stagedCount = statuses.reduce(
          (n, s) => n + (s?.staged.length ?? 0),
          0,
        )
        apply({ stagedCount })
      } catch {
        // Leave the last good count in place on a transient failure; the
        // panel surfaces real errors. A flickering badge is worse than a
        // slightly stale one.
      }
    }

    void refresh()
    const intervalId = setInterval(refresh, POLL_INTERVAL_MS)

    return () => {
      disposed = true
      clearInterval(intervalId)
    }
  },
})

/** Activity-bar badge count: staged operations awaiting push. */
export function usePendingPushCount(): number {
  return tradingPushLive.useStore((s) => s.stagedCount)
}
