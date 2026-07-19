import { KlinePanel } from '../../components/market/KlinePanel'
import { TradeableContractsPanel } from '../../components/market/TradeableContractsPanel'
import type { AssetClass } from '../../api/market'

interface Props {
  symbol: string
  assetClass: AssetClass
  source?: string
}

/**
 * Fallback layout for asset classes that haven't earned a bespoke page yet.
 * Shows just the K-line — quote/fundamentals panels are equity-shaped and
 * would be misleading if forced onto crypto/currency/commodity.
 */
export function GenericDetail({ symbol, assetClass, source }: Props) {
  return (
    <div className="flex flex-col gap-3 min-h-0 flex-1">
      <div className="flex items-end gap-2 px-1">
        <span className="text-[20px] font-semibold text-foreground tracking-tight">{symbol}</span>
        <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
          {assetClass}
        </span>
        <span className="text-[11px] text-muted-foreground/70">
          Detail layout coming — for now, price history only.
        </span>
      </div>
      <div className="flex-1 min-h-[420px]">
        <KlinePanel selection={{ symbol, assetClass }} source={source} />
      </div>

      <TradeableContractsPanel symbol={symbol} assetClass={assetClass} />
    </div>
  )
}
