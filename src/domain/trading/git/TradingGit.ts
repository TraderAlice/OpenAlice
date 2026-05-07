/**
 * TradingGit — Trading-as-Git implementation
 *
 * Unified git-like operation tracking for all trading accounts.
 */

import { createHash } from 'crypto'
import Decimal from 'decimal.js'
import { Order, UNSET_DECIMAL } from '@traderalice/ibkr'
import type { ITradingGit, TradingGitConfig } from './interfaces.js'
import type {
  CommitHash,
  Operation,
  OperationResult,
  OperationStatus,
  AddResult,
  CommitPrepareResult,
  PushResult,
  RejectResult,
  GitStatus,
  GitCommit,
  GitState,
  CommitLogEntry,
  GitExportState,
  OperationSummary,
  PriceChangeInput,
  SimulatePriceChangeResult,
  OrderStatusUpdate,
  SyncResult,
} from './types.js'
import { getOperationSymbol } from './types.js'

function generateCommitHash(content: object): CommitHash {
  const hash = createHash('sha256')
    .update(JSON.stringify(content))
    .digest('hex')
  return hash.slice(0, 8)
}

export class TradingGit implements ITradingGit {
  private stagingArea: Operation[] = []
  private pendingMessage: string | null = null
  private pendingHash: CommitHash | null = null
  private commits: GitCommit[] = []
  private head: CommitHash | null = null
  private currentRound: number | undefined = undefined
  private readonly config: TradingGitConfig

  constructor(config: TradingGitConfig) {
    this.config = config
  }

  // ==================== git add / commit / push ====================

  add(operation: Operation): AddResult {
    this.stagingArea.push(operation)
    return {
      staged: true,
      index: this.stagingArea.length - 1,
      operation,
    }
  }

  commit(message: string): CommitPrepareResult {
    if (this.stagingArea.length === 0) {
      throw new Error('Nothing to commit: staging area is empty')
    }

    const timestamp = new Date().toISOString()
    this.pendingHash = generateCommitHash({
      message,
      operations: this.stagingArea,
      timestamp,
      parentHash: this.head,
    })
    this.pendingMessage = message

    return {
      prepared: true,
      hash: this.pendingHash,
      message,
      operationCount: this.stagingArea.length,
    }
  }

  async push(): Promise<PushResult> {
    if (this.stagingArea.length === 0) {
      throw new Error('Nothing to push: staging area is empty')
    }
    if (this.pendingMessage === null || this.pendingHash === null) {
      throw new Error('Nothing to push: please commit first')
    }

    const operations = [...this.stagingArea]
    const message = this.pendingMessage
    const hash = this.pendingHash

    // Execute all operations
    const results: OperationResult[] = []
    for (const op of operations) {
      try {
        const raw = await this.config.executeOperation(op)
        results.push(this.parseOperationResult(op, raw))
      } catch (error) {
        results.push({
          action: op.action,
          success: false,
          status: 'rejected',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Snapshot state after execution
    const stateAfter = await this.config.getGitState()

    const commit: GitCommit = {
      hash,
      parentHash: this.head,
      message,
      operations,
      results,
      stateAfter,
      timestamp: new Date().toISOString(),
      round: this.currentRound,
    }

    this.commits.push(commit)
    this.head = hash

    await this.config.onCommit?.(this.exportState())

    // Clear staging
    this.stagingArea = []
    this.pendingMessage = null
    this.pendingHash = null

    const rejected = results.filter((r) => !r.success)
    const submitted = results.filter((r) => r.success)

    return { hash, message, operationCount: operations.length, submitted, rejected }
  }

  async reject(reason?: string): Promise<RejectResult> {
    if (this.stagingArea.length === 0) {
      throw new Error('Nothing to reject: staging area is empty')
    }
    if (this.pendingMessage === null || this.pendingHash === null) {
      throw new Error('Nothing to reject: please commit first')
    }

    const operations = [...this.stagingArea]
    const message = `[rejected] ${this.pendingMessage}${reason ? ` — ${reason}` : ''}`
    const hash = this.pendingHash

    const results: OperationResult[] = operations.map((op) => ({
      action: op.action,
      success: false,
      status: 'user-rejected' as const,
      error: reason || 'Rejected by user',
    }))

    const stateAfter = await this.config.getGitState()

    const commit: GitCommit = {
      hash,
      parentHash: this.head,
      message,
      operations,
      results,
      stateAfter,
      timestamp: new Date().toISOString(),
      round: this.currentRound,
    }

    this.commits.push(commit)
    this.head = hash
    await this.config.onCommit?.(this.exportState())

    // Clear staging
    this.stagingArea = []
    this.pendingMessage = null
    this.pendingHash = null

    return { hash, message, operationCount: operations.length }
  }

  /**
   * Append a synthetic reconcileBalance commit to the log without going
   * through staging/push. Used by UTA when broker-reported balance differs
   * from what the order log projects (first-sight bootstrap, external
   * deposit/withdraw, staking reward, off-platform trade) — record the
   * delta as a virtual market trade at observed price so the cost-basis
   * pipeline naturally folds it in.
   *
   * The caller passes the post-reconcile GitState (typically built from
   * the in-flight `getPositions` data) to avoid recursing back through
   * `getGitState` → `broker.getPositions()`.
   */
  async recordReconcile(params: {
    aliceId: string
    quantityDelta: Decimal
    markPrice: Decimal
    stateAfter: GitState
    message?: string
  }): Promise<CommitHash> {
    const { aliceId, quantityDelta, markPrice, stateAfter } = params
    const timestamp = new Date().toISOString()

    const qtyStr = quantityDelta.toFixed()
    const priceStr = markPrice.toFixed()

    const operation: Operation = {
      action: 'reconcileBalance',
      aliceId,
      quantityDelta: qtyStr,
      markPrice: priceStr,
    }

    const result: OperationResult = {
      action: 'reconcileBalance',
      success: true,
      status: 'filled',
      filledQty: quantityDelta.abs().toFixed(),
      filledPrice: priceStr,
    }

    const direction = quantityDelta.gte(0) ? 'observed' : 'released'
    const message = params.message
      ?? `reconcile: ${direction} ${quantityDelta.abs().toFixed()} ${aliceId} @ ${priceStr}`

    const hash = generateCommitHash({
      message,
      operations: [operation],
      timestamp,
      parentHash: this.head,
    })

    const commit: GitCommit = {
      hash,
      parentHash: this.head,
      message,
      operations: [operation],
      results: [result],
      stateAfter,
      timestamp,
      round: this.currentRound,
    }

    this.commits.push(commit)
    this.head = hash

    await this.config.onCommit?.(this.exportState())

    return hash
  }

  // ==================== git log / show / status ====================

  log(options: { limit?: number; symbol?: string } = {}): CommitLogEntry[] {
    const { limit = 10, symbol } = options

    let commits = this.commits.slice().reverse()

    if (symbol) {
      commits = commits.filter((c) =>
        c.operations.some((op) => getOperationSymbol(op) === symbol),
      )
    }

    commits = commits.slice(0, limit)

    return commits.map((c) => ({
      hash: c.hash,
      parentHash: c.parentHash,
      message: c.message,
      timestamp: c.timestamp,
      round: c.round,
      operations: this.buildOperationSummaries(c, symbol),
    }))
  }

  private buildOperationSummaries(
    commit: GitCommit,
    filterSymbol?: string,
  ): OperationSummary[] {
    const summaries: OperationSummary[] = []

    for (let i = 0; i < commit.operations.length; i++) {
      const op = commit.operations[i]
      const result = commit.results[i]
      const symbol = getOperationSymbol(op)

      if (filterSymbol && symbol !== filterSymbol) continue

      summaries.push({
        symbol,
        action: op.action,
        change: this.formatOperationChange(op, result),
        status: result?.status || 'rejected',
      })
    }

    return summaries
  }

  private formatOperationChange(op: Operation, result?: OperationResult): string {
    switch (op.action) {
      case 'placeOrder': {
        const side = op.order?.action || 'unknown' // BUY / SELL
        const qty = op.order?.totalQuantity
        const cashQty = op.order?.cashQty
        const hasQty = qty && !qty.equals(UNSET_DECIMAL)
        const hasCash = cashQty && !cashQty.equals(UNSET_DECIMAL) && cashQty.gt(0)
        const sizeStr = hasCash ? `$${cashQty.toFixed()}` : hasQty ? `${qty.toFixed()}` : '?'

        if (result?.status === 'user-rejected') {
          return `${side} ${sizeStr} (user-rejected)`
        }
        if (result?.status === 'filled') {
          const price = result.execution?.price ? ` @${result.execution.price}` : ''
          return `${side} ${sizeStr}${price}`
        }
        return `${side} ${sizeStr} (${result?.status || 'unknown'})`
      }

      case 'closePosition': {
        const qty = op.quantity
        if (result?.status === 'filled') {
          const price = result.execution?.price ? ` @${result.execution.price}` : ''
          const qtyStr = qty ? ` (partial: ${qty})` : ''
          return `closed${qtyStr}${price}`
        }
        return `close (${result?.status || 'unknown'})`
      }

      case 'modifyOrder': {
        return `modified ${op.orderId}`
      }

      case 'cancelOrder':
        return `cancelled order ${op.orderId}`

      case 'syncOrders': {
        const status = result?.status || 'unknown'
        const price = result?.filledPrice ? ` @${result.filledPrice}`
          : result?.execution?.price ? ` @${result.execution.price}` : ''
        const qty = result?.filledQty ? ` (${result.filledQty} filled)` : ''
        return `synced → ${status}${price}${qty}`
      }

      case 'reconcileBalance': {
        const delta = new Decimal(op.quantityDelta)
        const direction = delta.gte(0) ? 'observed' : 'released'
        return `${direction} ${delta.abs().toFixed()} @${op.markPrice}`
      }
    }
  }

  show(hash: CommitHash): GitCommit | null {
    return this.commits.find((c) => c.hash === hash) ?? null
  }

  status(): GitStatus {
    return {
      staged: [...this.stagingArea],
      pendingMessage: this.pendingMessage,
      pendingHash: this.pendingHash,
      head: this.head,
      commitCount: this.commits.length,
    }
  }

  // ==================== Serialization ====================

  exportState(): GitExportState {
    return { commits: [...this.commits], head: this.head }
  }

  static restore(state: GitExportState, config: TradingGitConfig): TradingGit {
    const git = new TradingGit(config)
    git.commits = state.commits.map(TradingGit.rehydrateCommit)
    git.head = state.head
    return git
  }

  /** Rehydrate Decimal fields lost during JSON round-trip. */
  private static rehydrateCommit(commit: GitCommit): GitCommit {
    return {
      ...commit,
      operations: commit.operations.map(TradingGit.rehydrateOperation),
      stateAfter: TradingGit.rehydrateGitState(commit.stateAfter),
    }
  }

  private static rehydrateOperation(op: Operation): Operation {
    switch (op.action) {
      case 'placeOrder':
        return {
          ...op,
          order: op.order ? TradingGit.rehydrateOrder(op.order) : op.order,
        }
      case 'closePosition':
        return {
          ...op,
          quantity: op.quantity != null ? new Decimal(String(op.quantity)) : op.quantity,
        }
      default:
        return op
    }
  }

  private static rehydrateOrder(order: Order): Order {
    const rehydrated = Object.assign(new Order(), order)
    // Decimal fields need re-wrapping after JSON.parse — strings or numbers
    // become plain JS values, not Decimal instances. `new Decimal(String(x))`
    // accepts both legacy (number) and current (string) persisted forms.
    if (order.totalQuantity != null) {
      rehydrated.totalQuantity = new Decimal(String(order.totalQuantity))
    }
    if (order.lmtPrice != null) {
      rehydrated.lmtPrice = new Decimal(String(order.lmtPrice))
    }
    if (order.auxPrice != null) {
      rehydrated.auxPrice = new Decimal(String(order.auxPrice))
    }
    if (order.trailStopPrice != null) {
      rehydrated.trailStopPrice = new Decimal(String(order.trailStopPrice))
    }
    if (order.trailingPercent != null) {
      rehydrated.trailingPercent = new Decimal(String(order.trailingPercent))
    }
    if (order.cashQty != null) {
      rehydrated.cashQty = new Decimal(String(order.cashQty))
    }
    return rehydrated
  }

  private static rehydrateGitState(state: GitState): GitState {
    return {
      ...state,
      positions: state.positions.map((pos) => ({
        ...pos,
        quantity: new Decimal(String(pos.quantity)),
        // Position.multiplier became required in the IBKR-as-truth refactor
        // (Phase 1). Older commit.json files written under the optional
        // contract have positions with no multiplier set — fill the
        // canonical default so they don't fail downstream consumers that
        // expect every Position to declare one.
        multiplier: pos.multiplier ?? '1',
      })),
    }
  }

  setCurrentRound(round: number): void {
    this.currentRound = round
  }

  // ==================== Sync ====================

  async sync(updates: OrderStatusUpdate[], currentState: GitState): Promise<SyncResult> {
    if (updates.length === 0) {
      return { hash: this.head ?? '', updatedCount: 0, updates: [] }
    }

    const hash = generateCommitHash({
      updates,
      timestamp: new Date().toISOString(),
      parentHash: this.head,
    })

    const commit: GitCommit = {
      hash,
      parentHash: this.head,
      message: `[sync] ${updates.length} order(s) updated`,
      operations: [{ action: 'syncOrders' as const }],
      results: updates.map((u) => ({
        action: 'syncOrders' as const,
        success: true,
        orderId: u.orderId,
        status: u.currentStatus,
        filledQty: u.filledQty,
        filledPrice: u.filledPrice,
      })),
      stateAfter: currentState,
      timestamp: new Date().toISOString(),
      round: this.currentRound,
    }

    this.commits.push(commit)
    this.head = hash

    await this.config.onCommit?.(this.exportState())

    return { hash, updatedCount: updates.length, updates }
  }

  getPendingOrderIds(): Array<{ orderId: string; symbol: string }> {
    // Scan newest→oldest to find latest known status per orderId
    const orderStatus = new Map<string, string>()

    for (let i = this.commits.length - 1; i >= 0; i--) {
      for (const result of this.commits[i].results) {
        if (result.orderId && !orderStatus.has(result.orderId)) {
          orderStatus.set(result.orderId, result.status)
        }
      }
    }

    // Collect orders still pending
    const pending: Array<{ orderId: string; symbol: string }> = []
    const seen = new Set<string>()

    for (const commit of this.commits) {
      for (let j = 0; j < commit.results.length; j++) {
        const result = commit.results[j]
        if (
          result.orderId &&
          !seen.has(result.orderId) &&
          orderStatus.get(result.orderId) === 'submitted'
        ) {
          const symbol = getOperationSymbol(commit.operations[j])
          pending.push({ orderId: result.orderId, symbol })
          seen.add(result.orderId)
        }
      }
    }

    return pending
  }

  // ==================== Simulation ====================

  async simulatePriceChange(
    priceChanges: PriceChangeInput[],
  ): Promise<SimulatePriceChangeResult> {
    const state = await this.config.getGitState()
    const { positions } = state
    const equity = new Decimal(state.netLiquidation)
    const unrealizedPnL = new Decimal(state.unrealizedPnL)
    const cash = new Decimal(state.totalCashValue)

    const currentTotalPnL = cash.gt(0) ? equity.minus(cash).div(cash).mul(100) : new Decimal(0)

    if (positions.length === 0) {
      return {
        success: true,
        currentState: { equity: equity.toString(), unrealizedPnL: unrealizedPnL.toString(), totalPnL: currentTotalPnL.toString(), positions: [] },
        simulatedState: { equity: equity.toString(), unrealizedPnL: unrealizedPnL.toString(), totalPnL: currentTotalPnL.toString(), positions: [] },
        summary: {
          totalPnLChange: '0',
          equityChange: '0',
          equityChangePercent: '0.0%',
          worstCase: 'No positions to simulate.',
        },
      }
    }

    // Parse price changes → target price map
    const priceMap = new Map<string, Decimal>()

    for (const { symbol, change } of priceChanges) {
      const parsed = this.parsePriceChange(change)
      if (!parsed.success) {
        return {
          success: false,
          error: `Invalid change format for ${symbol}: "${change}". Use "@150" for absolute or "+10%" / "-5%" for relative.`,
          currentState: { equity: equity.toString(), unrealizedPnL: unrealizedPnL.toString(), totalPnL: currentTotalPnL.toString(), positions: [] },
          simulatedState: { equity: equity.toString(), unrealizedPnL: unrealizedPnL.toString(), totalPnL: currentTotalPnL.toString(), positions: [] },
          summary: { totalPnLChange: '0', equityChange: '0', equityChangePercent: '0.0%', worstCase: '' },
        }
      }

      if (symbol === 'all') {
        for (const pos of positions) {
          priceMap.set(pos.contract.symbol || 'unknown', this.applyPriceChange(new Decimal(pos.marketPrice), parsed.type, parsed.value))
        }
      } else {
        const pos = positions.find((p) => (p.contract.symbol || p.contract.aliceId) === symbol)
        if (pos) {
          priceMap.set(symbol, this.applyPriceChange(new Decimal(pos.marketPrice), parsed.type, parsed.value))
        }
      }
    }

    // Current state
    const currentPositions = positions.map((pos) => ({
      symbol: pos.contract.symbol || pos.contract.aliceId || 'unknown',
      side: pos.side,
      qty: pos.quantity.toString(),
      avgCost: pos.avgCost,
      marketPrice: pos.marketPrice,
      unrealizedPnL: pos.unrealizedPnL,
      marketValue: pos.marketValue,
    }))

    // Simulated state
    let simulatedUnrealizedPnL = new Decimal(0)
    const simulatedPositions = positions.map((pos) => {
      const sym = pos.contract.symbol || pos.contract.aliceId || 'unknown'
      const mktPrice = new Decimal(pos.marketPrice)
      const simulatedPrice = priceMap.get(sym) ?? mktPrice
      const priceChange = simulatedPrice.minus(mktPrice)
      const priceChangePct = mktPrice.gt(0) ? priceChange.div(mktPrice).mul(100) : new Decimal(0)
      const q = pos.quantity
      const avgCost = new Decimal(pos.avgCost)

      const newPnL =
        pos.side === 'long'
          ? simulatedPrice.minus(avgCost).mul(q)
          : avgCost.minus(simulatedPrice).mul(q)

      const pnlChange = newPnL.minus(pos.unrealizedPnL)
      simulatedUnrealizedPnL = simulatedUnrealizedPnL.plus(newPnL)

      return {
        symbol: sym,
        side: pos.side,
        qty: q.toString(),
        avgCost: pos.avgCost,
        simulatedPrice: simulatedPrice.toString(),
        unrealizedPnL: newPnL.toString(),
        marketValue: simulatedPrice.mul(q).toString(),
        pnlChange: pnlChange.toString(),
        priceChangePercent: `${priceChangePct.gte(0) ? '+' : ''}${priceChangePct.toFixed(2)}%`,
      }
    })

    const pnlDiff = simulatedUnrealizedPnL.minus(unrealizedPnL)
    const simulatedEquity = equity.plus(pnlDiff)
    const simulatedTotalPnL = cash.gt(0) ? simulatedEquity.minus(cash).div(cash).mul(100) : new Decimal(0)
    const equityChangePct = equity.gt(0) ? pnlDiff.div(equity).mul(100) : new Decimal(0)

    const worst = simulatedPositions.reduce(
      (w, p) => (new Decimal(p.pnlChange).lt(w.pnlChange) ? { ...p, pnlChange: new Decimal(p.pnlChange) } : w),
      { ...simulatedPositions[0], pnlChange: new Decimal(simulatedPositions[0].pnlChange) },
    )

    const worstCase =
      worst.pnlChange.lt(0)
        ? `${worst.symbol} would lose $${worst.pnlChange.abs().toFixed(2)} (${worst.priceChangePercent})`
        : 'All positions would profit or break even.'

    return {
      success: true,
      currentState: { equity: equity.toString(), unrealizedPnL: unrealizedPnL.toString(), totalPnL: currentTotalPnL.toString(), positions: currentPositions },
      simulatedState: {
        equity: simulatedEquity.toString(),
        unrealizedPnL: simulatedUnrealizedPnL.toString(),
        totalPnL: simulatedTotalPnL.toString(),
        positions: simulatedPositions,
      },
      summary: {
        totalPnLChange: pnlDiff.toString(),
        equityChange: pnlDiff.toString(),
        equityChangePercent: `${equityChangePct.gte(0) ? '+' : ''}${equityChangePct.toFixed(2)}%`,
        worstCase,
      },
    }
  }

  private parsePriceChange(
    change: string,
  ): { success: true; type: 'absolute' | 'relative'; value: number } | { success: false } {
    const trimmed = change.trim()

    if (trimmed.startsWith('@')) {
      const value = parseFloat(trimmed.slice(1))
      if (isNaN(value) || value <= 0) return { success: false }
      return { success: true, type: 'absolute', value }
    }

    if (trimmed.endsWith('%')) {
      const value = parseFloat(trimmed.slice(0, -1))
      if (isNaN(value)) return { success: false }
      return { success: true, type: 'relative', value }
    }

    return { success: false }
  }

  private applyPriceChange(
    currentPrice: Decimal,
    type: 'absolute' | 'relative',
    value: number,
  ): Decimal {
    return type === 'absolute' ? new Decimal(value) : currentPrice.mul(new Decimal(1).plus(new Decimal(value).div(100)))
  }

  // ==================== Internal ====================

  private parseOperationResult(op: Operation, raw: unknown): OperationResult {
    const rawObj = raw as Record<string, unknown>

    if (!rawObj || typeof rawObj !== 'object') {
      return {
        action: op.action,
        success: false,
        status: 'rejected',
        error: 'Invalid response from trading engine',
        raw,
      }
    }

    const success = rawObj.success === true

    if (!success) {
      return {
        action: op.action,
        success: false,
        status: 'rejected',
        error: (rawObj.error as string) ?? 'Unknown error',
        raw,
      }
    }

    const orderId = rawObj.orderId as string | undefined
    const orderState = rawObj.orderState as OperationResult['orderState']

    return {
      action: op.action,
      success: true,
      orderId,
      status: this.mapOrderStatus(orderState),
      orderState,
      raw,
    }
  }

  /** Map IBKR-style OrderState.status to OperationStatus. */
  private mapOrderStatus(orderState?: { status?: string }): OperationStatus {
    switch (orderState?.status) {
      case 'Filled': return 'filled'
      case 'Cancelled': return 'cancelled'
      case 'Inactive': return 'rejected'
      default: return 'submitted'
    }
  }
}
