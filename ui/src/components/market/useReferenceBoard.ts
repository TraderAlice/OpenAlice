import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The one fetch-and-poll hook for board-shaped data — replaces the
 * hand-rolled useState×4 + useEffect + setInterval block every board view
 * used to copy. Polling (not SSE) per the low-frequency-surface rule.
 */
export function useReferenceBoard<T>(
  fetcher: () => Promise<T>,
  refreshMs: number,
  options: { slowMs?: number } = {},
) {
  const [data, setData] = useState<T | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [slow, setSlow] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dataRef = useRef<T | null>(null)
  const aliveRef = useRef(true)
  const slowMs = options.slowMs ?? 5_000

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    let slowTimer: ReturnType<typeof setTimeout> | null = null
    if (dataRef.current == null) {
      setSlow(false)
      slowTimer = setTimeout(() => {
        if (aliveRef.current && dataRef.current == null) setSlow(true)
      }, slowMs)
    }
    try {
      const res = await fetcher()
      if (!aliveRef.current) return
      dataRef.current = res
      setData(res)
      setUpdatedAt(new Date())
      setError(null)
    } catch (err) {
      if (!aliveRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      if (slowTimer) clearTimeout(slowTimer)
      if (aliveRef.current) {
        setLoading(false)
        setSlow(false)
      }
    }
  }, [fetcher, slowMs])

  useEffect(() => {
    aliveRef.current = true
    load()
    const timer = setInterval(load, refreshMs)
    return () => {
      aliveRef.current = false
      clearInterval(timer)
    }
  }, [load, refreshMs])

  return { data, updatedAt, loading, slow, error, retry: load }
}
