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

// ==================== Position ====================

/**
 * Unified position/holding.
 * Field names aligned with IBKR EWrapper.updatePortfolio() parameters.
 */
export interface Position {
  contract: Contract
  side: 'long' | 'short'
  quantity: Decimal
  avgCost: number
  marketPrice: number
  marketValue: number
  unrealizedPnL: number
  realizedPnL: number
  leverage?: number
  margin?: number
  liquidationPrice?: number
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
}

// ==================== Account info ====================

/** Field names aligned with IBKR AccountSummaryTags. */
export interface AccountInfo {
  netLiquidation: number
  totalCashValue: number
  unrealizedPnL: number
  realizedPnL: number
  buyingPower?: number
  initMarginReq?: number
  maintMarginReq?: number
  dayTradesRemaining?: number
}

// ==================== Market data ====================

export interface Quote {
  contract: Contract
  last: number
  bid: number
  ask: number
  volume: number
  high?: number
  low?: number
  timestamp: Date
}

export interface FundingRate {
  contract: Contract
  fundingRate: number
  nextFundingTime?: Date
  previousFundingRate?: number
  timestamp: Date
}

/** [price, amount] */
export type OrderBookLevel = [price: number, amount: number]

export interface OrderBook {
  contract: Contract
  bids: OrderBookLevel[]
  asks: OrderBookLevel[]
  timestamp: Date
}

export interface MarketClock {
  isOpen: boolean
  nextOpen?: Date
  nextClose?: Date
  timestamp?: Date
}

// ==================== Account capabilities ====================

export interface AccountCapabilities {
  supportedSecTypes: string[]
  supportedOrderTypes: string[]
}

// ==================== IBroker ====================

export interface IBroker {
  /** Unique account ID, e.g. "alpaca-paper", "bybit-main". */
  readonly id: string

  /** Provider name, e.g. "alpaca", "ccxt". */
  readonly provider: string

  /** User-facing display name. */
  readonly label: string

  // ---- Lifecycle ----

  init(): Promise<void>
  close(): Promise<void>

  // ---- Contract search (IBKR: reqMatchingSymbols + reqContractDetails) ----

  searchContracts(pattern: string): Promise<ContractDescription[]>
  getContractDetails(query: Contract): Promise<ContractDetails | null>

  // ---- Trading operations (IBKR Order as source of truth) ----

  placeOrder(contract: Contract, order: Order): Promise<PlaceOrderResult>
  modifyOrder(orderId: string, changes: Order): Promise<PlaceOrderResult>
  cancelOrder(orderId: string, orderCancel?: OrderCancel): Promise<boolean>
  closePosition(contract: Contract, quantity?: Decimal): Promise<PlaceOrderResult>

  // ---- Queries ----

  getAccount(): Promise<AccountInfo>
  getPositions(): Promise<Position[]>
  getOrders(): Promise<OpenOrder[]>
  getQuote(contract: Contract): Promise<Quote>
  getMarketClock(): Promise<MarketClock>

  // ---- Capabilities ----

  getCapabilities(): AccountCapabilities
}
