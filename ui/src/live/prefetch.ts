/**
 * Global low-priority resource warm-up mounted once at the application shell.
 *
 * Waits until the initial shell settles, then enqueues background warm-ups
 * through `prefetchScheduler` (concurrency <= 2, yields to user clicks and
 * pauses while hidden) for high-frequency navigation targets:
 *   - Issues snapshot (`/api/issues`)
 *   - Dispatch default 1h live snapshot (`/api/dispatch`)
 *
 * Inbox's own Stage 1 (20) -> Stage 2 (100) + top-5 detail warm-up is driven
 * directly by `inboxLive` once Stage 1 settles.
 */
import { useEffect } from 'react'

import { prefetchDispatchSnapshot } from '../components/dispatch/useDispatchBoard'
import { prefetchIssuesSnapshot } from '../hooks/useIssues'

const INITIAL_WARMUP_DELAY_MS = 1_500

export function useGlobalResourcePrefetch(): void {
  useEffect(() => {
    let cancelled = false
    let idleId: number | null = null
    const run = () => {
      if (cancelled) return
      void prefetchIssuesSnapshot().catch(() => {})
      void prefetchDispatchSnapshot('1h').catch(() => {})
    }

    // Let initial route hydration (e.g. Inbox Stage 1 -> Stage 2) finish
    // uncontested before warming secondary tabs in the background.
    const timer = window.setTimeout(() => {
      if (cancelled) return
      if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(run, { timeout: 1_500 })
      } else {
        run()
      }
    }, INITIAL_WARMUP_DELAY_MS)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      if (idleId !== null && typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function') {
        window.cancelIdleCallback(idleId)
      }
    }
  }, [])
}
