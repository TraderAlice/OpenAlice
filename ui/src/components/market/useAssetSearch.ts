import { useEffect, useState } from 'react'
import { barsApi, type BarSourceCandidate } from '../../api/market'

/** Defensive client boundary for older/custom backends: an unusable candidate
 * must never render as a button that silently does nothing, and duplicate
 * operational identities must never become duplicate React keys. */
export function normalizeAssetSearchCandidates(
  candidates: BarSourceCandidate[],
  limit: number,
): BarSourceCandidate[] {
  const seen = new Set<string>()
  const usable: BarSourceCandidate[] = []
  for (const candidate of candidates) {
    if (!candidate.symbol.trim() || !candidate.barId.trim() || seen.has(candidate.barId)) continue
    seen.add(candidate.barId)
    usable.push(candidate)
    if (usable.length >= limit) break
  }
  return usable
}

/**
 * The single source of truth for asset search — used by BOTH the market sidebar
 * and the main search box, so their logic can't drift apart again. Debounced
 * (300ms) federated source search: each result is a specific provider's K-line
 * (vendor or a connected broker), with the provider always explicit — never
 * merged. Pick a result → open the chart on exactly that source.
 */
export function useAssetSearch(query: string, limit = 24): { results: BarSourceCandidate[]; loading: boolean } {
  const [results, setResults] = useState<BarSourceCandidate[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const q = query.trim()
    if (!q) { setResults([]); setLoading(false); return }
    setLoading(true)
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const res = await barsApi.searchSources(q, limit)
        if (!cancelled) setResults(normalizeAssetSearchCandidates(res.candidates, limit))
      } catch (e) {
        console.error('asset search failed', e)
        if (!cancelled) setResults([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, limit])

  return { results, loading }
}
