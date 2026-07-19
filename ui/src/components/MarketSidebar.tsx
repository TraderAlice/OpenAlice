import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type AssetClass, type BarSourceCandidate } from '../api/market'
import { useAssetSearch } from './market/useAssetSearch'
import { useWorkspace } from '../tabs/store'
import { useWatchlist } from '../tabs/watchlist-store'
import { getFocusedTab, type ViewSpec } from '../tabs/types'
import { SidebarRow } from './SidebarRow'
import { SidebarSectionHeader } from './SidebarSectionHeader'
import { Spinner } from './StateViews'

const ASSET_CLASS_COLORS: Record<string, string> = {
  equity: 'bg-primary/15 text-primary',
  crypto: 'bg-warning/15 text-warning',
  currency: 'bg-success/15 text-success',
  commodity: 'bg-ai-action/15 text-ai-action',
  unknown: 'bg-muted text-muted-foreground',
}

const CAPABILITY_COLOR: Record<string, string> = {
  realtime: 'text-success', iex: 'text-primary', delayed: 'text-muted-foreground',
  subscription: 'text-warning', free: 'text-muted-foreground',
}

/** A crypto venue's "AAPL" is synthetic — the route segment still needs a valid
 *  asset class, so map 'unknown' to a sane default. */
function routeAssetClass(c: BarSourceCandidate['assetClass']): AssetClass {
  return c === 'unknown' ? 'equity' : c
}

/**
 * Market sidebar — search + browse + watchlist. Modelled after VS Code's
 * Extension Marketplace: the sidebar IS the search panel, results land
 * inline, clicking opens a market-detail tab in the editor area. Pinning
 * an asset (via the ⭐ button on the detail page) adds it to the
 * watchlist below.
 *
 * Search results are debounced 300ms.
 */
export function MarketSidebar() {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  // Shared with the main search box — one search logic, no drift.
  const { results, loading } = useAssetSearch(query)

  const watchlist = useWatchlist((s) => s.entries)
  const removeFromWatchlist = useWatchlist((s) => s.remove)
  const openOrFocus = useWorkspace((s) => s.openOrFocus)

  const focusedSpec = useWorkspace((state) => getFocusedTab(state)?.spec)
  const isFocused = (kind: ViewSpec['kind']) => focusedSpec?.kind === kind
  const isFocusedDetail = (assetClass: string, symbol: string, source?: string) =>
    focusedSpec?.kind === 'market-detail' &&
    focusedSpec.params.assetClass === assetClass &&
    focusedSpec.params.symbol === symbol &&
    (source === undefined || focusedSpec.params.source === source)

  const handleSelectResult = (c: BarSourceCandidate) => {
    if (!c.symbol) return
    // Open the chart on THIS exact provider (source = barId).
    openOrFocus({ kind: 'market-detail', params: { assetClass: routeAssetClass(c.assetClass), symbol: c.symbol, source: c.barId } })
  }

  return (
    <div className="flex flex-col gap-3 h-full overflow-hidden">
      {/* Search box */}
      <div className="px-3 pt-2 shrink-0">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('market.searchPlaceholder')}
          className="w-full px-2.5 py-1.5 bg-background text-foreground border border-border/70 rounded-md text-[13px] outline-none focus:border-primary"
        />
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Browse */}
        <SidebarSectionHeader>{t('market.browseSection')}</SidebarSectionHeader>
        <SidebarRow
          label={t('market.browseMarkets')}
          active={isFocused('market-list')}
          onClick={() => openOrFocus({ kind: 'market-list', params: {} })}
        />
        <SidebarRow
          label={t('market.sectorRotation')}
          active={isFocused('market-rotation')}
          onClick={() => openOrFocus({ kind: 'market-rotation', params: {} })}
        />
        {/* Boards — a distinct cluster from the two nav rows above, on the
            same kinship rail the Inbox uses for grouped sub-rows. */}
        <div className="ml-[18px] border-l border-border/50">
          <SidebarRow
            label={t('market.boardMovers')}
            active={focusedSpec?.kind === 'market-board' && focusedSpec.params.board === 'movers'}
            onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'movers' } })}
          />
          <SidebarRow
            label={t('market.boardCalendar')}
            active={focusedSpec?.kind === 'market-board' && focusedSpec.params.board === 'calendar'}
            onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'calendar' } })}
          />
          <SidebarRow
            label={t('market.boardMacro')}
            active={focusedSpec?.kind === 'market-board' && focusedSpec.params.board === 'macro'}
            onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'macro' } })}
          />
          <SidebarRow
            label={t('market.boardTermStructure')}
            active={focusedSpec?.kind === 'market-board' && focusedSpec.params.board === 'term-structure'}
            onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'term-structure' } })}
          />
          <SidebarRow
            label={t('market.boardGlobalMacro')}
            active={focusedSpec?.kind === 'market-board' && focusedSpec.params.board === 'global-macro'}
            onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'global-macro' } })}
          />
          <SidebarRow
            label={t('market.boardFed')}
            active={focusedSpec?.kind === 'market-board' && focusedSpec.params.board === 'fed'}
            onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'fed' } })}
          />
          <SidebarRow
            label={t('market.boardShipping')}
            active={focusedSpec?.kind === 'market-board' && focusedSpec.params.board === 'shipping'}
            onClick={() => openOrFocus({ kind: 'market-board', params: { board: 'shipping' } })}
          />
        </div>

        {/* Search results — only when query is non-empty */}
        {query.trim() && (
          <>
            <SidebarSectionHeader>
              {t('market.searchResults')}{loading ? ` (${t('common.searching')})` : results.length ? ` (${results.length})` : ''}
            </SidebarSectionHeader>
            {loading && (
              <div className="flex items-center gap-2 px-3 py-2 text-[12px] text-muted-foreground">
                <Spinner size="sm" />
                <span>{t('common.searching')}</span>
              </div>
            )}
            {!loading && results.length === 0 && (
              <p className="px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">{t('market.noMatches')}</p>
            )}
            {results.map((c) => (
              <SidebarRow
                key={c.barId}
                label={
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="font-mono font-semibold shrink-0">{c.symbol}</span>
                    {c.name && <span className="text-muted-foreground truncate">{c.name}</span>}
                  </span>
                }
                active={isFocusedDetail(routeAssetClass(c.assetClass), c.symbol, c.barId)}
                onClick={() => handleSelectResult(c)}
                trail={<SourceTrail c={c} />}
              />
            ))}
          </>
        )}

        {/* Watchlist */}
        <SidebarSectionHeader>{t('market.watchlist')}{watchlist.length ? ` (${watchlist.length})` : ''}</SidebarSectionHeader>
        {watchlist.length === 0 ? (
          <p className="px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
            {t('market.emptyWatchlistHint')}
          </p>
        ) : (
          watchlist.map((entry) => (
            <SidebarRow
              key={`${entry.assetClass}:${entry.symbol}`}
              label={<span className="font-mono font-semibold truncate">{entry.symbol}</span>}
              active={isFocusedDetail(entry.assetClass, entry.symbol)}
              onClick={() =>
                openOrFocus({
                  kind: 'market-detail',
                  params: { assetClass: entry.assetClass, symbol: entry.symbol },
                })
              }
              trail={
                <>
                  <AssetClassChip cls={entry.assetClass} />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeFromWatchlist(entry.assetClass, entry.symbol)
                    }}
                    className="flex h-4 w-4 items-center justify-center rounded text-muted-foreground opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
                    aria-label={t('market.removeFromWatchlist', { symbol: entry.symbol })}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </>
              }
            />
          ))
        )}
      </div>
    </div>
  )
}

function AssetClassChip({ cls }: { cls: string }) {
  return (
    <span className={`shrink-0 text-[9px] uppercase tracking-wide px-1 rounded ${ASSET_CLASS_COLORS[cls] ?? ASSET_CLASS_COLORS.unknown}`}>
      {cls}
    </span>
  )
}

/** Explicit provider + freshness + asset class for a search hit — this is how
 *  same-symbol sources are disambiguated (TradingView-style). */
function SourceTrail({ c }: { c: BarSourceCandidate }) {
  // Provider is the disambiguator; keep it compact so the ticker is never
  // crushed. (Asset class is shown in the wider main search box, not here.)
  return (
    <span className="flex items-center gap-1 shrink-0" title={`${c.barId}${c.barCapability ? ` · ${c.barCapability}` : ''}`}>
      <span className="text-[10px] text-foreground/75 font-medium truncate max-w-[96px]">{c.sourceId}</span>
      {c.barCapability && (
        <span className={`text-[9px] ${CAPABILITY_COLOR[c.barCapability] ?? 'text-muted-foreground'}`}>{c.barCapability}</span>
      )}
    </span>
  )
}
