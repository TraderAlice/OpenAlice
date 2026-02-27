import type { ReactNode } from 'react'

export interface SDKOption {
  id: string
  name: string
  description: string
  badge: string          // Short text shown in the avatar circle (e.g. "CC", "AL")
  badgeColor: string     // Tailwind text color class for the badge
  comingSoon?: boolean
}

interface SDKSelectorProps {
  options: SDKOption[]
  selected: string
  onSelect: (id: string) => void
}

export function SDKSelector({ options, selected, onSelect }: SDKSelectorProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {options.map((opt) => {
        const isSelected = opt.id === selected
        const isDisabled = opt.comingSoon

        return (
          <button
            key={opt.id}
            type="button"
            disabled={isDisabled}
            onClick={() => !isDisabled && onSelect(opt.id)}
            className={`
              relative text-left rounded-lg border px-4 py-3.5 transition-all
              ${isSelected
                ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
                : isDisabled
                  ? 'border-border/50 opacity-50 cursor-not-allowed'
                  : 'border-border hover:border-text-muted/40 hover:bg-bg-tertiary/30 cursor-pointer'
              }
            `}
          >
            {/* Coming Soon badge */}
            {isDisabled && (
              <span className="absolute top-2.5 right-2.5 text-[10px] font-medium text-text-muted/60 bg-bg-tertiary px-1.5 py-0.5 rounded">
                Coming Soon
              </span>
            )}

            {/* Selected indicator */}
            {isSelected && (
              <span className="absolute top-2.5 right-2.5">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="8" className="fill-accent" />
                  <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            )}

            <div className="flex items-start gap-3">
              {/* Badge avatar */}
              <div className={`
                w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5
                text-[11px] font-bold tracking-wide
                ${isSelected ? 'bg-accent/15' : 'bg-bg-tertiary'}
                ${isSelected ? 'text-accent' : opt.badgeColor}
              `}>
                {opt.badge}
              </div>

              <div className="min-w-0 pr-5">
                <p className={`text-[13px] font-medium ${isSelected ? 'text-text' : isDisabled ? 'text-text-muted' : 'text-text'}`}>
                  {opt.name}
                </p>
                <p className="text-[11px] text-text-muted/70 mt-0.5 leading-relaxed">
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
    badgeColor: 'text-accent',
  },
  {
    id: 'binance-native',
    name: 'Binance Native SDK',
    description: 'Direct Binance API integration with WebSocket streams and advanced order types.',
    badge: 'BN',
    badgeColor: 'text-yellow',
    comingSoon: true,
  },
  {
    id: 'bybit-native',
    name: 'Bybit Native SDK',
    description: 'Native Bybit V5 API with unified trading account support.',
    badge: 'BY',
    badgeColor: 'text-text-muted',
    comingSoon: true,
  },
  {
    id: 'okx-native',
    name: 'OKX Native SDK',
    description: 'Direct OKX API with portfolio margin and copy trading support.',
    badge: 'OK',
    badgeColor: 'text-text-muted',
    comingSoon: true,
  },
]

export const SECURITIES_SDK_OPTIONS: SDKOption[] = [
  {
    id: 'alpaca',
    name: 'Alpaca',
    description: 'Commission-free US equities and ETFs with fractional share support.',
    badge: 'AL',
    badgeColor: 'text-green',
  },
  {
    id: 'ibkr',
    name: 'Interactive Brokers',
    description: 'Global multi-asset broker with access to 150+ markets in 33 countries.',
    badge: 'IB',
    badgeColor: 'text-text-muted',
    comingSoon: true,
  },
  {
    id: 'schwab',
    name: 'Charles Schwab',
    description: 'Full-service US broker with comprehensive research and zero-commission trades.',
    badge: 'CS',
    badgeColor: 'text-text-muted',
    comingSoon: true,
  },
  {
    id: 'tradier',
    name: 'Tradier',
    description: 'Developer-friendly brokerage API with equity and options trading.',
    badge: 'TR',
    badgeColor: 'text-text-muted',
    comingSoon: true,
  },
]
