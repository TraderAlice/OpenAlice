import { SelectionCheckIcon } from './ui/selection-check-icon'

export interface SDKOption {
  id: string
  name: string
  description: string
  badge: string          // Short text shown in the avatar circle (e.g. "CC", "AL")
  badgeColor: string     // Tailwind text color class for the badge
  comingSoon?: boolean
  locked?: boolean       // Cannot be deselected (always active, multi-select only)
}

// Single-select mode (default): selected is a string, onSelect fires with the chosen id
interface SDKSelectorSingleProps {
  options: SDKOption[]
  selected: string
  onSelect: (id: string) => void
}

// Multi-select mode: selected is a string[], onToggle fires when a toggleable card is clicked
interface SDKSelectorMultiProps {
  options: SDKOption[]
  selected: string[]
  onToggle: (id: string) => void
}

type SDKSelectorProps = SDKSelectorSingleProps | SDKSelectorMultiProps

function isMulti(props: SDKSelectorProps): props is SDKSelectorMultiProps {
  return Array.isArray(props.selected)
}

export function SDKSelector(props: SDKSelectorProps) {
  const { options } = props
  const multi = isMulti(props)

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {options.map((opt) => {
        const isSelected = multi
          ? props.selected.includes(opt.id)
          : opt.id === props.selected
        const isDisabled = opt.comingSoon
        const isLocked = multi && opt.locked

        const handleClick = () => {
          if (isDisabled) return
          if (isLocked) return
          if (multi) {
            props.onToggle(opt.id)
          } else {
            ;(props as SDKSelectorSingleProps).onSelect(opt.id)
          }
        }

        return (
          <button
            key={opt.id}
            type="button"
            disabled={isDisabled}
            onClick={handleClick}
            className={`
              relative rounded-lg border px-4 py-3.5 text-left transition-[border-color,background-color,box-shadow,opacity]
              ${isSelected
                ? 'border-foreground/20 bg-muted/50 ring-1 ring-border'
                : isDisabled
                  ? 'border-border/50 opacity-50 cursor-not-allowed'
                  : 'border-border hover:border-muted-foreground/40 hover:bg-muted/30 cursor-pointer'
              }
              ${isLocked ? 'cursor-default' : ''}
            `}
          >
            {/* Coming Soon badge */}
            {isDisabled && (
              <span className="text-micro absolute right-2.5 top-2.5 rounded px-1.5 py-0.5 font-medium text-muted-foreground/70">
                Coming Soon
              </span>
            )}

            {/* Locked badge (always active) */}
            {isLocked && !isDisabled && (
              <span className="text-micro absolute right-2.5 top-2.5 rounded px-1.5 py-0.5 font-medium text-muted-foreground/70">
                Always On
              </span>
            )}

            {/* Selected indicator (non-locked) */}
            {isSelected && !isLocked && !isDisabled && (
              <span className="absolute top-2.5 right-2.5">
                <SelectionCheckIcon />
              </span>
            )}

            <div className="min-w-0 pr-5">
              <p className={`text-[13px] leading-[18px] font-medium ${isDisabled ? 'text-muted-foreground' : 'text-foreground'}`}>
                {opt.name}
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground/70">
                {opt.description}
              </p>
            </div>
          </button>
        )
      })}
    </div>
  )
}

// ==================== Presets ====================

export const CRYPTO_SDK_OPTIONS: SDKOption[] = [
  {
    id: 'ccxt',
    name: 'CCXT',
    description: 'Unified API for 100+ crypto exchanges. Supports Binance, Bybit, OKX, Coinbase, and more.',
    badge: 'CC',
    badgeColor: 'text-primary',
  },
  {
    id: 'binance-native',
    name: 'Binance Native SDK',
    description: 'Direct Binance API integration with WebSocket streams and advanced order types.',
    badge: 'BN',
    badgeColor: 'text-warning',
    comingSoon: true,
  },
  {
    id: 'bybit-native',
    name: 'Bybit Native SDK',
    description: 'Native Bybit V5 API with unified trading account support.',
    badge: 'BY',
    badgeColor: 'text-muted-foreground',
    comingSoon: true,
  },
  {
    id: 'okx-native',
    name: 'OKX Native SDK',
    description: 'Direct OKX API with portfolio margin and copy trading support.',
    badge: 'OK',
    badgeColor: 'text-muted-foreground',
    comingSoon: true,
  },
]

export const SECURITIES_SDK_OPTIONS: SDKOption[] = [
  {
    id: 'alpaca',
    name: 'Alpaca',
    description: 'Commission-free US equities and ETFs with fractional share support.',
    badge: 'AL',
    badgeColor: 'text-success',
  },
  {
    id: 'ibkr',
    name: 'Interactive Brokers',
    description: 'Global multi-asset broker with access to 150+ markets in 33 countries.',
    badge: 'IB',
    badgeColor: 'text-muted-foreground',
    comingSoon: true,
  },
  {
    id: 'schwab',
    name: 'Charles Schwab',
    description: 'Full-service US broker with comprehensive research and zero-commission trades.',
    badge: 'CS',
    badgeColor: 'text-muted-foreground',
    comingSoon: true,
  },
  {
    id: 'tradier',
    name: 'Tradier',
    description: 'Developer-friendly brokerage API with equity and options trading.',
    badge: 'TR',
    badgeColor: 'text-muted-foreground',
    comingSoon: true,
  },
]

export const PLATFORM_TYPE_OPTIONS: SDKOption[] = [
  {
    id: 'ccxt',
    name: 'CCXT (Crypto)',
    description: 'Unified API for 100+ crypto exchanges. Supports Binance, Bybit, OKX, Coinbase, and more.',
    badge: 'CC',
    badgeColor: 'text-primary',
  },
  {
    id: 'alpaca',
    name: 'Alpaca (Securities)',
    description: 'Commission-free US equities and ETFs with fractional share support.',
    badge: 'AL',
    badgeColor: 'text-success',
  },
  {
    id: 'ibkr',
    name: 'IBKR (Interactive Brokers)',
    description: 'Professional-grade trading via TWS or IB Gateway. Stocks, options, futures, bonds.',
    badge: 'IB',
    badgeColor: 'text-warning',
  },
]

export const DATASOURCE_OPTIONS: SDKOption[] = [
  {
    id: 'marketData',
    name: 'Market Data',
    description: 'Structured financial data — prices, fundamentals, macro indicators.',
    badge: 'MD',
    badgeColor: 'text-success',
  },
  {
    id: 'news',
    name: 'News',
    description: 'RSS/Atom feed aggregation and news archive search.',
    badge: 'NW',
    badgeColor: 'text-ai-action',
  },
]
