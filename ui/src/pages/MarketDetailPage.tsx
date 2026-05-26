import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { SearchBox } from '../components/market/SearchBox'
import { EquityDetail } from './market/EquityDetail'
import { GenericDetail } from './market/GenericDetail'
import { useWatchlist } from '../tabs/watchlist-store'
import type { ViewSpec } from '../tabs/types'

interface MarketDetailPageProps {
  spec: Extract<ViewSpec, { kind: 'market-detail' }>
}

export function MarketDetailPage({ spec }: MarketDetailPageProps) {
  const { t } = useTranslation()
  const { assetClass, symbol } = spec.params

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={symbol}
        description={`${assetClass} · ${t('market.priceHistory', 'price history')}`}
        right={<PinButton assetClass={assetClass} symbol={symbol} />}
      />
      <div className="flex-1 flex flex-col gap-3 px-4 md:px-8 py-4 min-h-0 overflow-y-auto">
        <SearchBox />
        {assetClass === 'equity' ? (
          <EquityDetail symbol={symbol} />
        ) : (
          <GenericDetail symbol={symbol} assetClass={assetClass} />
        )}
      </div>
    </div>
  )
}

interface PinButtonProps {
  assetClass: Extract<ViewSpec, { kind: 'market-detail' }>['params']['assetClass']
  symbol: string
}

/** Pin / unpin from the Market sidebar's watchlist. */
function PinButton({ assetClass, symbol }: PinButtonProps) {
  const { t } = useTranslation()
  const pinned = useWatchlist((s) => s.entries.some((e) => e.assetClass === assetClass && e.symbol === symbol))
  const add = useWatchlist((s) => s.add)
  const remove = useWatchlist((s) => s.remove)
  return (
    <button
      type="button"
      onClick={() => (pinned ? remove(assetClass, symbol) : add(assetClass, symbol))}
      title={pinned ? t('market.removeFromWatchlist', 'Remove from watchlist') : t('market.addToWatchlist', 'Add to watchlist')}
      className={`flex items-center gap-1.5 px-2.5 py-1 text-[12px] rounded-md border transition-colors ${
        pinned
          ? 'border-amber-500/40 text-amber-400 bg-amber-500/10 hover:bg-amber-500/15'
          : 'border-border text-text-muted hover:text-text hover:bg-bg-tertiary'
      }`}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill={pinned ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
      {pinned ? t('market.pinned', 'Pinned') : t('market.pin', 'Pin')}
    </button>
  )
}
