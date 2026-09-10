/**
 * Contract resolution helpers for Alpaca.
 *
 * Pure functions parameterized by provider string.
 * Now returns IBKR Contract class instances with aliceId extension.
 */

import { Contract, OrderState } from '@traderalice/ibkr'
import '../../contract-ext.js'
import { buildContract } from '../contract-builder.js'
import type { BarInterval } from '../types.js'

/** Normalized BarInterval → Alpaca v2 timeframe string. */
export const ALPACA_TIMEFRAME: Record<BarInterval, string> = {
  '1m': '1Min', '5m': '5Min', '15m': '15Min', '30m': '30Min',
  '1h': '1Hour', '4h': '4Hour', '1d': '1Day', '1w': '1Week',
}

/** Build venue identity without treating crypto pairs or OCC options as stocks. */
export function makeContract(ticker: string, assetClass?: string): Contract {
  ticker = ticker.toUpperCase()
  const option = /^([A-Z0-9.]+)(\d{6})([CP])(\d{8})$/.exec(ticker)
  if (option && assetClass !== 'us_equity') {
    return buildContract({
      symbol: option[1], localSymbol: ticker, secType: 'OPT', exchange: 'SMART', currency: 'USD',
      lastTradeDateOrContractMonth: `20${option[2]}`, right: option[3] as 'C' | 'P',
      strike: Number(option[4]) / 1000, multiplier: '100',
    })
  }
  if (assetClass === 'crypto' || ticker.includes('/')) {
    // Position/order APIs can return the legacy compact symbol. Only split it
    // when the venue explicitly identifies it as crypto.
    const symbol = ticker.includes('/') ? ticker : ticker.replace(/(USDT|USDC|USD|BTC)$/, '/$1')
    if (!symbol.includes('/')) throw new Error(`Unrecognized Alpaca crypto pair: ${ticker}`)
    return buildContract({ symbol, secType: 'CRYPTO', exchange: 'ALPACA', currency: symbol.split('/')[1] })
  }
  return buildContract({ symbol: ticker, secType: 'STK', exchange: 'SMART', currency: 'USD' })
}

export function resolveSymbol(contract: Contract): string | null {
  if (contract.secType === 'OPT') return contract.localSymbol || null
  if (contract.secType && !['STK', 'CRYPTO'].includes(contract.secType)) return null
  return contract.symbol?.toUpperCase() || null
}

/** Map Alpaca order status string to IBKR-style OrderState status. */
export function mapAlpacaOrderStatus(alpacaStatus: string): string {
  switch (alpacaStatus) {
    case 'filled':
      return 'Filled'
    case 'new':
    case 'accepted':
    case 'pending_new':
    case 'accepted_for_bidding':
      return 'Submitted'
    case 'canceled':
    case 'expired':
    case 'replaced':
      return 'Cancelled'
    case 'partially_filled':
      return 'Submitted'  // still active
    case 'done_for_day':
    case 'suspended':
    case 'rejected':
      return 'Inactive'
    default:
      return 'Submitted'
  }
}

/** Create an IBKR OrderState from an Alpaca status string. */
export function makeOrderState(alpacaStatus: string, rejectReason?: string): OrderState {
  const s = new OrderState()
  s.status = mapAlpacaOrderStatus(alpacaStatus)
  if (rejectReason) s.rejectReason = rejectReason
  return s
}
