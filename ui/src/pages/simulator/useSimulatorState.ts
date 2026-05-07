/**
 * useSimulatorState — owns the polled simulator state + event log + the
 * `run(label, fn)` wrapper that every action button funnels through.
 *
 * Centralizing here keeps the page-level component declarative (just
 * layout + composition) and means every action automatically lands in
 * the event log and the state refresh path. Adding a new control surface
 * (Place Order, Set Stop Loss, …) only needs to call `run`; logging and
 * refresh are free.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useToast } from '../../components/Toast'
import {
  simulatorApi,
  type SimulatorState,
  type SimulatorUTAEntry,
} from '../../api/simulator'

const POLL_INTERVAL_MS = 3000
const MAX_EVENTS = 50

export interface SimulatorEvent {
  id: number
  ts: number
  label: string
  status: 'ok' | 'err'
  detail?: string
}

export interface UseSimulatorStateResult {
  utas: SimulatorUTAEntry[]
  selectedId: string
  setSelectedId: (id: string) => void
  state: SimulatorState | null
  loading: boolean
  events: SimulatorEvent[]

  /** Reload UTA list. Returns the new list. */
  refreshUtaList: () => Promise<SimulatorUTAEntry[]>
  /** Force-refresh selected UTA's state. */
  refresh: () => Promise<void>
  /**
   * Run an action with toast + log + state refresh. Use as the single
   * entry point for every mutating UI button so auditability is uniform.
   */
  run: (label: string, fn: () => Promise<unknown>, opts?: { skipRefresh?: boolean }) => Promise<void>
}

export function useSimulatorState(): UseSimulatorStateResult {
  const [utas, setUtas] = useState<SimulatorUTAEntry[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [state, setState] = useState<SimulatorState | null>(null)
  const [loading, setLoading] = useState(false)
  const [events, setEvents] = useState<SimulatorEvent[]>([])
  const toast = useToast()
  const eventCounter = useRef(0)

  const appendEvent = useCallback((ev: Omit<SimulatorEvent, 'id'>) => {
    setEvents((prev) => {
      const id = ++eventCounter.current
      const next = [{ ...ev, id }, ...prev]
      return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next
    })
  }, [])

  const refreshUtaList = useCallback(async () => {
    try {
      const r = await simulatorApi.listUtas()
      setUtas(r.utas)
      setSelectedId((cur) => {
        if (cur && r.utas.some((u) => u.id === cur)) return cur
        return r.utas[0]?.id ?? ''
      })
      return r.utas
    } catch (err) {
      toast.error(`Failed to list simulators: ${err instanceof Error ? err.message : err}`)
      return []
    }
  }, [toast])

  const refresh = useCallback(async () => {
    if (!selectedId) {
      setState(null)
      return
    }
    try {
      const s = await simulatorApi.state(selectedId)
      setState(s)
    } catch (err) {
      toast.error(`State fetch failed: ${err instanceof Error ? err.message : err}`)
      setState(null)
    }
  }, [selectedId, toast])

  // Bootstrap UTA list once.
  useEffect(() => {
    refreshUtaList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refresh on selection change + poll.
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [refresh])

  const run = useCallback(async (
    label: string,
    fn: () => Promise<unknown>,
    opts: { skipRefresh?: boolean } = {},
  ) => {
    if (!selectedId) return
    setLoading(true)
    try {
      await fn()
      appendEvent({ ts: Date.now(), label, status: 'ok' })
      toast.success(label)
      if (!opts.skipRefresh) await refresh()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      appendEvent({ ts: Date.now(), label, status: 'err', detail })
      toast.error(`${label} failed: ${detail}`)
    } finally {
      setLoading(false)
    }
  }, [selectedId, appendEvent, refresh, toast])

  return {
    utas, selectedId, setSelectedId,
    state, loading, events,
    refreshUtaList, refresh, run,
  }
}
