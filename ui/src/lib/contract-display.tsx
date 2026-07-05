/**
 * Shared contract rendering — the IBKR-superset display layer.
 *
 * Every surface that shows a contract (positions, open orders, order/trade
 * history) renders through here so options/futures fields (secType, strike,
 * right, expiry, multiplier) display correctly from day one, even while
 * live accounts are stocks + crypto.
 *
 * The `secType` tag mirrors the canonical taxonomy string (STK / OPT /
 * CRYPTO_PERP / ...) directly — no vernacular translation — so a label here
 * is unambiguously the same thing as `contract.secType` everywhere else in
 * the stack.
 *
 * Input shapes differ slightly across the wire: history rows carry `expiry`,
 * Position rows carry `lastTradeDateOrContractMonth`, and strike/multiplier
 * arrive as string (Decimal-safe) or number depending on the source. The
 * normalize step absorbs all of that.
 */

/** Loose input — accepts both HistoryContract and Position.contract shapes. */
export interface ContractLike {
  aliceId?: string
  symbol?: string
  localSymbol?: string
  secType?: string
  currency?: string
  exchange?: string
  /** Primary listing exchange (NASDAQ / SEHK), distinct from routing `exchange`. */
  primaryExchange?: string
  /** Instrument long-name ("Apple Inc"), where the broker exposes it. */
  description?: string
  /** History rows. */
  expiry?: string
  /** Position rows (IBKR field name). */
  lastTradeDateOrContractMonth?: string
  strike?: string | number
  right?: string
  multiplier?: string | number
}

interface NormalizedContract {
  aliceId?: string
  symbol?: string
  localSymbol?: string
  secType?: string
  currency?: string
  exchange?: string
  primaryExchange?: string
  description?: string
  expiry?: string
  strike?: string
  right?: string
  multiplier?: string
}

function normalizeContract(c: ContractLike): NormalizedContract {
  return {
    aliceId: c.aliceId,
    symbol: c.symbol,
    localSymbol: c.localSymbol,
    secType: c.secType,
    currency: c.currency,
    exchange: c.exchange,
    // Empty strings come over the wire for unpopulated fields — coerce to undefined.
    primaryExchange: c.primaryExchange || undefined,
    description: c.description || undefined,
    expiry: c.expiry ?? c.lastTradeDateOrContractMonth,
    strike: c.strike != null ? String(c.strike) : undefined,
    right: c.right,
    multiplier: c.multiplier != null ? String(c.multiplier) : undefined,
  }
}

/** Tail of an aliceId after the source prefix: `alpaca|AAPL` → `AAPL`. */
function aliceIdTail(aliceId?: string): string | undefined {
  if (!aliceId) return undefined
  const idx = aliceId.lastIndexOf('|')
  return idx >= 0 ? aliceId.slice(idx + 1) : aliceId
}

/** Strip trailing zeros from a decimal string: "300.00" → "300", "7.50" → "7.5". */
function trimDecimal(v: string): string {
  if (!v.includes('.')) return v
  return v.replace(/\.?0+$/, '')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

/** YYYYMMDD → MM/DD/YY; YYYYMM → MM/YY; anything else passes through. */
function formatExpiryDate(expiry: string): string {
  if (/^\d{8}$/.test(expiry)) {
    return `${expiry.slice(4, 6)}/${expiry.slice(6, 8)}/${expiry.slice(2, 4)}`
  }
  if (/^\d{6}$/.test(expiry)) {
    return `${expiry.slice(4, 6)}/${expiry.slice(2, 4)}`
  }
  return expiry
}

/** YYYYMMDD / YYYYMM → "Sep 2026"; anything else passes through. */
function formatExpiryMonthYear(expiry: string): string {
  if (/^\d{6}(\d{2})?$/.test(expiry)) {
    const month = Number(expiry.slice(4, 6))
    if (month >= 1 && month <= 12) return `${MONTHS[month - 1]} ${expiry.slice(0, 4)}`
  }
  return expiry
}

/**
 * Primary display line for a contract.
 *
 * - OPT/FOP: `AAPL 300C 07/17/26`
 * - FUT:     `ESU6 · Sep 2026`
 * - CRYPTO:  `ETH/USDT` (+ ` PERP` suffix for CRYPTO_PERP)
 * - STK / default: symbol (fallback localSymbol, fallback aliceId tail)
 */
export function contractPrimary(input: ContractLike): string {
  const c = normalizeContract(input)
  const t = (c.secType ?? '').toUpperCase()
  const baseSymbol = c.symbol ?? c.localSymbol ?? aliceIdTail(c.aliceId) ?? '?'

  if (t === 'OPT' || t === 'FOP') {
    const strikeRight = [c.strike && trimDecimal(c.strike), c.right].filter(Boolean).join('')
    const parts = [baseSymbol, strikeRight, c.expiry && formatExpiryDate(c.expiry)].filter(Boolean)
    // No option fields at all — fall back to whatever identity we have.
    return parts.length > 1 ? parts.join(' ') : (c.localSymbol ?? baseSymbol)
  }
  if (t === 'FUT') {
    const name = c.localSymbol ?? baseSymbol
    return c.expiry ? `${name} · ${formatExpiryMonthYear(c.expiry)}` : name
  }
  if (t === 'CRYPTO' || t === 'CRYPTO_PERP') {
    const name = c.localSymbol ?? baseSymbol
    return t === 'CRYPTO_PERP' ? `${name} PERP` : name
  }
  return baseSymbol
}

/**
 * Secondary line, split into two visual tiers so the symbol stays dominant:
 *
 * - `name` — the human instrument long-name ("Apple Inc. Common Stock"),
 *   present for equities / IBKR. The crypto `description` is just the pair
 *   (redundant with the primary line), so it's suppressed.
 * - `meta` — the coded metadata `STK · NASDAQ · USD` (`primaryExchange`, the
 *   real listing venue, replaces the routing `exchange` — often a meaningless
 *   "SMART"). Multiplier shown only when present and ≠ '1'.
 *
 * `ContractCell` renders `name` muted and `meta` fainter still.
 */
export function contractSecondaryParts(input: ContractLike): { name?: string; meta: string } {
  const c = normalizeContract(input)
  const t = (c.secType ?? '').toUpperCase()
  const isCrypto = t === 'CRYPTO' || t === 'CRYPTO_PERP'
  const name = !isCrypto ? c.description : undefined
  const venue = c.primaryExchange ?? c.exchange

  const meta: string[] = []
  if (c.secType) meta.push(c.secType)
  if (venue) meta.push(venue)
  if (c.currency) meta.push(c.currency)
  if (c.multiplier && trimDecimal(c.multiplier) !== '1') meta.push(`×${trimDecimal(c.multiplier)}`)
  return { name, meta: meta.join(' · ') }
}

/** Flat secondary string (`name · meta`) — kept for non-cell callers/tests. */
export function contractSecondary(input: ContractLike): string {
  const { name, meta } = contractSecondaryParts(input)
  return [name, meta].filter(Boolean).join(' · ')
}

/**
 * Two-line contract cell for tables. Three deliberate emphasis tiers so the
 * full detail line never competes with the symbol:
 *   symbol (strong) → long-name (muted) → coded metadata (faintest).
 */
export function ContractCell({ contract }: { contract: ContractLike }) {
  const { name, meta } = contractSecondaryParts(contract)
  return (
    <div className="min-w-0">
      <div className="text-[13px] text-text font-medium leading-tight">{contractPrimary(contract)}</div>
      {(name || meta) && (
        <div className="text-[11px] leading-tight mt-0.5">
          {name && <span className="text-text-muted">{name}</span>}
          {name && meta && <span className="text-text-muted opacity-40"> · </span>}
          {meta && <span className="text-text-muted opacity-60">{meta}</span>}
        </div>
      )}
    </div>
  )
}
