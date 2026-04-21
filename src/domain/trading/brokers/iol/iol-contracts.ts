/**
 * Contract resolution and status mapping for IOL.
 *
 * nativeKey format: "MARKET:SYMBOL" (e.g. "bCBA:GGAL") — preserves the market
 * alongside the ticker so resolveNativeKey can route orders correctly.
 * Falls back to "SYMBOL" (bCBA assumed) for legacy/compact keys.
 */

import { Contract, OrderState } from '@traderalice/ibkr'
import '../../contract-ext.js'

const DEFAULT_MARKET = 'bCBA'

/** IOL market code → IBKR exchange/currency hints. */
function marketHints(market: string): { exchange: string; currency: string } {
  switch (market) {
    case 'bCBA':  return { exchange: 'BYMA', currency: 'ARS' }
    case 'nYSE':  return { exchange: 'NYSE', currency: 'USD' }
    case 'nASDAQ':return { exchange: 'NASDAQ', currency: 'USD' }
    case 'rOFX':  return { exchange: 'ROFEX', currency: 'ARS' }
    default:      return { exchange: 'BYMA', currency: 'ARS' }
  }
}

/** Build an IBKR Contract from an IOL symbol + market. */
export function makeContract(symbol: string, market: string = DEFAULT_MARKET): Contract {
  const { exchange, currency } = marketHints(market)
  const c = new Contract()
  c.symbol = symbol.toUpperCase()
  c.secType = 'STK'
  c.exchange = exchange
  c.currency = currency
  // Encode market in localSymbol so downstream code can recover it
  c.localSymbol = symbol.toUpperCase()
  return c
}

/** Extract IOL (market, symbol) from a Contract. Returns null if not resolvable. */
export function resolveSymbol(contract: Contract, defaultMarket: string = DEFAULT_MARKET): { market: string; symbol: string } | null {
  if (!contract.symbol) return null
  // Future: allow explicit market override via contract.exchange mapping
  const market = contract.exchange === 'NYSE' ? 'nYSE'
    : contract.exchange === 'NASDAQ' ? 'nASDAQ'
    : contract.exchange === 'ROFEX' ? 'rOFX'
    : defaultMarket
  return { market, symbol: contract.symbol.toUpperCase() }
}

/** Serialize (market, symbol) into a single nativeKey string. */
export function encodeNativeKey(market: string, symbol: string): string {
  return market === DEFAULT_MARKET ? symbol.toUpperCase() : `${market}:${symbol.toUpperCase()}`
}

/** Parse a nativeKey back into (market, symbol). */
export function decodeNativeKey(nativeKey: string): { market: string; symbol: string } {
  const idx = nativeKey.indexOf(':')
  if (idx === -1) return { market: DEFAULT_MARKET, symbol: nativeKey.toUpperCase() }
  return {
    market: nativeKey.slice(0, idx),
    symbol: nativeKey.slice(idx + 1).toUpperCase(),
  }
}

/** IOL currency code → ISO code. */
export function mapCurrency(moneda: string | undefined): string {
  if (!moneda) return 'ARS'
  const m = moneda.toLowerCase()
  if (m.includes('dolar')) return 'USD'
  if (m.includes('peso')) return 'ARS'
  return moneda.toUpperCase()
}

/** Map IOL operation status to IBKR-style OrderState status. */
export function mapIolOrderStatus(estado: string): string {
  const s = (estado ?? '').toLowerCase()
  switch (s) {
    case 'terminada':
    case 'ejecutada':
      return 'Filled'
    case 'pendiente':
    case 'pendientededistribucion':
    case 'enespera':
    case 'emergencia':
      return 'Submitted'
    case 'cancelada':
    case 'anulada':
    case 'cancelaciónpendiente':
      return 'Cancelled'
    case 'rechazada':
    case 'erroneo':
      return 'Inactive'
    case 'parcialmenteoperada':
    case 'parcialmentecolocada':
      return 'Submitted'
    default:
      return 'Submitted'
  }
}

/** Build an IBKR OrderState from an IOL estado string. */
export function makeOrderState(estado: string, rejectReason?: string): OrderState {
  const s = new OrderState()
  s.status = mapIolOrderStatus(estado)
  if (rejectReason) s.rejectReason = rejectReason
  return s
}
