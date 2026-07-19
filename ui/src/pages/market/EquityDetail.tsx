import { QuoteHeader } from '../../components/market/QuoteHeader'
import { ProfilePanel } from '../../components/market/ProfilePanel'
import { KeyMetricsPanel } from '../../components/market/KeyMetricsPanel'
import { FinancialStatementsPanel } from '../../components/market/FinancialStatementsPanel'
import { KlinePanel } from '../../components/market/KlinePanel'
import { TradeableContractsPanel } from '../../components/market/TradeableContractsPanel'

interface Props {
  symbol: string
  source?: string
}

export function EquityDetail({ symbol, source }: Props) {
  // Eastmoney intentionally owns only Chinese-name discovery + forward-adjusted
  // K-lines. Its native secid (`1.600519`) is not a Yahoo/FMP ticker, so feeding
  // it into the default quote/fundamental panels produces misleading failures.
  const klineOnly = source?.startsWith('eastmoney|') === true

  return (
    <div className="flex flex-col gap-3">
      {klineOnly ? (
        <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
          Eastmoney provides Chinese A-share discovery and forward-adjusted price history for this source.
          Quote and fundamental panels are not available in its native symbol namespace.
        </div>
      ) : (
        <QuoteHeader symbol={symbol} />
      )}

      <div className="h-[360px] shrink-0">
        <KlinePanel selection={{ symbol, assetClass: 'equity' }} source={source} />
      </div>

      {!klineOnly && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ProfilePanel symbol={symbol} />
          <KeyMetricsPanel symbol={symbol} />
        </div>
      )}

      <TradeableContractsPanel symbol={symbol} assetClass="equity" />

      {!klineOnly && <FinancialStatementsPanel symbol={symbol} />}
    </div>
  )
}
