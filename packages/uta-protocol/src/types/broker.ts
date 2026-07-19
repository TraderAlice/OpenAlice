/**
 * Broker types — IBroker interface and associated data types.
 *
 * All broker implementations (Alpaca, CCXT, IBKR, ...) implement IBroker.
 * Order/Contract/Execution/OrderState come directly from @traderalice/ibkr.
 * Only types that IBKR doesn't define (Position, AccountInfo, Quote, etc.)
 * are defined here, with field names aligned to IBKR conventions.
 */

import type { Contract, ContractDescription, ContractDetails, Order, OrderState, Execution, OrderCancel } from '@traderalice/ibkr'
import type Decimal from 'decimal.js'
import './contract-ext.js'

// ==================== Errors ====================

export type BrokerErrorCode = 'CONFIG' | 'AUTH' | 'NETWORK' | 'EXCHANGE' | 'MARKET_CLOSED' | 'CONNECTING' | 'UNKNOWN'

const BROKER_ERROR_CODES: ReadonlySet<string> = new Set<BrokerErrorCode>([
  'CONFIG', 'AUTH', 'NETWORK', 'EXCHANGE', 'MARKET_CLOSED', 'CONNECTING', 'UNKNOWN',
])

/**
 * Structured broker error.
 * - `permanent` errors (CONFIG, AUTH) disable the account — will not be retried.
 * - Transient errors (NETWORK, EXCHANGE, MARKET_CLOSED) trigger auto-recovery.
 * - `CONNECTING` is a special transient marker: the account is not yet (or no
 *   longer) ready — its initial broker connect is still in flight, or it's
 *   offline and the recovery loop is actively reconnecting. It means "data
 *   pending, retry shortly", NOT a failure: a read returns it WITHOUT blocking
 *   on the slow connect and WITHOUT counting as a failure (so it never degrades
 *   health or disables the account). Recovery keeps running underneath.
 */
export class BrokerError extends Error {
  readonly code: BrokerErrorCode
  readonly permanent: boolean

  constructor(code: BrokerErrorCode, message: string) {
    super(message)
    this.name = 'BrokerError'
    this.code = code
    this.permanent = code === 'CONFIG' || code === 'AUTH'
  }

  /** Wrap any error as a BrokerError, classifying by message patterns. */
  static from(err: unknown, fallbackCode: BrokerErrorCode = 'UNKNOWN'): BrokerError {
    if (err instanceof BrokerError) return err
    const msg = err instanceof Error ? err.message : String(err)
    // Optional broker packs carry their own physical protocol dependency.
    // Preserve an explicit code across that package boundary instead of
    // relying on constructor identity or reclassifying the message text.
    const structuredCode = err && typeof err === 'object'
      && (err as { name?: unknown }).name === 'BrokerError'
      && typeof (err as { code?: unknown }).code === 'string'
      && BROKER_ERROR_CODES.has((err as { code: string }).code)
      ? (err as { code: BrokerErrorCode }).code
      : null
    const code = structuredCode ?? BrokerError.classifyMessage(msg) ?? fallbackCode
    const be = new BrokerError(code, msg)
    if (err instanceof Error) be.cause = err
    return be
  }

  /** Infer error code from common message patterns. */
  private static classifyMessage(msg: string): BrokerErrorCode | null {
    const m = msg.toLowerCase()
    // Market closed — check before AUTH to avoid 403 misclassification
    if (/market.?closed|not.?open|trading.?halt|outside.?trading.?hours/i.test(m)) return 'MARKET_CLOSED'
    // Network / infrastructure
    if (/timeout|etimedout|econnrefused|econnreset|socket hang up|enotfound|fetch failed/i.test(m)) return 'NETWORK'
    if (/429|rate.?limit|too many requests/i.test(m)) return 'NETWORK'
    if (/502|503|504|service.?unavailable|bad.?gateway/i.test(m)) return 'NETWORK'
    // Authentication (401 only — 403 can mean market closed or permission denied)
    if (/401|unauthorized|invalid.?key|invalid.?signature|authentication/i.test(m)) return 'AUTH'
    // Exchange-level rejections
    if (/403|forbidden/i.test(m)) return 'EXCHANGE'
    if (/insufficient|not.?enough|margin/i.test(m)) return 'EXCHANGE'
    return null
  }
}

// ==================== Position ====================

/**
 * Venue risk metadata for a leveraged-derivative position (crypto perps /
 * futures). Grouped into its own struct — rather than added as loose
 * top-level fields — so the base Position stays aligned with IBKR's
 * updatePortfolio() shape. IBKR itself keeps margin/leverage OFF the
 * position: init/maint margin live on `OrderState`, and account-wide margin
 * lives in the account-summary tags (ExcessLiquidity, MaintMarginReq, …),
 * because there leverage is a cross-margin *account* concept, not a
 * per-position one. On CCXT isolated/cross perps it genuinely IS
 * per-position, so we surface it here.
 *
 * Absent (`Position.risk === undefined`) for spot holdings and for
 * equity/cash brokers that don't expose per-position leverage. Numeric
 * fields are strings for the same float-safety reason as the monetary
 * fields on Position.
 */
export interface PositionRisk {
  /** Effective leverage on the position, e.g. `'50'` for 50×. */
  leverage?: string
  /** Estimated liquidation price, denominated in the position's `currency`. */
  liquidationPrice?: string
  /** Margin mode the position runs under. */
  marginMode?: 'cross' | 'isolated'
}

/**
 * Unified position/holding.
 * Field names aligned with IBKR EWrapper.updatePortfolio() parameters.
 */
export interface Position {
  contract: Contract
  /** Currency denomination for all monetary fields (avgCost, marketPrice, marketValue, PnL). */
  currency: string
  side: 'long' | 'short'
  quantity: Decimal
  /** All monetary fields are strings to prevent IEEE 754 floating-point artifacts. Use Decimal for arithmetic. */
  avgCost: string
  marketPrice: string
  marketValue: string
  unrealizedPnL: string
  realizedPnL: string
  /**
   * Shares-per-contract: how many underlying units one `quantity` unit
   * represents. `'1'` for plain stocks/crypto/forex; `'100'` for US
   * equity options; broker-specific for futures (e.g. ES = '50');
   * issuer-specific for HK warrants/CBBCs (often a non-integer).
   *
   * `marketValue` and `unrealizedPnL` are derived via `derivePositionMath`
   * with this field folded in, so consumers must NOT re-apply. This was
   * optional before the IBKR-as-truth refactor; it's required now to
   * force every broker to declare a value rather than rely on an implicit
   * 1-default. Read-time normalization in TradingGit.rehydrateGitState
   * fills missing values from older commit.json files.
   */
  multiplier: string
  /**
   * Provenance of `avgCost`:
   * - `'broker'`: broker reported it directly (Alpaca avg_entry_price,
   *   IBKR EWrapper, CCXT derivative entryPrice). Authoritative.
   * - `'wallet'`: broker has no real cost basis (e.g. CCXT spot synthesized
   *   from fetchBalance) — UTA must reconstruct from Alice's git log,
   *   bootstrapping unknown qty via reconcileBalance at observed markPrice.
   * Undefined defaults to `'broker'` (current behavior, back-compat).
   */
  avgCostSource?: 'broker' | 'wallet'
  /**
   * Venue risk metadata for leveraged derivatives (see {@link PositionRisk}).
   * Undefined for spot and for brokers without per-position leverage — so
   * a consumer reading `position.risk?.leverage` gets `undefined` rather
   * than a misleading implicit 1×.
   */
  risk?: PositionRisk
}

// ==================== Order result ====================

/**
 * A protective child order the venue created alongside the entry (bracket
 * TP/SL legs). Surfaced so the ledger can track the legs from birth —
 * otherwise they exist only on the exchange and every Alice surface
 * (order list, sync poller, cancel) is blind to them.
 */
export interface PlaceOrderLeg {
  orderId: string
  kind: 'takeProfit' | 'stopLoss'
}

/** Result of placeOrder / modifyOrder / closePosition. */
export interface PlaceOrderResult {
  success: boolean
  orderId?: string
  error?: string
  message?: string
  execution?: Execution
  orderState?: OrderState
  /** Bracket TP/SL child orders created by this placement, if any. */
  legs?: PlaceOrderLeg[]
}

// ==================== Contract expansion (hub → leaves) ====================

/**
 * Filters narrowing a contract expansion. Venue search returns two species:
 * LEAVES (tradeable, conId-keyed) and HUBS (directories — a bond issuer, an
 * FX currency family, an option chain behind a stock). Expansion turns a hub
 * (or a leaf's derivative family) into concrete tradeable leaves.
 */
export interface ExpandContractFilters {
  /** Option/future expiry (YYYYMMDD or YYYYMM). For options, switches the
   *  expansion from the parameter grid to concrete contracts. */
  expiry?: string
  /** Option right: C or P. */
  right?: 'C' | 'P'
  strikeMin?: number
  strikeMax?: number
  /** Which derivative family to expand on an underlying leaf (default OPT). */
  secType?: 'OPT' | 'FUT'
  /** Max leaves returned (default 60, capped at 200). `total` always reports the full count. */
  limit?: number
}

/** One exchange's option-chain parameter set (expirations × strikes). */
export interface OptionGridEntry {
  exchange: string
  tradingClass: string
  multiplier: string
  expirations: string[]
  strikes: number[]
}

export interface ContractExpansion {
  kind: 'contracts' | 'optionGrid'
  /** kind=contracts — concrete tradeable leaves, each with its own conId-based aliceId. */
  contracts?: Contract[]
  /** Full match count before `limit` was applied (never silently truncate). */
  total?: number
  /** kind=optionGrid — pick an expiry (+ right / strike range) and expand again. */
  grid?: OptionGridEntry[]
  /** Next-step guidance for the agent. */
  hint?: string
}

/** An open/completed order triplet as returned by getOrders(). */
export interface OpenOrder {
  contract: Contract
  order: Order
  orderState: OrderState
  /**
   * Broker-native order id AS A STRING. `order.orderId` is IBKR-shaped
   * (number) and mangles ids that exceed float precision — CCXT venues
   * issue 19-digit ids. Consumers that diff or track orders (external-
   * order observation) must use this field.
   */
  orderId?: string
  /**
   * Average fill price — from orderStatus callback or broker-specific
   * source. String to preserve Decimal precision end-to-end (sub-tick
   * fills + sub-satoshi accounting in OKX/Bybit unified accounts can
   * lose information through float).
   */
  avgFillPrice?: string
  /** Attached take-profit / stop-loss (CCXT: from order fields; Alpaca: from bracket legs). */
  tpsl?: TpSlParams
}

// ==================== Account info ====================

/** Field names aligned with IBKR AccountSummaryTags. All monetary fields are strings to prevent IEEE 754 artifacts. */
export interface AccountInfo {
  /** Base currency of this account — all monetary fields are denominated in this currency. */
  baseCurrency: string
  netLiquidation: string
  totalCashValue: string
  unrealizedPnL: string
  realizedPnL?: string
  buyingPower?: string
  initMarginReq?: string
  maintMarginReq?: string
  dayTradesRemaining?: number
}

// ==================== Sub-accounts ====================

/**
 * A sub-account (a.k.a. wallet / compartment) WITHIN a single broker
 * connection. Most brokers have exactly one and never implement
 * `listSubAccounts` — they are treated as having a single implicit 'default'
 * sub-account, and the `subAccountId` selector on reads/writes is ignored for
 * them end-to-end (every broker today except CCXT).
 *
 * The asymmetric case is CCXT separate-wallet venues (Binance: spot /
 * USDⓈ-M / COIN-M live behind distinct endpoints) and, in future, IBKR
 * linked / FA accounts under one login. There the SAME connection spans
 * several trading compartments, so a READ can scope to one (or aggregate
 * across all) and a WRITE must name its target — placing an order is
 * irreversible, so the ambiguity is resolved up front, never defaulted.
 *
 * `kind` is editorial taxonomy for the UI, not a routing key:
 *   - 'spot'        a cash / spot wallet
 *   - 'derivatives' a futures / swap / margin wallet
 *   - 'unified'     a single cross-margin account that IS the whole thing
 * Funding / earn / staking wallets are deliberately NOT enumerated — Alice
 * trades; it does not custody-manage them.
 */
export interface SubAccountRef {
  /** Stable id used as the `subAccountId` selector, e.g. 'spot', 'derivatives'. */
  id: string
  /** User-facing label, e.g. 'Spot', 'USDⓈ-M Futures'. */
  label: string
  kind: 'spot' | 'derivatives' | 'unified'
}

// ==================== Market data ====================

/**
 * Real-time tick data from the broker. Monetary fields are strings —
 * trading-side numerics stay in Decimal-as-string end-to-end.
 * (Distinct from `domain/market-data` Quote types, which serve the
 * read-only analysis surface and stay number-typed there.)
 */
export interface Quote {
  contract: Contract
  last: string
  bid: string
  ask: string
  volume: string
  high?: string
  low?: string
  timestamp: Date
}

export interface MarketClock {
  isOpen: boolean
  nextOpen?: Date
  nextClose?: Date
  timestamp?: Date
}

/**
 * Normalized bar interval — Alice-facing enum. Each broker maps this to its
 * native bar-size / period / timeframe string. Keep this list small and
 * additive; brokers declare which subset they support via
 * `AccountCapabilities.historicalBars.supportedBarSizes`.
 */
export type BarInterval = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d' | '1w'

/**
 * What price stream the bars represent. Mirrors IBKR `whatToShow`; other
 * brokers only support TRADES (the default) and ignore non-TRADES values.
 */
export type BarWhatToShow = 'TRADES' | 'MIDPOINT' | 'BID' | 'ASK'

export interface BarParams {
  /** Normalized interval; the broker maps it to its native bar size. */
  interval: BarInterval
  /** Inclusive lower bound. If omitted, the broker derives a window from `limit`. */
  start?: Date
  /** Inclusive upper bound (default: now). */
  end?: Date
  /** Max number of bars to return (most-recent-first truncation by the broker). */
  limit?: number
  /** Price-stream selector — only IBKR honors non-TRADES values; others ignore. */
  whatToShow?: BarWhatToShow
}

/**
 * One OHLCV bar. Monetary fields are strings — the trading side keeps
 * Decimal-as-string end-to-end (same convention as `Quote`/`Position`). The
 * read-only analysis surface (`domain/market-data`) converts to number at its
 * own boundary.
 */
export interface Bar {
  /** Bar open time (UTC). */
  timestamp: Date
  open: string
  high: string
  low: string
  close: string
  /** Base-asset volume for the bar. */
  volume: string
}

// ==================== Broker health ====================

export type BrokerHealth = 'healthy' | 'degraded' | 'offline'

/**
 * Operational reach — the capability ladder a UTA can currently climb. Health
 * is NOT a single "connected?" boolean: connecting, reading account data, and
 * writing orders are three different things.
 *   - 'down'      transport unreachable (can't load markets / open the socket)
 *   - 'connected' broker reachable + PUBLIC market data available (no key) —
 *                 this is full health for a keyless data source
 *   - 'readable'  PRIVATE account read works (auth OK); implies connected
 * Writing is not a reach level (we never place a probe order) — it's
 * `tier === 'trading'`, gated at order time.
 */
export type UTAReach = 'down' | 'connected' | 'readable'

/**
 * What an account is FOR (static, from config) — drives the target reach the
 * recovery loop aims at, and the UI badge:
 *   - 'data'    keyless public-data source        → target reach 'connected'
 *   - 'account' funded but read-only              → target reach 'readable'
 *   - 'trading' funded + writable                 → target reach 'readable'
 */
export type UTATier = 'data' | 'account' | 'trading'

export interface BrokerHealthInfo {
  status: BrokerHealth
  /** Current operational reach on the capability ladder. */
  reach: UTAReach
  /** What this account is for (static). Recovery aims for this account's target
   *  reach — a keyless 'data' account is healthy at 'connected', and never
   *  probes account-read, so it no longer loops on "requires apiKey". */
  tier: UTATier
  consecutiveFailures: number
  lastError?: string
  lastSuccessAt?: Date
  lastFailureAt?: Date
  recovering: boolean
  /** True while the account's INITIAL broker connect is still in flight (e.g.
   *  CCXT loadMarkets, which can take tens of seconds). During this window
   *  `status` is optimistically 'healthy' (reach defaults to target) but the
   *  broker isn't actually ready, so reads return a transient CONNECTING marker
   *  instead of blocking. The UI shows a "connecting…" state off this flag —
   *  `status`/`reach` alone can't distinguish it from a genuinely-ready account. */
  connecting: boolean
  disabled: boolean
}

/**
 * Optional transport signal from a broker adapter to its owning UTA.
 *
 * `dead` is authoritative and must take health offline immediately. `restored`
 * is only a hint to retry now (IBKR 1101/1102); it is not proof that private
 * account reads work again. `alive` is emitted only after the adapter has
 * completed its own reconnect/readiness handshake.
 */
export interface BrokerConnectionStateEvent {
  state: 'alive' | 'dead' | 'restored'
  error?: string
}

// ==================== Account capabilities ====================

/**
 * Historical-bar capability, carrying entitlement/quality semantics rather
 * than a bare boolean:
 *   - 'realtime'     full-quality exchange data (CCXT free public OHLCV)
 *   - 'iex'          IEX-only feed, partial tape (Alpaca free tier)
 *   - 'delayed'      15-min delayed (IBKR without a market-data subscription)
 *   - 'subscription' full data, gated on an active subscription
 */
export interface HistoricalBarsCapability {
  supported: boolean
  quality?: 'realtime' | 'iex' | 'delayed' | 'subscription'
  /** Subset of BarInterval this broker actually maps to a native bar size. */
  supportedBarSizes?: BarInterval[]
}

export interface AccountCapabilities {
  supportedSecTypes: string[]
  supportedOrderTypes: string[]
  /** Absent ⇒ no historical-bar support (loud-refuse on getHistorical). */
  historicalBars?: HistoricalBarsCapability
}

// ==================== Broker config field descriptor ====================

/** Describes a single config field for a broker type — used by the frontend to dynamically render forms. */
export interface BrokerConfigField {
  name: string
  type: 'text' | 'password' | 'number' | 'boolean' | 'select'
  label: string
  placeholder?: string
  default?: unknown
  required?: boolean
  options?: Array<{ value: string; label: string }>
  description?: string
  /** True for secrets (apiKey, etc.) — backend masks these in API responses. */
  sensitive?: boolean
}

// ==================== Take Profit / Stop Loss ====================

export interface TpSlParams {
  takeProfit?: { price: string }
  stopLoss?: { price: string; limitPrice?: string }
}

// ==================== IBroker ====================

export interface IBroker<TMeta = unknown> {
  /** Unique account ID, e.g. "alpaca-paper", "bybit-main". */
  readonly id: string

  /** User-facing display name. */
  readonly label: string

  /** Runtime adapter identity. Live engines are supplied by optional packs. */
  readonly brokerEngine?: string

  /** Broker-specific metadata. Generic allows typed access in implementations. */
  readonly meta?: TMeta

  // ---- Lifecycle ----

  init(): Promise<void>
  close(): Promise<void>

  /** Optional push signal for transports with an active heartbeat. */
  setConnectionStateListener?(
    listener: ((event: BrokerConnectionStateEvent) => void) | null,
  ): void

  // ---- Contract search (IBKR: reqMatchingSymbols + reqContractDetails) ----

  searchContracts(pattern: string): Promise<ContractDescription[]>
  getContractDetails(query: Contract): Promise<ContractDetails | null>

  /**
   * Expand a directory-style nativeKey (bond issuer, FX family) or a leaf's
   * derivative family (option chain, futures months) into tradeable leaves.
   * Optional — venues without hub semantics leave it undefined; the UTA
   * layer loud-refuses.
   */
  expandContract?(nativeKey: string, filters?: ExpandContractFilters): Promise<ContractExpansion>

  /**
   * Refresh the broker's local catalog cache from upstream.
   * Optional — only EnumeratingCatalog brokers (Alpaca / CCXT / Mock)
   * implement this. SearchingCatalog brokers (IBKR via reqMatchingSymbols)
   * leave it undefined; the cron loop in main.ts skips them via `?.`.
   *
   * Implementations should keep the prior cache on failure and let the
   * exception propagate so the caller can log.
   */
  refreshCatalog?(): Promise<void>

  // ---- Trading operations (IBKR Order as source of truth) ----

  placeOrder(contract: Contract, order: Order, tpsl?: TpSlParams): Promise<PlaceOrderResult>
  modifyOrder(orderId: string, changes: Partial<Order>): Promise<PlaceOrderResult>
  cancelOrder(orderId: string, orderCancel?: OrderCancel): Promise<PlaceOrderResult>
  closePosition(contract: Contract, quantity?: Decimal): Promise<PlaceOrderResult>

  // ---- Sub-accounts (wallets / compartments within one connection) ----

  /**
   * Enumerate the sub-accounts this connection spans. OPTIONAL — a broker that
   * omits it is treated as having a single implicit 'default' sub-account, and
   * the `subAccountId` selector is ignored for it (every broker today except
   * CCXT separate-wallet venues). Implementations return >1 ONLY for genuinely
   * separate-wallet venues (CCXT Binance: spot / USDⓈ-M / COIN-M). Trading
   * compartments only — funding / earn wallets are never enumerated.
   */
  listSubAccounts?(): Promise<SubAccountRef[]>

  /**
   * Which sub-account id a given contract trades in — derived from the
   * INSTRUMENT (CCXT: a spot symbol vs a perp symbol route to different
   * wallets). OPTIONAL — the UTA layer uses it to validate that a write's
   * declared `subAccountId` is consistent with the instrument, so "place this
   * on spot" with a perp contract loud-refuses instead of silently landing in
   * the wrong wallet. Brokers with a single sub-account omit it.
   */
  subAccountForContract?(contract: Contract): string | undefined

  // ---- Queries ----

  /**
   * Account equity. `subAccountId` OPTIONAL: omitted ⇒ AGGREGATE across every
   * sub-account (the rolled-up netLiquidation); a specific id ⇒ just that
   * wallet. Single-sub-account brokers ignore the arg.
   */
  getAccount(subAccountId?: string): Promise<AccountInfo>
  /**
   * Positions / holdings. `subAccountId` OPTIONAL: omitted ⇒ ALL sub-accounts;
   * a specific id ⇒ just that wallet's positions. Single-sub-account brokers
   * ignore the arg.
   */
  getPositions(subAccountId?: string): Promise<Position[]>
  getOrders(orderIds: string[]): Promise<OpenOrder[]>
  /**
   * Look up a single order. `symbolHint` is the broker-native localSymbol
   * recorded with the order's git operation — brokers whose order-lookup
   * API is symbol-scoped (CCXT fetchOrder) use it to survive process
   * restarts, where any in-memory orderId→symbol cache is gone. Brokers
   * with globally-unique order ids may ignore it.
   */
  getOrder(orderId: string, symbolHint?: string): Promise<OpenOrder | null>
  /**
   * List ALL currently-open orders on the account — including ones Alice
   * never placed (user trading on the exchange app directly). Optional:
   * brokers without a broad open-orders API simply don't declare it, and
   * external-order observation degrades to off for that account. Returns
   * an empty array (never throws) when the venue can't enumerate without
   * extra scoping the broker doesn't have.
   */
  getOpenOrders?(): Promise<OpenOrder[]>
  getQuote(contract: Contract): Promise<Quote>
  getMarketClock(): Promise<MarketClock>

  /**
   * Historical OHLCV bars. Optional — brokers without time-series data
   * (e.g. LeverUp/Pyth) leave it undefined and declare no `historicalBars`
   * capability; `UnifiedTradingAccount.getHistorical` loud-refuses with a
   * `BrokerError('CONFIG', ...)` rather than silently returning `[]`. Each
   * implementation maps `BarParams.interval` to its native bar size.
   */
  getHistorical?(contract: Contract, params: BarParams): Promise<Bar[]>

  /**
   * The asset class a contract belongs to, decided by the VENUE — not by the
   * instrument's claimed type. A crypto exchange's "AAPL" is a synthetic /
   * custodial token, so CcxtBroker reports everything as 'crypto' regardless of
   * secType; IBKR/Alpaca map per real instrument. Optional — when absent, the
   * consumer falls back to a secType heuristic (which is broker-blind and wrong
   * for e.g. a CCXT dated future, hence this hook).
   */
  assetClassFor?(contract: Contract): 'equity' | 'crypto' | 'currency' | 'commodity' | 'unknown'

  // ---- Capabilities ----

  getCapabilities(): AccountCapabilities

  // ---- Contract identity ----

  /** Extract the broker-native unique key from a contract (for aliceId construction).
   *  Each broker defines its own uniqueness: Alpaca = ticker, CCXT = unified symbol, IBKR = conId. */
  getNativeKey(contract: Contract): string

  /** Reconstruct a trade-ready contract from a nativeKey (for aliceId resolution).
   *  Broker fills in secType, exchange, currency, conId, etc. as needed. */
  resolveNativeKey(nativeKey: string): Contract
}
