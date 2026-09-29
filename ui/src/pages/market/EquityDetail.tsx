import { QuoteHeader } from '../../components/market/QuoteHeader'
import { ProfilePanel } from '../../components/market/ProfilePanel'
import { KeyMetricsPanel } from '../../components/market/KeyMetricsPanel'
import { FinancialStatementsPanel } from '../../components/market/FinancialStatementsPanel'
import { KlinePanel } from '../../components/market/KlinePanel'
import { TradeableContractsPanel } from '../../components/market/TradeableContractsPanel'
import { resolveCnRealtimeQuote } from '../../components/market/cn-realtime-quote'

interface Props {
  symbol: string
  source?: string
  displayName?: string
  securityCode?: string
}

export function EquityDetail({ symbol, source, displayName, securityCode }: Props) {
  // Eastmoney intentionally owns only Chinese-name discovery + forward-adjusted
  // K-lines. Its native secid (`1.600519`) is not a Yahoo/FMP ticker, so feeding
  // it into the default fundamental panels produces misleading failures.
  // Realtime L1 quotes for those symbols (and Yahoo .SS/.SZ) go through Tencent.
  const klineOnly = source?.startsWith('eastmoney|') === true
  const cnQuote = resolveCnRealtimeQuote(symbol, source)

  return (
    <div className="flex flex-col gap-3">
      {cnQuote ? (
        <QuoteHeader symbol={cnQuote.symbol} provider={cnQuote.provider} pollMs={cnQuote.pollMs} />
      ) : !klineOnly ? (
        <QuoteHeader symbol={symbol} />
      ) : null}

      <div className="h-[440px] shrink-0">
        <KlinePanel selection={{ symbol, assetClass: 'equity' }} source={source} displayTitle={klineOnly ? (displayName ?? securityCode ?? symbol.replace(/^[01]\./, '')) : undefined} />
      </div>

      {!klineOnly && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <ProfilePanel symbol={symbol} />
          <KeyMetricsPanel symbol={symbol} />
        </div>
      )}

      <TradeableContractsPanel symbol={klineOnly ? (securityCode ?? symbol.replace(/^[01]\./, '')) : symbol} assetClass="equity" />

      {!klineOnly && <FinancialStatementsPanel symbol={symbol} />}
    </div>
  )
}
