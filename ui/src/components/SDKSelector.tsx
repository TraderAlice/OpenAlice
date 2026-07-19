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
              relative text-left rounded-lg border px-4 py-3.5 transition-all
              ${isSelected
                ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                : isDisabled
                  ? 'border-border/50 opacity-50 cursor-not-allowed'
                  : 'border-border hover:border-muted-foreground/40 hover:bg-muted/30 cursor-pointer'
              }
              ${isLocked ? 'cursor-default' : ''}
            `}
          >
            {/* Coming Soon badge */}
            {isDisabled && (
              <span className="absolute top-2.5 right-2.5 text-[10px] font-medium text-muted-foreground/60 bg-muted px-1.5 py-0.5 rounded">
                Coming Soon
              </span>
            )}

            {/* Locked badge (always active) */}
            {isLocked && !isDisabled && (
              <span className="absolute top-2.5 right-2.5 text-[10px] font-medium text-primary/70 bg-primary/10 px-1.5 py-0.5 rounded">
                Always On
              </span>
            )}

            {/* Selected indicator (non-locked) */}
            {isSelected && !isLocked && !isDisabled && (
              <span className="absolute top-2.5 right-2.5">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="8" className="fill-primary" />
                  <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}

            <div className="flex items-start gap-3">
              {/* Badge avatar */}
              <div className={`
                w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5
                text-[11px] font-bold tracking-wide
                ${isSelected ? 'bg-primary/15' : 'bg-muted'}
                ${isSelected ? 'text-primary' : opt.badgeColor}
              `}>
                {opt.badge}
              </div>

              <div className="min-w-0 pr-5">
                <p className={`text-[13px] font-medium ${isSelected ? 'text-foreground' : isDisabled ? 'text-muted-foreground' : 'text-foreground'}`}>
                  {opt.name}
                </p>
                <p className="text-[11px] text-muted-foreground/70 mt-0.5 leading-relaxed">
                  {opt.description}
                </p>
              </div>
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
