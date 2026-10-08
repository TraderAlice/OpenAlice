import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { type BarSourceCandidate, type AssetClass } from '../../api/market'
import { useAssetSearch } from './useAssetSearch'
import { inputClass } from '../form'

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
  const listId = useId()
  // Shared with the market sidebar — one federated search logic, no drift.
  const { results, loading } = useAssetSearch(query)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setHighlight(0) }, [results])

  useEffect(() => {
    if (open) containerRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [highlight, open])

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
    if (e.key === 'Escape') { setOpen(false); return }
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
    }
  }

  return (
    <div ref={containerRef} className="relative" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
    }}>
      <input
        role="combobox"
        aria-label={t('market.searchInputPlaceholder')}
        aria-autocomplete="list"
        aria-expanded={Boolean(open && query.trim())}
        aria-controls={open && query.trim() ? listId : undefined}
        aria-activedescendant={open && query.trim() && results[highlight] ? `${listId}-${highlight}` : undefined}
        className={inputClass}
        placeholder={t('market.searchInputPlaceholder')}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {open && query.trim() && (
        <div id={listId} role="listbox" aria-label={t('market.searchInputPlaceholder')} className="oa-popover-enter absolute z-20 mt-1 max-h-[360px] w-full overflow-y-auto rounded-xl border border-border bg-popover py-1 shadow-md">
          {loading && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">{t('market.searching')}</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">{t('market.noMatches')}</div>
          )}
          {results.map((r, i) => (
            <button
              key={r.barId}
              id={`${listId}-${i}`}
              type="button"
              role="option"
              aria-selected={i === highlight}
              tabIndex={-1}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(r)}
              onMouseEnter={() => setHighlight(i)}
              className={`flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-sm leading-5 ${
                i === highlight ? 'bg-muted' : ''
              }`}
            >
              <span className="font-mono font-semibold text-foreground shrink-0">{r.symbol}</span>
              {r.name && (
                <span className="text-muted-foreground truncate flex-1 min-w-0">— {r.name}</span>
              )}
              {/* Explicit provider — this is how same-symbol sources are disambiguated. */}
              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-sm leading-5 text-muted-foreground">
                <span className="font-medium text-foreground/80">{r.sourceId}</span>
                {r.barCapability && (
                  <span className={CAPABILITY_COLOR[r.barCapability] ?? 'text-muted-foreground'}>{r.barCapability}</span>
                )}
              </span>
              <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-sm leading-5 font-medium ${ASSET_CLASS_COLORS[r.assetClass] ?? ASSET_CLASS_COLORS.unknown}`}>
                {r.assetClass}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
