/**
 * ITradingGit — Trading-as-Git interface
 *
 * Git-style three-phase workflow for trading operations:
 *   add → commit → push → log / show / status
 */

import type Decimal from 'decimal.js'
import type { Contract, Order } from '@traderalice/ibkr'
import type {
  CommitHash,
  Operation,
  AddResult,
  CommitPrepareResult,
  PushResult,
  RejectResult,
  GitStatus,
  GitCommit,
  CommitLogEntry,
  GitExportState,
  GitState,
  PriceChangeInput,
  SimulatePriceChangeResult,
  OrderStatusUpdate,
  SyncResult,
} from './types.js'

export interface ITradingGit {
  // ---- git add / commit / push ----

  add(operation: Operation): AddResult
  commit(message: string): CommitPrepareResult
  push(expectedPendingHash: string): Promise<PushResult>
  reject(reason: string | undefined, expectedPendingHash: string): Promise<RejectResult>

  // ---- wallet reconciliation (synthesized commits) ----

  recordReconcile(params: {
    aliceId: string
    quantityDelta: Decimal
    markPrice: Decimal
    stateAfter: GitState
    message?: string
  }): Promise<CommitHash>

  // ---- git log / show / status ----

  log(options?: { limit?: number; symbol?: string }): CommitLogEntry[]
  show(hash: CommitHash): GitCommit | null
  status(): GitStatus

  // ---- git pull (sync pending orders) ----

  sync(updates: OrderStatusUpdate[], currentState: GitState): Promise<SyncResult>
  /** `localSymbol` is the broker-native symbol from the order's operation
   *  contract — passed to IBroker.getOrder as the symbolHint so lookups
   *  survive restarts (CCXT's order API is symbol-scoped). */
  getPendingOrderIds(): Array<{ orderId: string; symbol: string; localSymbol?: string; aliceId?: string }>
  /** Squash externally-observed open orders into one [observed] commit. */
  recordObservedOrders(params: {
    observed: Array<{ contract: Contract; order: Order; orderId: string }>
    stateAfter: GitState
  }): Promise<CommitHash>
  /** Every broker orderId the log has ever seen. */
  getKnownOrderIds(): Set<string>

  // ---- serialization ----

  exportState(): GitExportState
  setCurrentRound(round: number): void

  // ---- simulation ----

  simulatePriceChange(priceChanges: PriceChangeInput[]): Promise<SimulatePriceChangeResult>
}

export interface TradingGitConfig {
  /** Hand one staged operation to the broker.
   *
   *  `signal` is best-effort cooperative cancellation: it aborts when the
   *  write bound (`writeTimeoutMs`) expires, so a broker call that CAN stop
   *  waiting does. Today no `IBroker` method accepts a signal, so the real
   *  enforcement is at this layer — an uncooperative call is abandoned (and
   *  its result recorded as unconfirmed), never cancelled. */
  executeOperation: (operation: Operation, signal?: AbortSignal) => Promise<unknown>
  getGitState: () => Promise<GitState>
  onCommit?: (state: GitExportState) => void | Promise<void>
  /** Liveness bound for ONE broker call in the push path. A promise that
   *  never settles must not hold the wallet write lock forever — the account
   *  could no longer stage or push anything, including a stop-loss. Defaults
   *  to `DEFAULT_WRITE_TIMEOUT_MS` (TradingGit.ts). */
  writeTimeoutMs?: number
  /** Verdict for a broker call that FAILED. `'unconfirmed'` means the request may
   *  have reached the venue (timeout, reset, 5xx, unclassifiable) — the log must
   *  not claim the order did not take effect; `'rejected'` means the failure
   *  proves it did not (invalid order, insufficient funds, auth, local refusal).
   *
   *  Absent means every failure is recorded `'rejected'`, i.e. the behaviour that
   *  predates this seam, so a caller that wires nothing keeps its old semantics.
   *  The UTA service wires
   *  `classifyOperationFailure` (domain/trading/brokers/operation-failure-classification.ts),
   *  which fails closed to `'unconfirmed'`. */
  classifyOperationError?: (error: unknown) => 'rejected' | 'unconfirmed'
}
