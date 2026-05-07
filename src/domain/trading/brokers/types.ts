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
import '../contract-ext.js'

// ==================== Errors ====================

export type BrokerErrorCode = 'CONFIG' | 'AUTH' | 'NETWORK' | 'EXCHANGE' | 'MARKET_CLOSED' | 'UNKNOWN'

/**
 * Structured broker error.
 * - `permanent` errors (CONFIG, AUTH) disable the account — will not be retried.
 * - Transient errors (NETWORK, EXCHANGE, MARKET_CLOSED) trigger auto-recovery.
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
    const code = BrokerError.classifyMessage(msg) ?? fallbackCode
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
}

// ==================== Order result ====================

/** Result of placeOrder / modifyOrder / closePosition. */
export interface PlaceOrderResult {
  success: boolean
  orderId?: string
  error?: string
  message?: string
  execution?: Execution
  orderState?: OrderState
}

/** An open/completed order triplet as returned by getOrders(). */
export interface OpenOrder {
  contract: Contract
  order: Order
  orderState: OrderState
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

// ==================== Broker health ====================

export type BrokerHealth = 'healthy' | 'degraded' | 'offline'

export interface BrokerHealthInfo {
  status: BrokerHealth
  consecutiveFailures: number
  lastError?: string
  lastSuccessAt?: Date
  lastFailureAt?: Date
  recovering: boolean
  disabled: boolean
}

// ==================== Account capabilities ====================

export interface AccountCapabilities {
  supportedSecTypes: string[]
  supportedOrderTypes: string[]
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

  /** Broker-specific metadata. Generic allows typed access in implementations. */
  readonly meta?: TMeta

  // ---- Lifecycle ----

  init(): Promise<void>
  close(): Promise<void>

  // ---- Contract search (IBKR: reqMatchingSymbols + reqContractDetails) ----

  searchContracts(pattern: string): Promise<ContractDescription[]>
  getContractDetails(query: Contract): Promise<ContractDetails | null>

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

  // ---- Queries ----

  getAccount(): Promise<AccountInfo>
  getPositions(): Promise<Position[]>
  getOrders(orderIds: string[]): Promise<OpenOrder[]>
  getOrder(orderId: string): Promise<OpenOrder | null>
  getQuote(contract: Contract): Promise<Quote>
  getMarketClock(): Promise<MarketClock>

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
