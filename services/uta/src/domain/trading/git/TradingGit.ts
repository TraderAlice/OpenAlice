/**
 * TradingGit — Trading-as-Git implementation
 *
 * Unified git-like operation tracking for all trading accounts.
 */

import { createHash } from 'crypto'
import Decimal from 'decimal.js'
import { Contract, Order, UNSET_DECIMAL, UNSET_DOUBLE } from '@traderalice/ibkr'
import { OrderHelper } from '../OrderHelper.js'
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

/** secTypes whose price does NOT track the underlying 1:1 — excluded from
 *  symbol-level price simulation (they share the underlying's symbol). */
const DERIVATIVE_SECTYPES = new Set(['OPT', 'FOP', 'WAR', 'IOPT', 'BAG'])

function generateCommitHash(content: object): CommitHash {
  const hash = createHash('sha256')
    .update(JSON.stringify(content))
    .digest('hex')
  return hash.slice(0, 8)
}

export class PendingHashConflictError extends Error {
  readonly code = 'PENDING_HASH_CONFLICT' as const

  constructor(message = 'Pending commit changed') {
    super(message)
    this.name = 'PendingHashConflictError'
  }
}

export function isPendingHashConflict(error: unknown): boolean {
  if (error instanceof PendingHashConflictError) return true
  if (!error || typeof error !== 'object') return false
  return (error as { code?: unknown }).code === 'PENDING_HASH_CONFLICT'
    || (error as { name?: unknown }).name === 'PendingHashConflictError'
}

/** Liveness bound for ONE wallet write in the push path (`writeTimeoutMs`) —
 *  the deadline covers the whole `executePush()` broker loop, because the lock
 *  is held for the whole loop, so per-call budgets shrink as it elapses.
 *
 *  Observed defect: nothing upstream bounded `executeOperation` (the HTTP route
 *  awaits it unbounded, `IBroker` takes no cancellation signal), so a promise
 *  that never settles held `inflightWrite` forever — the `finally` in push()/
 *  reject() only runs on settlement — and every later add/commit/push/reject
 *  threw PENDING_HASH_CONFLICT with no release path in `ITradingGit`: the
 *  account could no longer stage or push anything, a stop-loss included.
 *
 *  A CLIENT request abort is NOT the mechanism and is deliberately not handled
 *  here: neither Node nor Hono cancels an awaited server-side promise, and the
 *  `finally` runs on every settlement (fulfilled or rejected). Only a promise
 *  that never settles leaks the lock, so the bound IS the fix and the signal
 *  handed to `executeOperation` is best-effort cooperation on top of it.
 *
 *  The deadline covers the WHOLE write attempt: every broker call in the
 *  dispatch loop AND the post-execution state snapshot (same broker connection,
 *  same lock). When the snapshot does not settle inside the bound the commit is
 *  still appended with the last state the log holds plus a `stateAfterSource`
 *  marker — never a snapshot that was not read.
 *
 *  90s: a healthy submit is seconds (CCXT's own per-request timeout is ~10s,
 *  IBKR acks through request-bridge in seconds), so this keeps ~3x headroom for
 *  a slow broker while confining a stuck account to ~1.5 minutes. */
export const DEFAULT_WRITE_TIMEOUT_MS = 90_000

/** The write stopped waiting on a broker call whose outcome is UNKNOWN — the
 *  order MAY have landed. Kept distinct from PendingHashConflictError (retrying
 *  is pointless) and from `'rejected'` (which claims the order definitely did
 *  not take effect): the caller must reconcile against broker state instead of
 *  retrying.
 *
 *  Thrown AFTER the commit is appended (the log records the unsettled
 *  operations as `unconfirmed`, `success: false`) and after staging is cleared
 *  (re-pushing the same commit could duplicate an order whose fate is
 *  unknown), so the write lock is already released when callers see this.
 *  Check `logPersisted` before treating the record as durable. */
export class WriteOutcomeUnconfirmedError extends Error {
  readonly code = 'WRITE_OUTCOME_UNCONFIRMED' as const
  /** Commit appended for the abandoned write — inspect it with `show`. */
  readonly hash: CommitHash
  /** Operations whose outcome could not be determined. */
  readonly unconfirmed: OperationResult[]
  /** False when `onCommit` failed: the commit is in memory only. */
  readonly logPersisted: boolean

  constructor(
    message: string,
    params: { hash: CommitHash; unconfirmed: OperationResult[]; logPersisted: boolean },
  ) {
    super(message)
    this.name = 'WriteOutcomeUnconfirmedError'
    this.hash = params.hash
    this.unconfirmed = params.unconfirmed
    this.logPersisted = params.logPersisted
  }
}

export function isWriteOutcomeUnconfirmed(error: unknown): error is WriteOutcomeUnconfirmedError {
  if (error instanceof WriteOutcomeUnconfirmedError) return true
  if (!error || typeof error !== 'object') return false
  return (error as { code?: unknown }).code === 'WRITE_OUTCOME_UNCONFIRMED'
    || (error as { name?: unknown }).name === 'WriteOutcomeUnconfirmedError'
}

/**
 * A failure the dispatcher REPORTED as a resolved `{ success: false, error }`
 * rather than throwing one — `CcxtBroker.placeOrder` resolves this shape for
 * every venue error it catches, transport timeouts included, so the message is
 * the only evidence the classification has to work from.
 *
 * The git layer constructs it and hands it to the same
 * `classifyOperationError` seam it uses for thrown failures; the classifier
 * matches it by name (see
 * brokers/operation-failure-classification.ts).
 */
export class ReportedOperationFailureError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReportedOperationFailureError'
  }
}

export class TradingGit implements ITradingGit {
  private stagingArea: Operation[] = []

  private pendingMessage: string | null = null
  private pendingHash: CommitHash | null = null
  private inflightWrite = false
  private commits: GitCommit[] = []
  private head: CommitHash | null = null
  private currentRound: number | undefined = undefined
  private readonly config: TradingGitConfig

  constructor(config: TradingGitConfig) {
    this.config = config
  }

  // ==================== git add / commit / push ====================

  add(operation: Operation): AddResult {
    if (this.inflightWrite) {
      throw new PendingHashConflictError('A wallet write is already in progress')
    }
    if (this.pendingHash !== null || this.pendingMessage !== null) {
      throw new PendingHashConflictError(
        'A commit is awaiting approval. Push or reject it before staging more operations.',
      )
    }
    this.stagingArea.push(operation)
    return {
      staged: true,
      index: this.stagingArea.length - 1,
      operation,
    }
  }

  commit(message: string): CommitPrepareResult {
    if (this.inflightWrite) {
      throw new PendingHashConflictError('A wallet write is already in progress')
    }
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

  async push(expectedPendingHash: string): Promise<PushResult> {
    // Hash first, before the staging check: after an unconfirmed write the pending
    // commit is deliberately gone, and a retry carrying its hash must be refused as
    // PENDING_HASH_CONFLICT — the code clients read as "refresh, do not retry" —
    // rather than as a generic "nothing to push".
    if (expectedPendingHash && expectedPendingHash !== this.pendingHash) {
      throw new PendingHashConflictError('Pending commit changed')
    }
    this.assertPrepared('push')
    this.beginWrite(expectedPendingHash)
    try {
      return await this.executePush()
    } finally {
      this.inflightWrite = false
    }
  }

  private async executePush(): Promise<PushResult> {
    if (this.stagingArea.length === 0) {
      throw new Error('Nothing to push: staging area is empty')
    }
    if (this.pendingMessage === null || this.pendingHash === null) {
      throw new Error('Nothing to push: please commit first')
    }

    const operations = [...this.stagingArea]
    const message = this.pendingMessage
    const hash = this.pendingHash

    // Execute all operations under ONE write deadline: the lock is held for the
    // whole loop, so the bound must cover the write, not a single call. The loop
    // stops at the first call that does not settle in the remaining budget — the
    // operations after it were never handed to the broker, and carrying on could
    // turn one unknown order into several.
    const writeTimeoutMs = this.config.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS
    const deadline = Date.now() + writeTimeoutMs
    const results: OperationResult[] = []
    let abandoned: { index: number } | null = null
    for (const [index, op] of operations.entries()) {
      const outcome = await this.runBounded((signal) => this.config.executeOperation(op, signal), deadline)
      if (outcome.kind === 'settled') {
        const parsed = this.parseOperationResult(op, outcome.value)
        results.push(parsed)
        // A reported transport failure (CcxtBroker resolves { success: false,
        // error } for every venue error, timeouts included): same rule as the
        // thrown/expired case — stop before dispatching more operations into an
        // unknown venue state.
        if (parsed.status === 'unconfirmed') {
          abandoned = { index }
          break
        }
        continue
      }
      if (outcome.kind === 'failed') {
        const verdict = this.config.classifyOperationError?.(outcome.error) ?? 'rejected'
        const message = outcome.error instanceof Error ? outcome.error.message : String(outcome.error)
        if (verdict === 'unconfirmed') {
          // The request may have reached the venue and no outcome came back
          // (transport failure, venue 5xx, unclassifiable): recording 'rejected'
          // would be a definite claim we cannot back up. The write stops here —
          // the remaining operations were never dispatched, and continuing could
          // turn one unknown order into several.
          abandoned = { index }
          results.push({
            action: op.action,
            success: false,
            status: 'unconfirmed',
            error: `${message} — outcome unknown, reconcile against broker state`,
          })
          break
        }
        results.push({
          action: op.action,
          success: false,
          status: 'rejected',
          error: message,
        })
        continue
      }
      // The call never settled inside the bound, or failed only after the bound
      // aborted it → the outcome is unknown; recording 'rejected' would be a lie
      // (the order may be live).
      abandoned = { index }
      results.push({
        action: op.action,
        success: false,
        status: 'unconfirmed',
        error: outcome.reason === 'aborted'
          ? `Broker call failed after the ${writeTimeoutMs}ms write bound aborted it — outcome unknown, reconcile against broker state`
          : `Broker call did not settle within the ${writeTimeoutMs}ms write bound — outcome unknown, reconcile against broker state`,
      })
      break
    }

    if (abandoned) {
      // Sequential loop: these were never dispatched, so their outcome IS
      // known — not executed.
      for (const op of operations.slice(abandoned.index + 1)) {
        results.push({
          action: op.action,
          success: false,
          status: 'rejected',
          error: `Not executed: the wallet write was abandoned ${writeTimeoutMs}ms after operation ${abandoned.index + 1} went unanswered`,
        })
      }
    }

    // Snapshot state after execution — bounded by the SAME deadline: this read
    // goes to the same broker connection the write just used, so an unanswered
    // call here would hold the wallet lock exactly like an unanswered order.
    const snapshot = await this.readSnapshot(deadline)

    const commit: GitCommit = {
      hash,
      parentHash: this.head,
      message,
      operations,
      results,
      ...snapshot,
      timestamp: new Date().toISOString(),
      round: this.currentRound,
    }

    this.commits.push(commit)
    this.head = hash

    // Clear staging BEFORE persisting: an `onCommit` that rejects must never
    // leave the pending commit alive, or the client could push it again and
    // resubmit operations whose outcome is already decided — or, after a timeout,
    // unknown. That door is what this ordering closes.
    this.stagingArea = []
    this.pendingMessage = null
    this.pendingHash = null

    let persistError: unknown
    try {
      await this.config.onCommit?.(this.exportState())
    } catch (error) {
      // Loud, not fatal: the commit is already in the log and the next successful
      // persist writes the whole export (so the record self-heals), but a
      // durability failure must never be silent.
      persistError = error
      console.error(
        `TradingGit[${hash}]: persisting the commit log failed — ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const rejected = results.filter((r) => !r.success)
    const submitted = results.filter((r) => r.success)

    if (abandoned) {
      // Log written, staging cleared, lock released by push()'s finally. The
      // caller gets an indeterminate verdict rather than a definite outcome the
      // broker never confirmed — and a re-push cannot resubmit, because the
      // pending commit is gone and its operations are recorded here.
      const unconfirmed = results.filter((r) => r.status === 'unconfirmed')
      const snapshotNote = snapshot.stateAfterSource === 'last-known'
        ? '; the post-execution snapshot did not settle, so the previous commit\'s state was carried forward'
        : snapshot.stateAfterSource === 'unavailable'
          ? '; the post-execution snapshot was unavailable'
          : ''
      const persistNote = persistError
        ? `; persisting the commit log also failed (${persistError instanceof Error ? persistError.message : String(persistError)})`
        : ''
      throw new WriteOutcomeUnconfirmedError(
        `Wallet write ${hash} did not confirm: ${unconfirmed.length} operation(s) did not settle within the ${writeTimeoutMs}ms write bound — outcome indeterminate, reconcile against broker state${snapshotNote}${persistNote}`,
        { hash, unconfirmed, logPersisted: persistError === undefined },
      )
    }

    // A confirmed write whose log could not be persisted still fails the caller:
    // the operations reached the broker, but the record of them may be lost on
    // restart. Re-thrown AFTER the staging cleanup above, so the pending commit
    // cannot be pushed a second time.
    if (persistError) throw persistError

    return { hash, message, operationCount: operations.length, submitted, rejected }
  }

  async reject(reason: string | undefined, expectedPendingHash: string): Promise<RejectResult> {
    this.assertPrepared('reject')
    this.beginWrite(expectedPendingHash)
    try {
      return await this.executeReject(reason)
    } finally {
      this.inflightWrite = false
    }
  }

  private async executeReject(reason?: string): Promise<RejectResult> {
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

    // Bounded like the push path: reject holds the SAME write lock, so an
    // unanswered snapshot read here would wedge the account just as badly.
    const rejectDeadline = Date.now() + (this.config.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS)
    const snapshot = await this.readSnapshot(rejectDeadline)

    const commit: GitCommit = {
      hash,
      parentHash: this.head,
      message,
      operations,
      ...snapshot,
      results,
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

  private beginWrite(expectedPendingHash: string): void {
    if (this.inflightWrite) {
      throw new PendingHashConflictError('A wallet write is already in progress')
    }
    if (!expectedPendingHash || expectedPendingHash !== this.pendingHash) {
      throw new PendingHashConflictError('Pending commit changed')
    }
    this.inflightWrite = true
  }

  private assertPrepared(action: 'push' | 'reject'): void {
    if (this.stagingArea.length === 0) {
      throw new Error(`Nothing to ${action}: staging area is empty`)
    }
    if (this.pendingMessage === null || this.pendingHash === null) {
      throw new Error(`Nothing to ${action}: please commit first`)
    }
  }

  /** Await one write-path step until `deadline`; on expiry abort the
   *  (best-effort) signal and report the step as abandoned instead of waiting
   *  forever. The abandoned attempt keeps running: `Promise.race` keeps its
   *  rejection handled, and a late settlement is deliberately ignored — the
   *  commit already recorded the outcome as unknown, and a straggler must not
   *  rewrite a verdict the caller was never told.
   *
   *  A step that fails only AFTER the bound aborted it is reported as
   *  `'unconfirmed'` too: the error it surfaced is the abort, which says nothing
   *  about whether the order was accepted. Only a failure that arrives before the
   *  abort is a definite `'failed'`. */
  private async runBounded<T>(
    run: (signal: AbortSignal) => Promise<T>,
    deadline: number,
  ): Promise<
    | { kind: 'settled'; value: T }
    | { kind: 'failed'; error: unknown }
    | { kind: 'unconfirmed'; reason: 'expired' | 'aborted' }
  > {
    const controller = new AbortController()
    let timer: NodeJS.Timeout | undefined

    try {
      const expiry = new Promise<{ kind: 'unconfirmed'; reason: 'expired' }>((resolve) => {
        // NOT unref'd: the bound must fire even if nothing else holds the event
        // loop open, and the timer is cleared below on every settlement.
        timer = setTimeout(() => {
          controller.abort()
          resolve({ kind: 'unconfirmed', reason: 'expired' })
        }, Math.max(0, deadline - Date.now()))
      })

      const attempt = Promise.resolve()
        .then(() => run(controller.signal))
        .then(
          (value): { kind: 'settled'; value: T } => ({ kind: 'settled', value }),
          (error): { kind: 'failed'; error: unknown } | { kind: 'unconfirmed'; reason: 'aborted' } =>
            controller.signal.aborted ? { kind: 'unconfirmed', reason: 'aborted' } : { kind: 'failed', error },
        )

      return await Promise.race([attempt, expiry])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  /** Post-execution account snapshot for a write that holds the wallet lock.
   *
   *  Bounded by the caller's deadline, because this read goes to the same broker
   *  connection the write just used: an unanswered call here would hold the lock
   *  exactly like an unanswered order (both push and reject take that lock).
   *
   *  When it does not settle, the last state the log already holds is carried
   *  forward and MARKED (`stateAfterSource`) — inventing a snapshot would claim
   *  an account picture that was never read, and dropping the commit would lose
   *  the per-operation verdicts the caller needs. A read that FAILS (rejects) is
   *  a definite answer rather than an unknown one, so it still propagates. */
  private async readSnapshot(
    deadline: number,
  ): Promise<{ stateAfter?: GitState; stateAfterSource?: GitCommit['stateAfterSource'] }> {
    const snapshot = await this.runBounded(() => this.config.getGitState(), deadline)
    if (snapshot.kind === 'settled') return { stateAfter: snapshot.value }
    if (snapshot.kind === 'failed') throw snapshot.error
    const previous = this.commits[this.commits.length - 1]?.stateAfter
    return previous
      ? { stateAfter: previous, stateAfterSource: 'last-known' }
      : { stateAfterSource: 'unavailable' }
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

  /**
   * Record externally-observed open orders as ONE squashed commit — the
   * "commits without a message" the user made on the exchange directly.
   * The log is a faithful record, not the source of final state: once an
   * external order is in the log with orderId + submitted, the regular
   * pending scanner and sync poller track its fill/cancel like any
   * Alice-placed order.
   */
  async recordObservedOrders(params: {
    observed: Array<{ contract: Contract; order: Order; orderId: string }>
    stateAfter: GitState
  }): Promise<CommitHash> {
    const { observed, stateAfter } = params
    const timestamp = new Date().toISOString()

    const operations: Operation[] = observed.map((o) => ({
      action: 'observeExternalOrder',
      contract: o.contract,
      order: o.order,
    }))
    const results: OperationResult[] = observed.map((o) => ({
      action: 'observeExternalOrder',
      success: true,
      orderId: o.orderId,
      status: 'submitted',
    }))

    const message = `[observed] ${observed.length} external order(s) not placed through Alice`
    const hash = generateCommitHash({ message, operations, timestamp, parentHash: this.head })

    const commit: GitCommit = {
      hash,
      parentHash: this.head,
      message,
      operations,
      results,
      stateAfter,
      timestamp,
      round: this.currentRound,
    }

    this.commits.push(commit)
    this.head = hash

    await this.config.onCommit?.(this.exportState())

    return hash
  }

  /** Every broker orderId the log has ever seen — observation diffs against this. */
  getKnownOrderIds(): Set<string> {
    const known = new Set<string>()
    for (const commit of this.commits) {
      for (const result of commit.results) {
        if (result.orderId) known.add(result.orderId)
        for (const leg of result.legs ?? []) known.add(leg.orderId)
      }
    }
    return known
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

    // Sync commits store ONE syncOrders op with N per-order results — iterate
    // the longer of the two so every update gets its own row, attributed by
    // the result's own symbol (the op carries none).
    const count = Math.max(commit.operations.length, commit.results.length)
    for (let i = 0; i < count; i++) {
      const op = commit.operations[i] ?? commit.operations[0]
      const result = commit.results[i]
      const symbol = result?.symbol || getOperationSymbol(op)

      if (filterSymbol && symbol !== filterSymbol) continue

      summaries.push({
        symbol,
        action: op.action,
        change: this.formatOperationChange(op, result),
        // A log row with no recorded verdict (legacy or partial commit data) is
        // indeterminate — the same 'unconfirmed' the write and read paths use —
        // never an invented venue rejection.
        status: result?.status || 'unconfirmed',
        ...(op.action === 'placeOrder' ? {
          order: {
            side: op.order?.action,
            orderType: op.order?.orderType,
            totalQuantity: this.formatOptionalDecimal(op.order?.totalQuantity),
            cashQuantity: this.formatOptionalDecimal(op.order?.cashQty),
            limitPrice: this.formatOptionalDecimal(op.order?.lmtPrice),
            auxPrice: this.formatOptionalDecimal(op.order?.auxPrice),
            timeInForce: op.order?.tif,
          },
        } : {}),
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
        const terms = [
          op.order?.orderType,
          this.formatOptionalDecimal(op.order?.lmtPrice, '@'),
          this.formatOptionalDecimal(op.order?.auxPrice, 'stop @'),
          op.order?.tif,
        ].filter(Boolean).join(' ')
        const orderSummary = `${side} ${sizeStr}${terms ? ` ${terms}` : ''}`

        if (result?.status === 'user-rejected') {
          return `${orderSummary} (user-rejected)`
        }
        if (result?.status === 'filled') {
          const price = result.execution?.price ? ` → filled @${result.execution.price}` : ' (filled)'
          return `${orderSummary}${price}`
        }
        return `${orderSummary} (${result?.status || 'unknown'})`
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

      case 'observeExternalOrder': {
        const side = op.order?.action || 'unknown'
        const qty = op.order?.totalQuantity
        const qtyStr = qty && !qty.equals(UNSET_DECIMAL) ? qty.toFixed() : '?'
        if (result?.status === 'filled') {
          const price = result.filledPrice ? ` @${result.filledPrice}` : ''
          return `external ${side} ${qtyStr}${price}`
        }
        return `external ${side} ${qtyStr} (${result?.status || 'observed'})`
      }

      case 'reconcileBalance': {
        const delta = new Decimal(op.quantityDelta)
        const direction = delta.gte(0) ? 'observed' : 'released'
        return `${direction} ${delta.abs().toFixed()} @${op.markPrice}`
      }
    }
  }

  private formatOptionalDecimal(value: Decimal | undefined, prefix = ''): string | undefined {
    if (!value || value.equals(UNSET_DECIMAL)) return undefined
    return `${prefix}${value.toFixed()}`
  }

  show(hash: CommitHash): GitCommit | null {
    const commit = this.commits.find((c) => c.hash === hash)
    return commit ? this.projectCommit(commit) : null
  }

  status(): GitStatus {
    return {
      staged: this.stagingArea.map((op) => this.projectOperation(op)),
      pendingMessage: this.pendingMessage,
      pendingHash: this.pendingHash,
      head: this.head,
      commitCount: this.commits.length,
    }
  }

  // Strip IBKR sentinel defaults before any Operation leaves this class —
  // raw Order instances stay private to staging / push internals, never
  // observed by external callers (UI, MCP, c.json, on-disk commit.json).
  private projectOperation(op: Operation): Operation {
    if (op.action === 'placeOrder' || op.action === 'observeExternalOrder') {
      return { ...op, order: OrderHelper.toWire(op.order) as unknown as Order }
    }
    if (op.action === 'modifyOrder') {
      return { ...op, changes: OrderHelper.toWire(op.changes) as unknown as Partial<Order> }
    }
    return op
  }

  private projectCommit(commit: GitCommit): GitCommit {
    return { ...commit, operations: commit.operations.map((op) => this.projectOperation(op)) }
  }

  // ==================== Serialization ====================

  exportState(): GitExportState {
    return {
      commits: this.commits.map((c) => this.projectCommit(c)),
      head: this.head,
    }
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
      ...(commit.stateAfter ? { stateAfter: TradingGit.rehydrateGitState(commit.stateAfter) } : {}),
    }
  }

  private static rehydrateOperation(op: Operation): Operation {
    switch (op.action) {
      case 'placeOrder':
      case 'observeExternalOrder':
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
      message: `[sync] ${updates.slice(0, 3).map((u) => `${u.symbol} ${u.currentStatus}`).join(', ')}${updates.length > 3 ? ` +${updates.length - 3} more` : ''}`,
      operations: [{ action: 'syncOrders' as const }],
      results: updates.map((u) => ({
        action: 'syncOrders' as const,
        success: true,
        orderId: u.orderId,
        symbol: u.symbol,
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

  getPendingOrderIds(): Array<{ orderId: string; symbol: string; localSymbol?: string; aliceId?: string }> {
    // Scan newest→oldest to find latest known status per orderId.
    // Bracket TP/SL legs ride in result.legs — born 'submitted'; any later
    // sync row for a leg lives in a newer commit and wins (first-seen-wins
    // over a newest-first scan).
    const orderStatus = new Map<string, string>()

    for (let i = this.commits.length - 1; i >= 0; i--) {
      for (const result of this.commits[i].results) {
        if (result.orderId && !orderStatus.has(result.orderId)) {
          orderStatus.set(result.orderId, result.status)
        }
        for (const leg of result.legs ?? []) {
          if (!orderStatus.has(leg.orderId)) orderStatus.set(leg.orderId, 'submitted')
        }
      }
    }

    // Collect orders still pending
    const pending: Array<{ orderId: string; symbol: string; localSymbol?: string; aliceId?: string }> = []
    const seen = new Set<string>()

    for (const commit of this.commits) {
      for (let j = 0; j < commit.results.length; j++) {
        const result = commit.results[j]
        // Sync commits store ONE syncOrders op with N per-order results —
        // operations[j] is undefined past index 0 (a multi-update sync
        // commit in the journal turned this into a BOOT-LOOP crash once).
        const op = commit.operations[j] ?? commit.operations[0]
        const symbol = getOperationSymbol(op)
        // Broker-native symbol for symbol-scoped order lookups (CCXT).
        // Persisted with the operation, so it survives process restarts
        // where the broker's in-memory orderId→symbol cache is empty.
        const hasContract =
          op?.action === 'placeOrder' || op?.action === 'closePosition' || op?.action === 'observeExternalOrder'
        const localSymbol = hasContract ? op.contract?.localSymbol || undefined : undefined
        const aliceId = hasContract ? op.contract?.aliceId || undefined : undefined

        // Parent order + its bracket legs share the operation's contract.
        const candidates = [
          ...(result.orderId ? [result.orderId] : []),
          ...(result.legs ?? []).map((l) => l.orderId),
        ]
        for (const orderId of candidates) {
          if (seen.has(orderId) || orderStatus.get(orderId) !== 'submitted') continue
          pending.push({
            orderId,
            symbol,
            ...(localSymbol && { localSymbol }),
            ...(aliceId && { aliceId }),
          })
          seen.add(orderId)
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

    // Parse price changes → per-position target prices. Index-keyed: bare
    // symbols collide between an underlying and its derivatives.
    const priceByIndex = new Map<number, Decimal>()
    const excludedDerivatives: string[] = []

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
        for (let i = 0; i < positions.length; i++) {
          // 'all' scales each position's OWN mark — valid for derivatives too.
          priceByIndex.set(i, this.applyPriceChange(new Decimal(positions[i].marketPrice), parsed.type, parsed.value))
        }
      } else {
        for (let i = 0; i < positions.length; i++) {
          const pos = positions[i]
          if ((pos.contract.symbol || pos.contract.aliceId) !== symbol) continue
          // A symbol-level price change describes the UNDERLYING. Derivative
          // rows share the symbol but do NOT move 1:1 with it (an option's
          // own price is not the stock's price) — re-marking them with the
          // stock price produced +23,000% "moves" and inverted PnL. Exclude
          // loudly instead of pricing garbage.
          if (DERIVATIVE_SECTYPES.has(pos.contract.secType)) {
            excludedDerivatives.push(`${symbol} ${pos.contract.secType}${pos.contract.strike && !new Decimal(pos.contract.strike).equals(UNSET_DOUBLE) ? ' ' + pos.contract.strike : ''}`)
            continue
          }
          priceByIndex.set(i, this.applyPriceChange(new Decimal(pos.marketPrice), parsed.type, parsed.value))
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
    const simulatedPositions = positions.map((pos, i) => {
      const sym = pos.contract.symbol || pos.contract.aliceId || 'unknown'
      const mktPrice = new Decimal(pos.marketPrice)
      const simulatedPrice = priceByIndex.get(i) ?? mktPrice
      const priceChange = simulatedPrice.minus(mktPrice)
      const priceChangePct = mktPrice.gt(0) ? priceChange.div(mktPrice).mul(100) : new Decimal(0)
      const q = pos.quantity
      const avgCost = new Decimal(pos.avgCost)
      // Multiplier-aware: 1 option contract at price 1.15 is $115 of value.
      const mult = new Decimal(pos.multiplier || '1')

      const newPnL =
        pos.side === 'long'
          ? simulatedPrice.minus(avgCost).mul(q).mul(mult)
          : avgCost.minus(simulatedPrice).mul(q).mul(mult)

      const pnlChange = newPnL.minus(pos.unrealizedPnL)
      simulatedUnrealizedPnL = simulatedUnrealizedPnL.plus(newPnL)

      return {
        symbol: sym,
        side: pos.side,
        qty: q.toString(),
        avgCost: pos.avgCost,
        simulatedPrice: simulatedPrice.toString(),
        unrealizedPnL: newPnL.toString(),
        marketValue: simulatedPrice.mul(q).mul(mult).toString(),
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

    const excludedNote = excludedDerivatives.length > 0
      ? ` NOTE: derivative positions not simulated (their price does not track the underlying 1:1): ${excludedDerivatives.join(', ')}.`
      : ''
    const worstCase =
      (worst.pnlChange.lt(0)
        ? `${worst.symbol} would lose $${worst.pnlChange.abs().toFixed(2)} (${worst.priceChangePercent})`
        : 'All positions would profit or break even.') + excludedNote

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
        // Not a verdict at all: the engine answered with something we cannot
        // read, so the request left us and no outcome came back — the
        // indeterminate class. Deliberately NOT routed through the classifier:
        // no policy may turn a protocol failure into a definite venue rejection.
        status: 'unconfirmed',
        error: 'Invalid response from trading engine — outcome unknown, reconcile against broker state',
        raw,
      }
    }

    const success = rawObj.success === true

    if (!success) {
      const message = (rawObj.error as string) ?? 'Unknown error'
      return {
        action: op.action,
        success: false,
        // The dispatcher REPORTED a failure instead of throwing it (e.g.
        // CcxtBroker.placeOrder resolves { success: false, error } for every
        // venue error, transport timeouts included). Route it through the same
        // decision as a thrown failure: a transport message means the outcome is
        // unknown, anything else is a refusal.
        status: this.config.classifyOperationError?.(new ReportedOperationFailureError(message)) ?? 'rejected',
        error: message,
        raw,
      }
    }

    const orderId = rawObj.orderId as string | undefined
    const orderState = rawObj.orderState as OperationResult['orderState']
    const legs = rawObj.legs as OperationResult['legs']

    return {
      action: op.action,
      success: true,
      orderId,
      status: this.mapOrderStatus(orderState),
      orderState,
      ...(Array.isArray(legs) && legs.length > 0 ? { legs } : {}),
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
