import { useEastmoneyIdentity } from '../components/market/useEastmoneyIdentity'
import { PageHeader } from '../components/PageHeader'
import { SearchBox } from '../components/market/SearchBox'
import { EquityDetail } from './market/EquityDetail'
import { CurrencyDetail } from './market/CurrencyDetail'
import { GenericDetail } from './market/GenericDetail'
import type { ViewSpec } from '../tabs/types'

interface MarketDetailPageProps {
  spec: Extract<ViewSpec, { kind: 'market-detail' }>
}

export function MarketDetailPage({ spec }: MarketDetailPageProps) {
  const { assetClass, symbol, source } = spec.params
  const identity = useEastmoneyIdentity(assetClass === 'equity' ? source : undefined)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={identity?.name ?? identity?.code ?? symbol}
        description={identity ? `${identity.code} · ${identity.market}` : assetClass === 'currency'
          ? 'FX spot, carry, macro, and scenario analysis'
          : `${assetClass} price history`}
      />
      <div className="flex-1 flex flex-col gap-3 px-4 md:px-8 py-4 min-h-0 overflow-y-auto">
        <SearchBox />
        {assetClass === 'equity' ? (
          <EquityDetail symbol={symbol} source={source} displayName={identity?.name} securityCode={identity?.code} />
        ) : assetClass === 'currency' ? (
          <CurrencyDetail symbol={symbol} source={source} />
        ) : (
          <GenericDetail symbol={symbol} assetClass={assetClass} source={source} />
        )}
      </div>
    </div>
  )
}

