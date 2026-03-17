export interface CcxtBrokerConfig {
  id?: string
  label?: string
  exchange: string
  apiKey: string
  apiSecret: string
  password?: string
  sandbox: boolean
  demoTrading?: boolean
  defaultMarketType: 'spot' | 'swap'
  options?: Record<string, unknown>
}

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

export const MAX_INIT_RETRIES = 8
export const INIT_RETRY_BASE_MS = 500
