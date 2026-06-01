/**
 * IbkrBroker configuration and internal types.
 *
 * IBKR has no API key/secret — authentication is handled by TWS/Gateway login.
 * Config only needs connection parameters.
 */

import type { Contract, Order, OrderState } from '@traderalice/ibkr'
import type { Position } from '../types.js'

// ==================== Config ====================

export interface IbkrBrokerConfig {
  id?: string
  label?: string
  /** TWS/Gateway host. Default: 127.0.0.1 */
  host?: string
  /** TWS/Gateway port. Default: 7497 (TWS paper) */
  port?: number
  /** Client ID (0-32). Default: 0 */
  clientId?: number
  /** IB account code (e.g. "DU12345"). Auto-detected from managedAccounts if omitted. */
  accountId?: string
}

// ==================== Internal bridge types ====================

/** Pending request entry in the reqId-based map. */
export interface PendingRequest<T = unknown> {
  resolve: (value: T) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/** Accumulated tick data for a snapshot quote request. */
export interface TickSnapshot {
  bid?: number
  ask?: number
  last?: number
  volume?: number
  high?: number
  low?: number
  close?: number
  lastTimestamp?: number
}

/** Result of an account download (reqAccountUpdates round-trip). */
export interface AccountDownloadResult {
  values: Map<string, string>
  positions: Position[]
}

/** Collected open order from openOrder/completedOrder callback. */
export interface CollectedOpenOrder {
  contract: Contract
  order: Order
  orderState: OrderState
  /** Average fill price — captured from orderStatus() callback when available. */
  avgFillPrice?: number
}
