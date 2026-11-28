import { useCallback, useEffect, useRef, useState } from 'react'

import {
  api,
  type DispatchBoardSnapshot as ApiDispatchBoardSnapshot,
  type DispatchEdge as ApiDispatchEdge,
  type DispatchLane as ApiDispatchLane,
  type DispatchTemplateKind as ApiDispatchTemplateKind,
} from '../../api'
import { resourceCache } from '../../lib/resource-cache'

export const COMMANDER_LANE_ID = 'commander'

export type DispatchTemplateKind = ApiDispatchTemplateKind | 'commander'

export interface DispatchLane extends Omit<ApiDispatchLane, 'templateKind'> {
  templateKind: DispatchTemplateKind
}

export interface DispatchEdge extends ApiDispatchEdge {
  messageKind?: 'scheduled_report'
}

export interface DispatchBoardSnapshot extends Omit<ApiDispatchBoardSnapshot, 'lanes' | 'edges'> {
  lanes: readonly DispatchLane[]
  edges: readonly DispatchEdge[]
}

export type DispatchWindowPreset = '1h' | '6h' | '24h'

const PRESET_MS: Record<DispatchWindowPreset, number> = {
  '1h': 60 * 60_000,
  '6h': 6 * 60 * 60_000,
  '24h': 24 * 60 * 60_000,
}

const POLL_MS = 4_000
const PREFETCH_STALE_MS = 15_000

export function dispatchSnapshotCacheKey(preset: DispatchWindowPreset): string {
  return `dispatch:live:${preset}`
}

/**
 * Low-priority background warm-up for the Dispatch board default window.
 * Seeds `resourceCache` so switching to the Dispatch tab paints immediately
 * while live polling catches up.
 */
export function prefetchDispatchSnapshot(preset: DispatchWindowPreset = '1h'): Promise<DispatchBoardSnapshot> {
  return resourceCache.fetch<DispatchBoardSnapshot>(
    dispatchSnapshotCacheKey(preset),
    async ({ priority }) => {
      const to = Date.now()
      const from = to - PRESET_MS[preset]
      return api.dispatch.get({ from, to, priority })
    },
    { priority: 'low', staleTimeMs: PREFETCH_STALE_MS },
  )
}

export interface UseDispatchBoardResult {
  snapshot: DispatchBoardSnapshot | null
  loading: boolean
  error: string | null
  preset: DispatchWindowPreset
  live: boolean
  fromMs: number
  toMs: number
  setPreset: (preset: DispatchWindowPreset) => void
  setLive: (live: boolean) => void
  stepWindow: (direction: -1 | 1) => void
  refresh: () => Promise<void>
}

export function useDispatchBoard(enabled: boolean): UseDispatchBoardResult {
  const [preset, setPresetState] = useState<DispatchWindowPreset>('1h')
  const [live, setLiveState] = useState(true)
  const [anchorEndMs, setAnchorEndMs] = useState<number>(() => Date.now())
  const [snapshot, setSnapshot] = useState<DispatchBoardSnapshot | null>(
    () => resourceCache.peek<DispatchBoardSnapshot>(dispatchSnapshotCacheKey('1h')) ?? null,
  )
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeqRef = useRef(0)

  const durationMs = PRESET_MS[preset]
  const toMs = live ? anchorEndMs : anchorEndMs
  const fromMs = toMs - durationMs

  const fetchWindow = useCallback(async (
    from: number,
    to: number,
    initial = false,
    cachePreset?: DispatchWindowPreset,
  ) => {
    const seq = ++requestSeqRef.current
    if (initial) setLoading(true)
    try {
      const next = await api.dispatch.get({ from, to })
      if (seq !== requestSeqRef.current) return
      if (cachePreset) {
        resourceCache.set(dispatchSnapshotCacheKey(cachePreset), next)
      }
      setSnapshot(next)
      setError(null)
    } catch (err) {
      if (seq !== requestSeqRef.current) return
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (seq === requestSeqRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const cached = live ? resourceCache.peek<DispatchBoardSnapshot>(dispatchSnapshotCacheKey(preset)) : undefined
    if (cached) {
      setSnapshot(cached)
    }
    const end = live ? Date.now() : anchorEndMs
    if (live) setAnchorEndMs(end)
    void fetchWindow(end - durationMs, end, !cached && snapshot === null, live ? preset : undefined)
  }, [enabled, preset, live, durationMs]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled || live) return
    void fetchWindow(anchorEndMs - durationMs, anchorEndMs, false)
  }, [enabled, live, anchorEndMs, durationMs, fetchWindow])

  useEffect(() => {
    if (!enabled || !live) return
    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const now = Date.now()
      setAnchorEndMs(now)
      void fetchWindow(now - durationMs, now, false, preset)
    }
    const timer = window.setInterval(tick, POLL_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [enabled, live, durationMs, preset, fetchWindow])

  const setPreset = useCallback((next: DispatchWindowPreset) => {
    setPresetState(next)
    if (live) {
      const cached = resourceCache.peek<DispatchBoardSnapshot>(dispatchSnapshotCacheKey(next))
      if (cached) setSnapshot(cached)
      setAnchorEndMs(Date.now())
    }
  }, [live])

  const setLive = useCallback((nextLive: boolean) => {
    setLiveState(nextLive)
    if (nextLive) {
      setAnchorEndMs(Date.now())
    }
  }, [])

  const stepWindow = useCallback((direction: -1 | 1) => {
    const stepMs = Math.round(durationMs * 0.5)
    const now = Date.now()
    if (direction === -1) {
      setLiveState(false)
      setAnchorEndMs((prev) => Math.max(durationMs, prev - stepMs))
      return
    }
    setAnchorEndMs((prev) => {
      const next = prev + stepMs
      if (next >= now - 1_000) {
        setLiveState(true)
        return now
      }
      return next
    })
  }, [durationMs])

  const refresh = useCallback(async () => {
    const end = live ? Date.now() : anchorEndMs
    if (live) setAnchorEndMs(end)
    await fetchWindow(end - durationMs, end, false, live ? preset : undefined)
  }, [live, anchorEndMs, durationMs, preset, fetchWindow])

  return {
    snapshot,
    loading,
    error,
    preset,
    live,
    fromMs,
    toMs,
    setPreset,
    setLive,
    stepWindow,
    refresh,
  }
}
