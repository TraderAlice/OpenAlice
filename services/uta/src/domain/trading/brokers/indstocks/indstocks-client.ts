/**
 * Thin REST client for the INDstocks API. There is no maintained official
 * Node SDK, so this hand-rolls fetch calls against the documented endpoints.
 *
 * Auth: `Authorization: <accessToken>` header (NO "Bearer" prefix — per docs).
 * Token expiry surfaces as HTTP 403 `TokenException`; `request()` maps that to
 * a permanent BrokerError('AUTH') so the UTA recovery loop DISABLES the account
 * (stops retry-spamming) and the health surface tells the user to regenerate
 * the token at web.indstocks.com.
 */

import { BrokerError } from '../types.js'
import type {
  IndstocksFundsRaw,
  IndstocksHoldingRaw,
  IndstocksPositionRaw,
  IndstocksProfileRaw,
  IndstocksPlaceOrderRaw,
  IndstocksSmartOrderRaw,
  IndstocksOrderRaw,
  IndstocksQuoteRaw,
  IndstocksLtpRaw,
  IndstocksInstrument,
  IndstocksCandle,
} from './indstocks-types.js'

const BASE_URL = 'https://api.indstocks.com'

/** Body for POST /order. */
export interface IndPlaceOrderBody {
  txn_type: 'BUY' | 'SELL'
  exchange: string            // NSE | BSE
  segment: string             // EQUITY | DERIVATIVE
  product: string             // CNC | INTRADAY | MARGIN
  order_type: string          // LIMIT | MARKET
  validity: string            // DAY | IOC
  security_id: string
  qty: number
  algo_id: string
  limit_price?: number
  is_amo?: boolean
}

/**
 * Body for POST /smart/order — the entry order plus optional GTT SL/TP legs.
 * Both leg pairs present ⇒ OCO. The legs arm only after the parent fills.
 */
export interface IndSmartOrderBody extends IndPlaceOrderBody {
  /** TRIGGER also valid here in addition to LIMIT/MARKET. */
  trigger_price?: number
  trigger_limit_price?: number
  /** Stop-loss leg. */
  sl_trigger_price?: number
  sl_limit_price?: number
  /** Target / take-profit leg. */
  tgt_trigger_price?: number
  tgt_limit_price?: number
}

export class IndstocksClient {
  constructor(private accessToken: string) {}

  /** Swap in a freshly-pasted daily token without rebuilding the broker. */
  setToken(token: string): void {
    this.accessToken = token
  }

  private headers(): Record<string, string> {
    return {
      Authorization: this.accessToken,      // no "Bearer" prefix (per docs)
      'Content-Type': 'application/json',
    }
  }

  /** Core request → JSON. Maps 403/TokenException to a permanent AUTH error. */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: this.headers(),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      })
    } catch (err) {
      // Transport failure → transient NETWORK (recovery loop retries).
      throw BrokerError.from(err, 'NETWORK')
    }

    if (res.status === 403) {
      // TokenException — daily token expired/invalid/revoked. Permanent so the
      // account is disabled until the user pastes a fresh token. (Daily wall.)
      throw new BrokerError(
        'AUTH',
        'INDstocks access token expired or invalid. Tokens last 24h — regenerate at ' +
        'web.indstocks.com → API, then update this account in Settings.',
      )
    }
    if (res.status === 401) {
      throw new BrokerError('AUTH', 'INDstocks rejected the access token (401).')
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw BrokerError.from(new Error(`INDstocks ${method} ${path} → ${res.status} ${text}`))
    }
    return res.json() as Promise<T>
  }

  /** GET text (for the CSV instruments master). */
  private async requestText(path: string): Promise<string> {
    const res = await fetch(`${BASE_URL}${path}`, { method: 'GET', headers: this.headers() })
    if (res.status === 403 || res.status === 401) {
      throw new BrokerError('AUTH', 'INDstocks token expired/invalid — regenerate at web.indstocks.com.')
    }
    if (!res.ok) throw BrokerError.from(new Error(`INDstocks GET ${path} → ${res.status}`))
    return res.text()
  }

  // ---- Account / token ----

  /** Token-validity probe. Used at init(). */
  getProfile(): Promise<IndstocksProfileRaw> {
    return this.request('GET', '/user/profile')
  }

  getFunds(): Promise<IndstocksFundsRaw> {
    return this.request('GET', '/funds')
  }

  // ---- Portfolio ----

  getHoldings(): Promise<{ data: IndstocksHoldingRaw[] }> {
    return this.request('GET', '/portfolio/holdings')
  }

  getPositions(segment?: 'equity' | 'derivative'): Promise<{ data: IndstocksPositionRaw[] }> {
    const q = segment ? `?segment=${segment}` : ''
    return this.request('GET', `/portfolio/positions${q}`)
  }

  // ---- Orders ----

  placeOrder(body: IndPlaceOrderBody): Promise<IndstocksPlaceOrderRaw> {
    return this.request('POST', '/order', body)
  }

  modifyOrder(body: Record<string, unknown>): Promise<IndstocksPlaceOrderRaw> {
    return this.request('POST', '/order/modify', body)
  }

  cancelOrder(orderId: string): Promise<IndstocksPlaceOrderRaw> {
    return this.request('POST', '/order/cancel', { order_id: orderId })
  }

  // ---- Smart orders (GTT — stop-loss / target legs) ----

  placeSmartOrder(body: IndSmartOrderBody): Promise<IndstocksSmartOrderRaw> {
    return this.request('POST', '/smart/order', body)
  }

  modifySmartOrder(body: Record<string, unknown>): Promise<IndstocksSmartOrderRaw> {
    return this.request('POST', '/smart/order/modify', body)
  }

  cancelSmartOrder(orderId: string): Promise<IndstocksSmartOrderRaw> {
    return this.request('POST', '/smart/order/cancel', { order_id: orderId })
  }

  getOrder(orderId: string): Promise<{ data: IndstocksOrderRaw }> {
    return this.request('GET', `/order?order_id=${encodeURIComponent(orderId)}`)
  }

  getOrderBook(): Promise<{ data: IndstocksOrderRaw[] }> {
    return this.request('GET', '/order-book')
  }

  // ---- Market data ----

  /** Full quotes for up to 1000 scrip-codes (`NSE_3045,NFO_51011`). */
  getQuotes(scripCodes: string[]): Promise<{ data: Record<string, IndstocksQuoteRaw> }> {
    const q = encodeURIComponent(scripCodes.join(','))
    return this.request('GET', `/market/quotes/full?scrip-codes=${q}`)
  }

  /** Lightweight last-traded-price for up to 1000 scrip-codes. */
  getLtp(scripCodes: string[]): Promise<{ data: Record<string, IndstocksLtpRaw> }> {
    const q = encodeURIComponent(scripCodes.join(','))
    return this.request('GET', `/market/quotes/ltp?scrip-codes=${q}`)
  }

  /** GET /market/historical/{interval}. Times are epoch milliseconds. */
  getHistorical(
    interval: string,
    scripCode: string,
    startMs: number,
    endMs: number,
  ): Promise<{ data: IndstocksCandle[] }> {
    const q = `scrip-codes=${encodeURIComponent(scripCode)}&start_time=${startMs}&end_time=${endMs}`
    return this.request('GET', `/market/historical/${interval}?${q}`)
  }

  /**
   * Instruments master (CSV). `source` ∈ equity | fno | index.
   * Naive CSV parse (split on newlines/commas) — fine for the documented
   * comma-only master. TODO: swap for a quote-aware CSV parser if any field
   * can contain commas.
   */
  async getInstruments(source: 'equity' | 'fno' | 'index'): Promise<IndstocksInstrument[]> {
    const csv = await this.requestText(`/market/instruments?source=${source}`)
    const lines = csv.trim().split(/\r?\n/)
    if (lines.length < 2) return []
    const header = lines[0].split(',').map(h => h.trim())
    const idx = (name: string) => header.indexOf(name)
    const iSec = idx('SECURITY_ID')
    const iSym = idx('TRADING_SYMBOL')
    const iExch = idx('EXCH')
    const iSeg = idx('SEGMENT')
    const iName = idx('INSTRUMENT_NAME')
    const iCustom = idx('CUSTOM_SYMBOL')
    const iLot = idx('LOT_UNITS')
    const iTick = idx('TICK_SIZE')

    const out: IndstocksInstrument[] = []
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(',')
      if (!c[iSec] || !c[iSym]) continue
      out.push({
        securityId: c[iSec].trim(),
        tradingSymbol: c[iSym].trim(),
        exch: (c[iExch] ?? '').trim(),
        segment: (c[iSeg] ?? '').trim(),
        instrumentName: (c[iName] ?? '').trim(),
        customSymbol: iCustom >= 0 ? c[iCustom]?.trim() : undefined,
        lotUnits: iLot >= 0 ? c[iLot]?.trim() : undefined,
        tickSize: iTick >= 0 ? c[iTick]?.trim() : undefined,
      })
    }
    return out
  }
}
