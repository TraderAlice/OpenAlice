/**
 * INDstocks (INDmoney) broker — config + raw API shapes.
 *
 * Source: https://api-docs.indstocks.com  (base https://api.indstocks.com)
 *
 * NOTE ON CREDENTIALS: INDstocks (like every SEBI-regulated Indian broker)
 * issues an access token that EXPIRES EVERY 24h and can only be regenerated
 * manually from web.indstocks.com — there is no refresh endpoint. So:
 *   - `accessToken` is the daily-rotated secret (writeOnly in the preset).
 *   - `userId` is the STABLE identity (INDstocks client id) and is what we
 *     fingerprint the UTA on — fingerprinting the token would mint a brand-new
 *     account id (and orphan the git commit log) every single day.
 *
 * Field names below mirror the documented JSON. They are marked best-effort:
 * the public docs don't publish full response schemas, so confirm against a
 * live response before trusting any individual field. (TODO: verify live.)
 */

export interface IndstocksBrokerConfig {
  id?: string
  label?: string
  /** Daily-rotated access token (Authorization header, no "Bearer" prefix). */
  accessToken: string
  /** Stable INDstocks client/user id — used for identity, NOT auth. */
  userId: string
}

// ==================== REST raw shapes (best-effort, verify live) ====================

/** GET /user/profile — used purely as a token-validity probe at init(). */
export interface IndstocksProfileRaw {
  status: string
  data?: {
    user_id?: string
    email?: string
    first_name?: string
    last_name?: string
    ucc?: string
    is_nse_onboarded?: boolean
    is_bse_onboarded?: boolean
  }
}

/** GET /funds (verified live shape). All values are numbers, INR. */
export interface IndstocksFundsRaw {
  status: string
  data: {
    sod_balance?: number          // start-of-day balance
    withdrawal_balance?: number   // withdrawable cash
    realized_pnl?: number
    unrealized_pnl?: number
    brokerage?: number
    /** Product-wise available balance. */
    detailed_avl_balance?: {
      eq_cnc?: number
      eq_mis?: number
      eq_mtf?: number
      [k: string]: number | undefined
    }
    [k: string]: unknown
  }
}

/**
 * GET /portfolio/holdings — delivery (Demat) holdings (verified live shape).
 * NOTE: holdings carry NO exchange and NO LTP. `security_id` is the NSE id;
 * market price must be fetched separately (we batch /market/quotes/ltp).
 */
export interface IndstocksHoldingRaw {
  symbol: string
  security_id: string
  isin?: string
  total_qty: number
  avg_price: number
  used_qty?: number
  t1_qty?: number
  dp_qty?: number
}

/** GET /portfolio/positions — intraday / F&O open positions. */
export interface IndstocksPositionRaw {
  trading_symbol?: string
  security_id?: string
  exchange?: string
  segment?: string
  product?: string
  net_quantity: string | number
  average_price: string | number
  last_traded_price: string | number
  market_value?: string | number
  pnl_absolute?: string | number
  multiplier?: string | number
}

/** POST /order response. */
export interface IndstocksPlaceOrderRaw {
  status: string
  data?: {
    order_id: string
    order_status: string
  }
  message?: string
}

/** GET /order / GET /order-book row. */
export interface IndstocksOrderRaw {
  order_id: string
  security_id?: string
  trading_symbol?: string
  exchange?: string
  segment?: string
  product?: string
  txn_type: string            // BUY | SELL
  order_type: string          // LIMIT | MARKET
  validity?: string           // DAY | IOC
  order_status: string        // see IND_ORDER_STATUS map
  qty: string | number
  filled_qty?: string | number
  remaining_qty?: string | number
  limit_price?: string | number
  average_price?: string | number   // avg fill price
  reject_reason?: string | null
}

/**
 * POST /smart/order response (GTT / multi-leg). `order_data` holds the parent
 * order(s); each may carry a `child_order_details` GTT leg (the SL/TP trigger
 * that arms only after the parent fills).
 */
export interface IndstocksSmartOrderRaw {
  status: string
  message?: string
  data?: {
    order_data?: Array<{
      order_id: string
      order_status: string
      child_order_details?: {
        order_id: string
        order_status: string
      }
    }>
  }
}

/**
 * Order-update message pushed over wss://ws-order-updates.indstocks.com.
 * `type` is "order"; heartbeats arrive without these fields and are ignored.
 */
export interface IndstocksOrderUpdate {
  type?: string
  order_id: string
  order_status: string
  filled_quantity?: number
  remaining_quantity?: number
  average_price?: number
  timestamp?: number
}

/** One bid/ask level inside market_depth (prices/qtys are comma-strings). */
export interface IndstocksDepthLevel {
  buy: { quantity: string; price: string }
  sell: { quantity: string; price: string }
}

/**
 * GET /market/quotes/full row, keyed by scrip-code in the response map
 * (verified live shape). bid/ask are NOT top-level — they live in
 * `market_depth[scrip].depth[0]` as comma-formatted strings ("1,318.10").
 */
export interface IndstocksQuoteRaw {
  live_price?: number
  day_open?: number
  day_high?: number
  day_low?: number
  prev_close?: number
  volume?: number
  market_depth?: Record<string, { depth?: IndstocksDepthLevel[] }>
}

/** GET /market/quotes/ltp row — just the live price. */
export interface IndstocksLtpRaw {
  live_price?: number
}

/** One row of the GET /market/instruments CSV master after parsing. */
export interface IndstocksInstrument {
  securityId: string          // SECURITY_ID  — used in order/quote calls
  tradingSymbol: string       // TRADING_SYMBOL — e.g. "RELIANCE"
  exch: string                // EXCH — NSE | BSE
  segment: string             // SEGMENT — E (equity) | FNO
  instrumentName: string      // INSTRUMENT_NAME — EQUITY | FUTSTK | ...
  customSymbol?: string       // CUSTOM_SYMBOL — descriptive name
  lotUnits?: string           // LOT_UNITS — F&O lot size
  tickSize?: string           // TICK_SIZE
}

/** Historical candle: [timestamp(ms), open, high, low, close, volume]. */
export type IndstocksCandle = [number, number, number, number, number, number]
