import { useCallback, useEffect, useState } from 'react'
import { barsApi, type BarMeta, type HistoricalBar } from '../api/market'

type Query = Parameters<typeof barsApi.bars>[0]
/** Exact-source history lifecycle shared by full-page and embedded charts. */
export function useMarketBars(query: Query | null) {
  const signature = JSON.stringify(query)
  const [bars, setBars] = useState<HistoricalBar[] | null>(null)
  const [meta, setMeta] = useState<BarMeta | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const retry = useCallback(() => setRevision(n => n + 1), [])
  useEffect(() => {
    const params = JSON.parse(signature) as Query | null
    setBars(null); setMeta(null); setError(null); setLoading(!!params)
    if (!params) return
    let cancelled = false
    async function run(initial: boolean) {
      try {
        const response = await barsApi.bars(params!)
        if (cancelled) return
        if (response.error || !response.results?.length) {
          setError(response.error ?? 'No bars in this range.'); setBars(null); setMeta(response.meta)
        } else {
          setBars(response.results); setMeta(response.meta); setError(null)
        }
      } catch (e) {
        if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setBars(null); setMeta(null) }
      } finally { if (!cancelled && initial) setLoading(false) }
    }
    void run(true)
    const timer = setInterval(() => void run(false), /[mh]$/.test(params.interval) ? 60_000 : 300_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [signature, revision])
  return { bars, meta, loading, error, retry }
}
