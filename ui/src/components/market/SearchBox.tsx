import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { type BarSourceCandidate, type AssetClass } from '../../api/market'
import { useAssetSearch } from './useAssetSearch'

const ASSET_CLASS_COLORS: Record<string, string> = {
  equity: 'bg-primary/15 text-primary',
  crypto: 'bg-warning/15 text-warning',
  currency: 'bg-success/15 text-success',
  commodity: 'bg-ai-action/15 text-ai-action',
  unknown: 'bg-muted text-muted-foreground',
}

const CAPABILITY_COLOR: Record<string, string> = {
  realtime: 'text-success',
  iex: 'text-primary',
  delayed: 'text-muted-foreground',
  subscription: 'text-warning',
  free: 'text-muted-foreground',
}

export function SearchBox() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  // Shared with the market sidebar — one federated search logic, no drift.
  const { results, loading } = useAssetSearch(query)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setHighlight(0) }, [results])

  useEffect(() => {
    const onClickAway = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [])

  const handleSelect = (r: BarSourceCandidate) => {
    if (!r.symbol) return
    setOpen(false)
    setQuery('')
    // Carry the chosen source (barId) so the chart opens on THAT provider, and
    // preserve interval/range across switches.
    const next = new URLSearchParams(searchParams)
    next.set('source', r.barId)
    const assetClass: AssetClass = r.assetClass === 'unknown' ? 'equity' : r.assetClass
    navigate({
      pathname: `/market/${assetClass}/${encodeURIComponent(r.symbol)}`,
      search: `?${next.toString()}`,
    })
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlight((h) => Math.min(h + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(h - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      handleSelect(results[highlight])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-[14px] leading-5 outline-none placeholder:text-muted-foreground/50 focus:border-primary focus:ring-2 focus:ring-primary/20"
        placeholder={t('market.searchInputPlaceholder')}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {open && query.trim() && (
        <div className="absolute z-20 mt-1 max-h-[360px] w-full overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-md">
          {loading && results.length === 0 && (
            <div className="px-3 py-2 text-[13px] text-muted-foreground">{t('market.searching')}</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-[13px] text-muted-foreground">{t('market.noMatches')}</div>
          )}
          {results.map((r, i) => (
            <button
              key={r.barId}
              onClick={() => handleSelect(r)}
              onMouseEnter={() => setHighlight(i)}
              className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-[13px] leading-[18px] ${
                i === highlight ? 'bg-muted' : ''
              }`}
            >
              <span className="font-mono font-semibold text-foreground shrink-0">{r.symbol}</span>
              {r.name && (
                <span className="text-muted-foreground truncate flex-1 min-w-0">— {r.name}</span>
              )}
              {/* Explicit provider — this is how same-symbol sources are disambiguated. */}
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] leading-[15px] text-muted-foreground">
                <span className="font-medium text-foreground/80">{r.sourceId}</span>
                {r.barCapability && (
                  <span className={CAPABILITY_COLOR[r.barCapability] ?? 'text-muted-foreground'}>{r.barCapability}</span>
                )}
              </span>
              <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] leading-[14px] font-medium ${ASSET_CLASS_COLORS[r.assetClass] ?? ASSET_CLASS_COLORS.unknown}`}>
                {r.assetClass}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
