/**
 * Trading-as-Git type definitions
 *
 * Operation is a discriminated union — each variant carries typed IBKR objects.
 * No more Record<string, unknown> type erasure.
 */

import type { Contract, Order, OrderCancel, Execution, OrderState } from '@traderalice/ibkr'
import type Decimal from 'decimal.js'
import type { Position, OpenOrder, TpSlParams } from '../brokers/types.js'
import '../contract-ext.js'

// ==================== Commit Hash ====================

/** 8-character short SHA-256 hash. */
export type CommitHash = string

// ==================== Operation ====================

export type OperationAction = Operation['action']

export type Operation =
  | { action: 'placeOrder'; contract: Contract; order: Order; tpsl?: TpSlParams }
  | { action: 'modifyOrder'; orderId: string; changes: Partial<Order> }
  | { action: 'closePosition'; contract: Contract; quantity?: Decimal }
  | { action: 'cancelOrder'; orderId: string; orderCancel?: OrderCancel }
  | { action: 'syncOrders' }
  | {
      // Wallet-only event: bridges the gap between Alice's order log and a
      // broker-reported balance change Alice did not initiate (first-sight
      // bootstrap, external transfer, staking reward, off-platform trade).
      // Treated as a virtual market buy/sell at observed price for cost-basis
      // purposes — sign of quantityDelta determines direction.
      //
      // Numeric fields stored as Decimal-as-string so they survive JSON
      // round-trip through git-persistence; reconstruct via `new Decimal(...)`
      // at consumption sites.
      action: 'reconcileBalance'
      aliceId: string
      quantityDelta: string
      markPrice: string
    }

// ==================== Operation Result ====================

export type OperationStatus = 'submitted' | 'filled' | 'rejected' | 'cancelled' | 'user-rejected'

export interface OperationResult {
  action: OperationAction
  success: boolean
  orderId?: string
  status: OperationStatus
  execution?: Execution
  orderState?: OrderState
  /** Decimal as string — sub-satoshi fills must round-trip without loss. */
  filledQty?: string
  /** Decimal as string — see filledQty. */
  filledPrice?: string
  error?: string
  raw?: unknown
}

// ==================== Wallet State ====================

/** State snapshot taken after each commit. All monetary fields are strings to prevent IEEE 754 artifacts. */
export interface GitState {
  netLiquidation: string
  totalCashValue: string
  unrealizedPnL: string
  realizedPnL: string
  positions: Position[]
  pendingOrders: OpenOrder[]
}

// ==================== Commit ====================

export interface GitCommit {
  hash: CommitHash
  parentHash: CommitHash | null
  message: string
  operations: Operation[]
  results: OperationResult[]
  stateAfter: GitState
  timestamp: string
  round?: number
}

// ==================== API Results ====================

export interface AddResult {
  staged: true
  index: number
  operation: Operation
}

export interface CommitPrepareResult {
  prepared: true
  hash: CommitHash
  message: string
  operationCount: number
}

export interface PushResult {
  hash: CommitHash
  message: string
  operationCount: number
  submitted: OperationResult[]
  rejected: OperationResult[]
}

export interface RejectResult {
  hash: CommitHash
  message: string
  operationCount: number
}

export interface GitStatus {
  staged: Operation[]
  pendingMessage: string | null
  pendingHash: CommitHash | null
  head: CommitHash | null
  commitCount: number
}

export interface OperationSummary {
  symbol: string
  action: OperationAction
  change: string
  status: OperationStatus
}

export interface CommitLogEntry {
  hash: CommitHash
  parentHash: CommitHash | null
  message: string
  timestamp: string
  round?: number
  operations: OperationSummary[]
}

// ==================== Export State ====================

export interface GitExportState {
  commits: GitCommit[]
  head: CommitHash | null
}

// ==================== Sync ====================

export interface OrderStatusUpdate {
  orderId: string
  symbol: string
  previousStatus: OperationStatus
  currentStatus: OperationStatus
  /** Decimal as string — same precision invariant as OperationResult. */
  filledPrice?: string
  filledQty?: string
}

export interface SyncResult {
  hash: CommitHash
  updatedCount: number
  updates: OrderStatusUpdate[]
}

// ==================== Simulate Price Change ====================

export interface PriceChangeInput {
  /** Contract aliceId or symbol, or "all". */
  symbol: string
  /** "@88000" (absolute) or "+10%" / "-5%" (relative). */
  change: string
}

export interface SimulationPositionCurrent {
  symbol: string
  side: 'long' | 'short'
  qty: string
  avgCost: string
  marketPrice: string
  unrealizedPnL: string
  marketValue: string
}

export interface SimulationPositionAfter {
  symbol: string
  side: 'long' | 'short'
  qty: string
  avgCost: string
  simulatedPrice: string
  unrealizedPnL: string
  marketValue: string
  pnlChange: string
  priceChangePercent: string
}

export interface SimulatePriceChangeResult {
  success: boolean
  error?: string
  currentState: {
    equity: string
    unrealizedPnL: string
    totalPnL: string
    positions: SimulationPositionCurrent[]
  }
  simulatedState: {
    equity: string
    unrealizedPnL: string
    totalPnL: string
    positions: SimulationPositionAfter[]
  }
  summary: {
    totalPnLChange: string
    equityChange: string
    equityChangePercent: string
    worstCase: string
  }
}

// ==================== Operation Helpers ====================

/** Extract the symbol from any Operation variant. */
export function getOperationSymbol(op: Operation): string {
  switch (op.action) {
    case 'placeOrder': return op.contract?.symbol || op.contract?.aliceId || 'unknown'
    case 'modifyOrder': return 'unknown' // modifyOrder doesn't carry contract
    case 'closePosition': return op.contract?.symbol || op.contract?.aliceId || 'unknown'
    case 'cancelOrder': return 'unknown'
    case 'syncOrders': return 'unknown'
    case 'reconcileBalance': return op.aliceId
  }
}
