import Decimal from 'decimal.js'
import type { Position } from '../types.js'
import { buildContract, buildPosition } from '../contract-builder.js'

export interface SnapTradeConnection {
  id: string
  brokerage: { slug: string; display_name?: string | null }
  type: 'read' | 'trade'
  disabled: boolean
  data_freshness_mode?: 'realtime' | 'delayed' | string
}

export interface SnapTradePositionResponse {
  results: SnapTradeRawPosition[]
  data_freshness?: { as_of?: string }
}

export interface SnapTradeRawPosition {
  instrument: {
    id: string
    kind: string
    symbol: string
    raw_symbol?: string | null
    description?: string | null
    currency?: string | null
    exchange?: string | null
  }
  units: string | null
  price: string | null
  cost_basis: string | null
  currency?: string | null
  cash_equivalent?: boolean
}

export type SnapTradeConnectionReadiness =
  | { eligible: true; freshness: 'realtime' }
  | { eligible: false; reason: 'disabled' | 'not_read_only' | 'delayed' | 'unknown_freshness' }

/**
 * The unattended monitor must call this before considering a SnapTrade account
 * covered. A successful stale response is explicitly not an eligible result.
 */
export function assessSnapTradeConnection(connection: SnapTradeConnection): SnapTradeConnectionReadiness {
  if (connection.disabled) return { eligible: false, reason: 'disabled' }
  if (connection.type !== 'read') return { eligible: false, reason: 'not_read_only' }
  if (connection.data_freshness_mode === 'realtime') return { eligible: true, freshness: 'realtime' }
  if (connection.data_freshness_mode === 'delayed') return { eligible: false, reason: 'delayed' }
  return { eligible: false, reason: 'unknown_freshness' }
}

/** Map stock-like SnapTrade positions to the UTA model. Options/futures need
 * their dedicated contract metadata path and are intentionally rejected here
 * rather than being silently misclassified as stock. */
export function mapSnapTradeEquityPosition(raw: SnapTradeRawPosition): Position {
  if (!['stock', 'etf', 'adr', 'cef', 'mutualfund'].includes(raw.instrument.kind)) {
    throw new Error(`SnapTrade position ${raw.instrument.symbol} has unsupported kind ${raw.instrument.kind}`)
  }
  if (raw.cash_equivalent) {
    throw new Error(`SnapTrade cash-equivalent position ${raw.instrument.symbol} must be represented by account cash`)
  }
  if (!raw.units || !raw.price || !raw.cost_basis) {
    throw new Error(`SnapTrade position ${raw.instrument.symbol} is missing units, price, or cost basis`)
  }

  const quantity = new Decimal(raw.units)
  const side = quantity.isNegative() ? 'short' : 'long'
  const absoluteQuantity = quantity.abs()
  const currency = raw.currency ?? raw.instrument.currency ?? 'USD'
  const contract = buildContract({
    symbol: raw.instrument.raw_symbol ?? raw.instrument.symbol,
    secType: 'STK',
    exchange: raw.instrument.exchange ?? 'SMART',
    currency,
    localSymbol: raw.instrument.symbol,
    description: raw.instrument.description ?? undefined,
  })

  return buildPosition({
    contract,
    currency,
    side,
    quantity: absoluteQuantity,
    avgCost: raw.cost_basis,
    marketPrice: raw.price,
    realizedPnL: '0',
    avgCostSource: 'broker',
  })
}
