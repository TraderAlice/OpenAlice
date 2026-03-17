/**
 * TradingGit — Trading-as-Git implementation
 *
 * Unified git-like operation tracking for all trading accounts.
 */

import { createHash } from 'crypto'
import { UNSET_DOUBLE, UNSET_DECIMAL } from '@traderalice/ibkr'
import type { ITradingGit, TradingGitConfig } from './interfaces.js'
import type {
  CommitHash,
  Operation,
  OperationResult,
  AddResult,
  CommitPrepareResult,
  PushResult,
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

    const filled = results.filter((r) => r.status === 'filled')
    const pending = results.filter((r) => r.status === 'pending')
    const rejected = results.filter((r) => r.status === 'rejected' || !r.success)

    return { hash, message, operationCount: operations.length, filled, pending, rejected }
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
        const hasCash = cashQty !== UNSET_DOUBLE && cashQty > 0
        const sizeStr = hasCash ? `$${cashQty}` : hasQty ? `${qty}` : '?'

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
        const price = result?.execution?.price ? ` @${result.execution.price}` : ''
        return `synced → ${status}${price}`
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
    git.commits = [...state.commits]
    git.head = state.head
    return git
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
          orderStatus.get(result.orderId) === 'pending'
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
    const { positions, netLiquidation: equity, unrealizedPnL, totalCashValue: cash } = state

    const currentTotalPnL = cash > 0 ? ((equity - cash) / cash) * 100 : 0

    if (positions.length === 0) {
      return {
        success: true,
        currentState: { equity, unrealizedPnL, totalPnL: currentTotalPnL, positions: [] },
        simulatedState: { equity, unrealizedPnL, totalPnL: currentTotalPnL, positions: [] },
        summary: {
          totalPnLChange: 0,
          equityChange: 0,
          equityChangePercent: '0.0%',
          worstCase: 'No positions to simulate.',
        },
      }
    }

    // Parse price changes → target price map
    const priceMap = new Map<string, number>()

    for (const { symbol, change } of priceChanges) {
      const parsed = this.parsePriceChange(change)
      if (!parsed.success) {
        return {
          success: false,
          error: `Invalid change format for ${symbol}: "${change}". Use "@150" for absolute or "+10%" / "-5%" for relative.`,
          currentState: { equity, unrealizedPnL, totalPnL: currentTotalPnL, positions: [] },
          simulatedState: { equity, unrealizedPnL, totalPnL: currentTotalPnL, positions: [] },
          summary: { totalPnLChange: 0, equityChange: 0, equityChangePercent: '0.0%', worstCase: '' },
        }
      }

      if (symbol === 'all') {
        for (const pos of positions) {
          priceMap.set(pos.contract.symbol || 'unknown', this.applyPriceChange(pos.marketPrice, parsed.type, parsed.value))
        }
      } else {
        const pos = positions.find((p) => (p.contract.symbol || p.contract.aliceId) === symbol)
        if (pos) {
          priceMap.set(symbol, this.applyPriceChange(pos.marketPrice, parsed.type, parsed.value))
        }
      }
    }

    const qty = (pos: typeof positions[0]) => pos.quantity.toNumber()

    // Current state
    const currentPositions = positions.map((pos) => ({
      symbol: pos.contract.symbol || pos.contract.aliceId || 'unknown',
      side: pos.side,
      qty: qty(pos),
      avgCost: pos.avgCost,
      marketPrice: pos.marketPrice,
      unrealizedPnL: pos.unrealizedPnL,
      marketValue: pos.marketValue,
    }))

    // Simulated state
    let simulatedUnrealizedPnL = 0
    const simulatedPositions = positions.map((pos) => {
      const sym = pos.contract.symbol || pos.contract.aliceId || 'unknown'
      const simulatedPrice = priceMap.get(sym) ?? pos.marketPrice
      const priceChange = simulatedPrice - pos.marketPrice
      const priceChangePct = pos.marketPrice > 0 ? (priceChange / pos.marketPrice) * 100 : 0
      const q = qty(pos)

      const newPnL =
        pos.side === 'long'
          ? (simulatedPrice - pos.avgCost) * q
          : (pos.avgCost - simulatedPrice) * q

      const pnlChange = newPnL - pos.unrealizedPnL
      simulatedUnrealizedPnL += newPnL

      return {
        symbol: sym,
        side: pos.side,
        qty: q,
        avgCost: pos.avgCost,
        simulatedPrice,
        unrealizedPnL: newPnL,
        marketValue: simulatedPrice * q,
        pnlChange,
        priceChangePercent: `${priceChangePct >= 0 ? '+' : ''}${priceChangePct.toFixed(2)}%`,
      }
    })

    const pnlDiff = simulatedUnrealizedPnL - unrealizedPnL
    const simulatedEquity = equity + pnlDiff
    const simulatedTotalPnL = cash > 0 ? ((simulatedEquity - cash) / cash) * 100 : 0
    const equityChangePct = equity > 0 ? (pnlDiff / equity) * 100 : 0

    const worst = simulatedPositions.reduce(
      (w, p) => (p.pnlChange < w.pnlChange ? p : w),
      simulatedPositions[0],
    )

    const worstCase =
      worst.pnlChange < 0
        ? `${worst.symbol} would lose $${Math.abs(worst.pnlChange).toFixed(2)} (${worst.priceChangePercent})`
        : 'All positions would profit or break even.'

    return {
      success: true,
      currentState: { equity, unrealizedPnL, totalPnL: currentTotalPnL, positions: currentPositions },
      simulatedState: {
        equity: simulatedEquity,
        unrealizedPnL: simulatedUnrealizedPnL,
        totalPnL: simulatedTotalPnL,
        positions: simulatedPositions,
      },
      summary: {
        totalPnLChange: pnlDiff,
        equityChange: pnlDiff,
        equityChangePercent: `${equityChangePct >= 0 ? '+' : ''}${equityChangePct.toFixed(2)}%`,
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
    currentPrice: number,
    type: 'absolute' | 'relative',
    value: number,
  ): number {
    return type === 'absolute' ? value : currentPrice * (1 + value / 100)
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
    const execution = rawObj.execution as OperationResult['execution']
    const orderState = rawObj.orderState as OperationResult['orderState']

    // Determine status from execution or orderState
    let status: OperationResult['status'] = 'filled'
    if (execution?.price) {
      status = 'filled'
    } else if (orderId) {
      status = 'pending'
    }

    return {
      action: op.action,
      success: true,
      orderId,
      status,
      execution,
      orderState,
      raw,
    }
  }
}
