import { KlinePanel } from '../../components/market/KlinePanel'
import { TradeableContractsPanel } from '../../components/market/TradeableContractsPanel'
import type { AssetClass } from '../../api/market'

interface Props {
  symbol: string
  assetClass: AssetClass
}

/**
 * Fallback layout for asset classes that haven't earned a bespoke page yet.
 * Shows just the K-line — quote/fundamentals panels are equity-shaped and
 * would be misleading if forced onto crypto/currency/commodity.
 */
export function GenericDetail({ symbol, assetClass }: Props) {
  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      <div className="flex items-end gap-2 px-1">
        <span className="text-[20px] font-semibold text-text tracking-tight">{symbol}</span>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted font-medium">
          {assetClass}
        </span>
        <span className="text-[11px] text-text-muted/70">
          Detail layout coming — for now, price history only.
        </span>
      </div>
      <div className="flex-1 min-h-[420px]">
        <KlinePanel selection={{ symbol, assetClass }} />
      </div>

      <TradeableContractsPanel symbol={symbol} assetClass={assetClass} />
    </div>
  )
}
