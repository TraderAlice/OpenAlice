import { useEffect, useState } from 'react'
import { barsApi } from '../../api/market'

/** Resolve display identity from the selected source, never a same-code vendor. */
export function useEastmoneyIdentity(source?: string) {
  const match = source?.match(/^eastmoney\|([01])\.(\d{6})$/)
  const code = match?.[2]
  const [resolved, setResolved] = useState<{ source: string; name?: string; error: boolean } | null>(null)
  useEffect(() => {
    if (!code || !source) return
    let cancelled = false
    barsApi.searchSources(code, 100).then(({ candidates }) => {
      const exact = candidates.find(candidate => candidate.barId === source)
      if (!cancelled) setResolved({ source, name: exact?.name, error: !exact?.name })
    }).catch(() => { if (!cancelled) setResolved({ source, error: true }) })
    return () => { cancelled = true }
  }, [code, source])
  if (!code) return null
  const current = resolved?.source === source ? resolved : null
  return { code, name: current?.name, market: match![1] === '1' ? 'SSE' : 'SZSE', loading: !current, error: current?.error ?? false }
}
