export interface CcxtBrokerConfig {
  id?: string
  label?: string
  exchange: string
  /** Public-data-only — skip credential validation in init() (no key needed). */
  keyless?: boolean
  sandbox: boolean
  demoTrading?: boolean
  options?: Record<string, unknown>
  // CCXT standard credential fields (all optional — each exchange requires a different subset)
  apiKey?: string
  secret?: string
  uid?: string
  accountId?: string
  login?: string
  password?: string
  twofa?: string
  privateKey?: string
  walletAddress?: string
  token?: string
}

/** CCXT standard credential field names (matches base Exchange.requiredCredentials map). */
export const CCXT_CREDENTIAL_FIELDS = [
  'apiKey', 'secret', 'uid', 'accountId', 'login',
  'password', 'twofa', 'privateKey', 'walletAddress', 'token',
] as const

export type CcxtCredentialField = typeof CCXT_CREDENTIAL_FIELDS[number]

export interface CcxtMarket {
  id: string        // exchange-native symbol, e.g. "BTCUSDT"
  symbol: string    // CCXT unified format, e.g. "BTC/USDT:USDT"
  base: string      // e.g. "BTC"
  quote: string     // e.g. "USDT"
  type: string      // "spot" | "swap" | "future" | "option"
  settle?: string   // e.g. "USDT" (for derivatives)
  active?: boolean
  precision?: { price?: number; amount?: number }
}

// Init-retry budget. Defaults are tuned for production where transient
// network blips warrant aggressive retries. E2E (and any harness that can't
// tolerate a single broker burning ~140s per type) overrides via env:
//   CCXT_INIT_RETRIES=2 CCXT_INIT_RETRY_BASE_MS=250
function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}
export const MAX_INIT_RETRIES = envInt('CCXT_INIT_RETRIES', 8)
export const INIT_RETRY_BASE_MS = envInt('CCXT_INIT_RETRY_BASE_MS', 500)

// ==================== CCXT-specific types (not part of IBroker) ====================

import type { Contract } from '@traderalice/ibkr'

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
