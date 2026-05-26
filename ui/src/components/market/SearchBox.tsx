import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { marketApi, type SearchResult, type AssetClass } from '../../api/market'

const ASSET_CLASS_COLORS: Record<AssetClass, string> = {
  equity: 'bg-accent/15 text-accent',
  crypto: 'bg-amber-500/15 text-amber-400',
  currency: 'bg-green/15 text-green',
  commodity: 'bg-purple-500/15 text-purple-400',
}

function resultKey(r: SearchResult): string {
  return `${r.assetClass}:${r.symbol ?? r.id ?? Math.random()}`
}

function resultSymbol(r: SearchResult): string {
  return r.symbol ?? r.id ?? ''
}

export function SearchBox() {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        const res = await marketApi.search(q, 20)
        setResults(res.results)
        setHighlight(0)
      } catch (e) {
        console.error('search failed', e)
        setResults([])
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [query])

  useEffect(() => {
    const onClickAway = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [])

  const handleSelect = (r: SearchResult) => {
    const sym = resultSymbol(r)
    if (!sym) return
    setOpen(false)
    setQuery('')
    // Preserve K-line interval/range across symbol switches so the user's
    // preferred view settings carry over.
    const qs = searchParams.toString()
    navigate({
      pathname: `/market/${r.assetClass}/${encodeURIComponent(sym)}`,
      search: qs ? `?${qs}` : '',
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
        className="w-full px-3 py-2 text-[14px] bg-bg-secondary border border-border rounded-md focus:outline-none focus:border-accent placeholder:text-text-muted/50"
        placeholder={t('market.searchPlaceholder', 'Search symbol, company, or keyword...')}
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKey}
      />
      {open && query.trim() && (
        <div className="absolute z-20 mt-1 w-full bg-bg-secondary border border-border rounded-md shadow-lg max-h-[360px] overflow-y-auto">
          {loading && results.length === 0 && (
            <div className="px-3 py-2 text-[13px] text-text-muted">{t('market.searching', 'Searching…')}</div>
          )}
          {!loading && results.length === 0 && (
            <div className="px-3 py-2 text-[13px] text-text-muted">{t('market.noMatches', 'No matches')}</div>
          )}
          {results.map((r, i) => (
            <button
              key={resultKey(r)}
              onClick={() => handleSelect(r)}
              onMouseEnter={() => setHighlight(i)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left text-[13px] cursor-pointer transition-colors ${
                i === highlight ? 'bg-bg-tertiary' : ''
              }`}
            >
              <span className="font-mono font-semibold text-text">{resultSymbol(r)}</span>
              {r.name && (
                <span className="text-text-muted truncate flex-1">— {r.name}</span>
              )}
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded font-medium ${ASSET_CLASS_COLORS[r.assetClass]}`}>
                {r.assetClass}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
