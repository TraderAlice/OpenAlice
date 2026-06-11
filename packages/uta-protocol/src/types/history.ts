/**
 * Trader-facing projections of the Trading-as-Git commit log.
 *
 * The git log is the faithful narrative (operations + results + sync
 * updates); these are the exchange-frontend views of it: Order History
 * (every order's lifecycle collapsed to one row) and Trade History (fills
 * only). Projection lives in the UTA domain so every surface — UI, MCP
 * tools, CLI — reads the same translation.
 *
 * Contract fields follow the IBKR superset deliberately: options/futures
 * (strike / right / expiry / multiplier) must render correctly the day
 * they arrive, not get retrofitted around a crypto-shaped subset.
 */

/** Compact contract identity for history rows — IBKR-superset fields. */
export interface HistoryContract {
  aliceId?: string
  symbol?: string
  localSymbol?: string
  secType?: string
  currency?: string
  exchange?: string
  /** OPT/FOP/FUT: contract month or expiry (IBKR lastTradeDateOrContractMonth). */
  expiry?: string
  /** OPT/FOP: strike price (string — Decimal-safe). */
  strike?: string
  /** OPT/FOP: 'C' | 'P' (normalized). */
  right?: string
  multiplier?: string
}

export type OrderHistoryStatus = 'submitted' | 'filled' | 'cancelled' | 'rejected' | 'user-rejected'

export type OrderHistorySource = 'alice' | 'external'

export interface OrderHistoryEntry {
  /** Broker order id (absent for rejected-before-submit). */
  orderId?: string
  /** When the order entered the log (push/observe time, ISO). */
  timestamp: string
  /** When the terminal transition was recorded, if any (sync/cancel time, ISO). */
  resolvedAt?: string
  contract: HistoryContract
  side: 'BUY' | 'SELL'
  orderType?: string
  quantity?: string
  limitPrice?: string
  stopPrice?: string
  status: OrderHistoryStatus
  filledQty?: string
  avgFillPrice?: string
  /** 'external' = observed on the broker, not placed through Alice. */
  source: OrderHistorySource
  /** Commit that introduced the order — the audit pointer. */
  commitHash: string
  /** Commit message (user intent for Alice orders; [observed] for external). */
  message: string
  error?: string
}

export type TradeHistorySource = 'order' | 'external' | 'reconcile'

export interface TradeHistoryEntry {
  /** Fill record time (ISO) — push time for immediate fills, sync time otherwise. */
  timestamp: string
  orderId?: string
  contract: HistoryContract
  side: 'BUY' | 'SELL'
  quantity: string
  price: string
  /** quantity × price × multiplier (string — Decimal-safe). */
  value: string
  /** 'reconcile' = balance drift folded in at observed price, not a real fill record. */
  source: TradeHistorySource
  commitHash: string
}
