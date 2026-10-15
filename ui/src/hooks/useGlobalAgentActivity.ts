import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api'
import type { AgentRuntimeCause, AgentRuntimeEvent } from '../api/agentRuntimeLog'

import { GLOBAL_ACTIVITY_REFRESH_EVENT, projectGlobalActivity, summarizeAgentActivity, globalActivityFilters } from '../../../apps/desktop/src/activity-projection'
export * from '../../../apps/desktop/src/activity-projection'
import type { GlobalAgentActivityData, AgentActivitySignal } from '../../../apps/desktop/src/activity-projection'
const POLL_MS = 4_000
const INITIAL_EVENT_LIMIT = 100
const EVENT_CACHE_LIMIT = 500

/**
 * Global projection of significant cross-Agent scheduling and delivery facts.
 * Office owns the complete runtime state machine; this hook intentionally
 * exposes only signals selected by the registered high-level filters.
 */
export function useGlobalAgentActivity(): GlobalAgentActivityData {
  const [desktopSignals, setDesktopSignals] = useState<AgentActivitySignal[]>([])
  const [runtimeEvents, setRuntimeEvents] = useState<AgentRuntimeEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const cursorRef = useRef(0)
  const initializedRef = useRef(false)

  const refresh = useCallback(async () => {
    if (window.openAlice?.companion?.activity) { setDesktopSignals(await window.openAlice.companion.activity.getSignals()); return }
    const activityApi = api.productActivity ?? api.agentRuntime
    const runtimeRequest = initializedRef.current
      ? activityApi.query({ afterSeq: cursorRef.current, limit: INITIAL_EVENT_LIMIT })
      : activityApi.query({ page: 1, pageSize: INITIAL_EVENT_LIMIT })
    const runtimeResult = await runtimeRequest.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason) => ({ status: 'rejected' as const, reason }),
    )

    const errors: string[] = []
    if (runtimeResult.status === 'fulfilled') {
      const incoming = [...runtimeResult.value.entries].sort((a, b) => a.seq - b.seq)
      setRuntimeEvents((current) => {
        const bySeq = new Map(current.map((event) => [event.seq, event]))
        for (const event of incoming) bySeq.set(event.seq, event)
        return [...bySeq.values()].sort((a, b) => a.seq - b.seq).slice(-EVENT_CACHE_LIMIT)
      })
      cursorRef.current = Math.max(
        cursorRef.current,
        runtimeResult.value.lastSeq,
        ...incoming.map((event) => event.seq),
      )
      initializedRef.current = true
    } else {
      errors.push(runtimeResult.reason instanceof Error
        ? runtimeResult.reason.message
        : String(runtimeResult.reason))
    }

    setNow(Date.now())
    setError(errors.length > 0 ? errors.join('; ') : null)
    setLoading(false)
  }, [])

  useEffect(() => {
    const bridge = window.openAlice?.companion?.activity
    if (bridge) {
      let active = true, changed = false
      const off = bridge.onSignals(signals => { changed = true; if (active) setDesktopSignals(signals) })
      void bridge.getSignals().then(signals => { if (active && !changed) setDesktopSignals(signals) }).catch(() => {})
      setLoading(false)
      return () => { active = false; off() }
    }
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    const refreshFromActivity = () => void refresh()
    window.addEventListener(GLOBAL_ACTIVITY_REFRESH_EVENT, refreshFromActivity)
    return () => {
      window.clearInterval(id)
      window.removeEventListener(GLOBAL_ACTIVITY_REFRESH_EVENT, refreshFromActivity)
    }
  }, [refresh])

  const browserSignals = useMemo(() => projectGlobalActivity(
    { runtimeEvents },
    now,
    globalActivityFilters,
  ), [now, runtimeEvents])
  const signals = window.openAlice?.companion?.activity ? desktopSignals : browserSignals
  const summary = useMemo(() => summarizeAgentActivity(signals), [signals])

  return { signals, summary, loading, error, refresh }
}
