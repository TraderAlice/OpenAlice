import { QuoteHeader } from '../../components/market/QuoteHeader'
import { ProfilePanel } from '../../components/market/ProfilePanel'
import { KeyMetricsPanel } from '../../components/market/KeyMetricsPanel'
import { FinancialStatementsPanel } from '../../components/market/FinancialStatementsPanel'
import { KlinePanel } from '../../components/market/KlinePanel'
import { TradeableContractsPanel } from '../../components/market/TradeableContractsPanel'

interface Props {
  symbol: string
}

export function EquityDetail({ symbol }: Props) {
  return (
    <div className="flex flex-col gap-3">
      <QuoteHeader symbol={symbol} />

      <div className="h-[360px] shrink-0">
        <KlinePanel selection={{ symbol, assetClass: 'equity' }} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <ProfilePanel symbol={symbol} />
        <KeyMetricsPanel symbol={symbol} />
      </div>

      <TradeableContractsPanel symbol={symbol} assetClass="equity" />

      <FinancialStatementsPanel symbol={symbol} />
    </div>
  )
}
