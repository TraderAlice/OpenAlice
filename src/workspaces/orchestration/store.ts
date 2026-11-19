/**
 * OrchestrationStore — durable, file-backed state for the orchestration control plane.
 *
 * Persists tasks/dispatches and messages to `orchestration-state.json` using
 * versioned JSON, atomic tmp->rename writes, a serialized flush chain, and
 * bounded retention of oldest settled tasks and acked messages.
 */
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Logger } from '../logger.js'
import type {
  OrchestrationMessage,
  OrchestrationMessageKind,
  OrchestrationMessageMetadata,
  OrchestrationReplyRoute,
  OrchestrationTask,
  OrchestrationTaskStatus,
  StartupReconcileResult,
  WorkerListFilter,
} from './types.js'

const SCHEMA_VERSION = 1
const ID_BYTES = 6
const DEFAULT_MAX_TASKS = 500
const DEFAULT_MAX_MESSAGES = 1000

interface PersistedOrchestrationState {
  version: number
  tasks?: OrchestrationTask[]
  messages?: OrchestrationMessage[]
}

export interface OrchestrationStoreOptions {
  readonly maxTasks?: number
  readonly maxMessages?: number
  readonly logger?: Logger
}

export interface CreateOrchestrationTaskInput {
  readonly taskId?: string
  readonly dispatchId?: string
  readonly parentResumeId: string
  readonly parentWorkspaceId: string
  readonly workerResumeId: string
  readonly workerWorkspaceId: string
  readonly workerAgent: string
  readonly headlessTaskId?: string
  readonly spec: string
  readonly replyRoute: OrchestrationReplyRoute
  readonly maxIdleMs?: number
  readonly createdAt?: number
}

export interface EnqueueOrchestrationMessageInput {
  readonly id?: string
  readonly kind: OrchestrationMessageKind
  readonly taskId: string
  readonly dispatchId: string
  readonly fromResumeId: string
  readonly toResumeId: string
  readonly subject?: string
  readonly body: string
  readonly metadata?: OrchestrationMessageMetadata
  readonly replyToMessageId?: string
  readonly createdAt?: number
}

function isSettledStatus(status: OrchestrationTaskStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'stopped'
}

export class OrchestrationStore {
  private tasks: OrchestrationTask[] = []
  private messages: OrchestrationMessage[] = []
  private flushChain: Promise<void> = Promise.resolve()
  private readonly maxTasks: number
  private readonly maxMessages: number
  private readonly logger?: Logger

  private constructor(
    private readonly path: string,
    opts: OrchestrationStoreOptions = {},
  ) {
    this.maxTasks = opts.maxTasks ?? DEFAULT_MAX_TASKS
    this.maxMessages = opts.maxMessages ?? DEFAULT_MAX_MESSAGES
    this.logger = opts.logger
  }

  /** Load persisted state; missing or corrupt files start empty cleanly. */
  static async load(
    path: string,
    opts: OrchestrationStoreOptions = {},
  ): Promise<OrchestrationStore> {
    const store = new OrchestrationStore(path, opts)
    try {
      const raw = await readFile(path, 'utf8')
      const parsed = JSON.parse(raw) as PersistedOrchestrationState
      if (parsed && typeof parsed === 'object' && parsed.version === SCHEMA_VERSION) {
        store.tasks = Array.isArray(parsed.tasks) ? parsed.tasks : []
        store.messages = Array.isArray(parsed.messages) ? parsed.messages : []
      } else {
        opts.logger?.warn('orchestration_store.unknown_schema', {
          path,
          version: parsed?.version,
        })
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code
      if (code !== 'ENOENT') {
        opts.logger?.warn('orchestration_store.load_failed', { path, err })
      }
      store.tasks = []
      store.messages = []
    }
    return store
  }

  generateTaskId(): string {
    let candidate = `task-${randomBytes(ID_BYTES).toString('base64url')}`
    while (this.tasks.some((t) => t.taskId === candidate)) {
      candidate = `task-${randomBytes(ID_BYTES).toString('base64url')}`
    }
    return candidate
  }

  generateDispatchId(): string {
    let candidate = `dsp-${randomBytes(ID_BYTES).toString('base64url')}`
    while (this.tasks.some((t) => t.dispatchId === candidate)) {
      candidate = `dsp-${randomBytes(ID_BYTES).toString('base64url')}`
    }
    return candidate
  }

  generateMessageId(): string {
    let candidate = `msg-${randomBytes(ID_BYTES).toString('base64url')}`
    while (this.messages.some((m) => m.id === candidate)) {
      candidate = `msg-${randomBytes(ID_BYTES).toString('base64url')}`
    }
    return candidate
  }

  /**
   * Startup reconciliation: detects zombie `'running'` tasks whose headless
   * execution is no longer active after server restart, marks them `'failed'`
   * with `stopReason: 'lost'`, and enqueues an `'escalation'` message to
   * `parentResumeId`.
   */
  async reconcileOnStartup(
    isTaskActive: (headlessTaskId: string) => boolean,
    nowMs?: number,
  ): Promise<StartupReconcileResult> {
    const at = nowMs ?? Date.now()
    const lostTasks: OrchestrationTask[] = []
    const escalations: OrchestrationMessage[] = []

    for (const task of this.tasks) {
      if (task.status !== 'running') continue
      const active = Boolean(task.headlessTaskId && isTaskActive(task.headlessTaskId))
      if (active) continue

      task.status = 'failed'
      task.outcome = 'failed'
      task.stopReason = 'lost'
      task.settledAt = at
      task.updatedAt = at
      lostTasks.push(task)

      // Clear stale queued worker-bound messages from before restart so the
      // first post-restart tick does not auto-resurrect a lost worker.
      for (const m of this.messages) {
        if (
          m.dispatchId === task.dispatchId &&
          m.toResumeId === task.workerResumeId &&
          m.status !== 'acked'
        ) {
          m.status = 'acked'
          m.ackedAt = at
          delete m.leasedAt
          delete m.leaseExpiresAt
        }
      }

      const escalation: OrchestrationMessage = {
        id: this.generateMessageId(),
        kind: 'escalation',
        taskId: task.taskId,
        dispatchId: task.dispatchId,
        fromResumeId: task.workerResumeId,
        toResumeId: task.parentResumeId,
        subject: 'Worker lost after server restart',
        body: `Worker dispatch ${task.dispatchId} was running before restart and is no longer active (stopReason: lost).`,
        metadata: {
          stopReason: 'lost',
          workerWorkspaceId: task.workerWorkspaceId,
          workerAgent: task.workerAgent,
        },
        status: 'unread',
        createdAt: at,
      }
      this.messages.push(escalation)
      escalations.push(escalation)
    }

    if (lostTasks.length > 0) {
      this.prune()
      await this.flush()
    }
    return { lostTasks, escalations }
  }

  async createTask(input: CreateOrchestrationTaskInput): Promise<OrchestrationTask> {
    const at = input.createdAt ?? Date.now()
    const task: OrchestrationTask = {
      taskId: input.taskId ?? this.generateTaskId(),
      dispatchId: input.dispatchId ?? this.generateDispatchId(),
      parentResumeId: input.parentResumeId,
      parentWorkspaceId: input.parentWorkspaceId,
      workerResumeId: input.workerResumeId,
      workerWorkspaceId: input.workerWorkspaceId,
      workerAgent: input.workerAgent,
      ...(input.headlessTaskId ? { headlessTaskId: input.headlessTaskId } : {}),
      spec: input.spec,
      status: 'running',
      createdAt: at,
      updatedAt: at,
      replyRoute: structuredClone(input.replyRoute),
      turnCount: 1,
      ...(input.maxIdleMs !== undefined ? { maxIdleMs: input.maxIdleMs } : {}),
    }
    this.tasks.push(task)
    this.prune()
    await this.flush()
    return task
  }

  async updateTask(
    dispatchId: string,
    updater: (task: OrchestrationTask) => void,
    nowMs?: number,
  ): Promise<OrchestrationTask | undefined> {
    const task = this.tasks.find((t) => t.dispatchId === dispatchId)
    if (!task) return undefined
    updater(task)
    task.updatedAt = nowMs ?? Date.now()
    this.prune()
    await this.flush()
    return task
  }

  getTaskByDispatchId(dispatchId: string): OrchestrationTask | undefined {
    return this.tasks.find((t) => t.dispatchId === dispatchId)
  }

  getTaskById(taskId: string): OrchestrationTask | undefined {
    for (let i = this.tasks.length - 1; i >= 0; i -= 1) {
      if (this.tasks[i]?.taskId === taskId) return this.tasks[i]
    }
    return undefined
  }

  findTaskByHeadlessTaskId(headlessTaskId: string): OrchestrationTask | undefined {
    for (let i = this.tasks.length - 1; i >= 0; i -= 1) {
      if (this.tasks[i]?.headlessTaskId === headlessTaskId) return this.tasks[i]
    }
    return undefined
  }

  findLatestTaskForWorkerResumeId(workerResumeId: string): OrchestrationTask | undefined {
    for (let i = this.tasks.length - 1; i >= 0; i -= 1) {
      if (this.tasks[i]?.workerResumeId === workerResumeId) return this.tasks[i]
    }
    return undefined
  }

  runningTasks(): OrchestrationTask[] {
    return this.tasks.filter((t) => t.status === 'running')
  }

  listTasks(filter: WorkerListFilter = {}): OrchestrationTask[] {
    const allowedStatuses = filter.status
      ? typeof filter.status === 'string'
        ? new Set<OrchestrationTaskStatus>([filter.status])
        : new Set<OrchestrationTaskStatus>(filter.status)
      : null

    let rows = this.tasks.filter((task) => {
      if (filter.parentResumeId && task.parentResumeId !== filter.parentResumeId) return false
      if (filter.workerResumeId && task.workerResumeId !== filter.workerResumeId) return false
      if (filter.workerWorkspaceId && task.workerWorkspaceId !== filter.workerWorkspaceId) return false
      if (filter.taskId && task.taskId !== filter.taskId) return false
      if (filter.dispatchId && task.dispatchId !== filter.dispatchId) return false
      if (allowedStatuses && !allowedStatuses.has(task.status)) return false
      if (filter.includeSettled === false && isSettledStatus(task.status)) return false
      return true
    })

    rows = rows.slice().sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
    if (filter.limit !== undefined && filter.limit > 0) {
      rows = rows.slice(0, filter.limit)
    }
    return rows
  }

  async enqueueMessage(input: EnqueueOrchestrationMessageInput): Promise<OrchestrationMessage> {
    const at = input.createdAt ?? Date.now()
    const message: OrchestrationMessage = {
      id: input.id ?? this.generateMessageId(),
      kind: input.kind,
      taskId: input.taskId,
      dispatchId: input.dispatchId,
      fromResumeId: input.fromResumeId,
      toResumeId: input.toResumeId,
      ...(input.subject ? { subject: input.subject } : {}),
      body: input.body,
      ...(input.metadata ? { metadata: structuredClone(input.metadata) } : {}),
      status: 'unread',
      createdAt: at,
      ...(input.replyToMessageId ? { replyToMessageId: input.replyToMessageId } : {}),
    }
    this.messages.push(message)
    this.prune()
    await this.flush()
    return message
  }

  getMessage(messageId: string): OrchestrationMessage | undefined {
    return this.messages.find((m) => m.id === messageId)
  }

  /** All pending (`unread` + `leased`) messages for `toResumeId`, oldest-first. */
  pendingMessagesFor(toResumeId: string): OrchestrationMessage[] {
    return this.messages
      .filter((m) => m.toResumeId === toResumeId && (m.status === 'unread' || m.status === 'leased'))
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Messages currently eligible for delivery: `unread`, or `leased` whose lease expired. */
  deliverableMessagesFor(toResumeId: string, nowMs?: number): OrchestrationMessage[] {
    const at = nowMs ?? Date.now()
    return this.messages
      .filter(
        (m) =>
          m.toResumeId === toResumeId &&
          (m.status === 'unread' || (m.status === 'leased' && (m.leaseExpiresAt ?? 0) <= at)),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /** True while at least one message for `toResumeId` holds an unexpired delivery lease. */
  hasActiveLease(toResumeId: string, nowMs?: number): boolean {
    const at = nowMs ?? Date.now()
    return this.messages.some(
      (m) =>
        m.toResumeId === toResumeId &&
        m.status === 'leased' &&
        (m.leaseExpiresAt ?? 0) > at,
    )
  }

  /**
   * Mark ONLY the exact delivered `messageIds` as `'leased'` with a finite TTL.
   * Messages not in `messageIds` (e.g., concurrent arrivals mid-delivery) stay untouched.
   */
  async leaseMessages(
    toResumeId: string,
    messageIds: readonly string[],
    leaseMs: number,
    nowMs?: number,
  ): Promise<OrchestrationMessage[]> {
    const at = nowMs ?? Date.now()
    const idSet = new Set(messageIds)
    const leased: OrchestrationMessage[] = []
    let changed = false

    for (const m of this.messages) {
      if (m.toResumeId !== toResumeId || !idSet.has(m.id)) continue
      if (m.status === 'acked') continue
      m.status = 'leased'
      m.leasedAt = at
      m.leaseExpiresAt = at + leaseMs
      leased.push(m)
      changed = true
    }

    if (changed) await this.flush()
    return leased.sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Transition expired `'leased'` messages back to `'unread'` so they are eligible for retry. */
  async expireLeases(nowMs?: number): Promise<OrchestrationMessage[]> {
    const at = nowMs ?? Date.now()
    const expired: OrchestrationMessage[] = []
    for (const m of this.messages) {
      if (m.status === 'leased' && (m.leaseExpiresAt ?? 0) <= at) {
        m.status = 'unread'
        delete m.leasedAt
        delete m.leaseExpiresAt
        expired.push(m)
      }
    }
    if (expired.length > 0) await this.flush()
    return expired
  }

  /** Acknowledge pending (`unread` + `leased`) messages for `toResumeId` (all, or scoped by `messageIds`). */
  async ackMessages(
    toResumeId: string,
    messageIds?: readonly string[],
    nowMs?: number,
  ): Promise<OrchestrationMessage[]> {
    const at = nowMs ?? Date.now()
    const idSet = messageIds ? new Set(messageIds) : null
    const acked: OrchestrationMessage[] = []

    for (const m of this.messages) {
      if (m.toResumeId !== toResumeId) continue
      if (m.status !== 'unread' && m.status !== 'leased') continue
      if (idSet && !idSet.has(m.id)) continue
      m.status = 'acked'
      m.ackedAt = at
      delete m.leasedAt
      delete m.leaseExpiresAt
      acked.push(m)
    }

    if (acked.length > 0) {
      this.prune()
      await this.flush()
    }
    return acked.sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Acknowledge a single message by ID (idempotent if already acked). */
  async ackMessageById(
    messageId: string,
    nowMs?: number,
  ): Promise<OrchestrationMessage | undefined> {
    const message = this.messages.find((m) => m.id === messageId)
    if (!message) return undefined
    if (message.status === 'acked') return message
    const at = nowMs ?? Date.now()
    message.status = 'acked'
    message.ackedAt = at
    delete message.leasedAt
    delete message.leaseExpiresAt
    this.prune()
    await this.flush()
    return message
  }

  /** Acknowledge pending messages matching a custom predicate (used when acting on a dispatch). */
  async ackMatchingMessages(
    predicate: (message: OrchestrationMessage) => boolean,
    nowMs?: number,
  ): Promise<OrchestrationMessage[]> {
    const at = nowMs ?? Date.now()
    const acked: OrchestrationMessage[] = []
    for (const m of this.messages) {
      if (m.status === 'acked') continue
      if (!predicate(m)) continue
      m.status = 'acked'
      m.ackedAt = at
      delete m.leasedAt
      delete m.leaseExpiresAt
      acked.push(m)
    }
    if (acked.length > 0) {
      this.prune()
      await this.flush()
    }
    return acked
  }

  /** Read-only audit history for `toResumeId` (including already-acked messages), newest-first. */
  inboxFor(toResumeId: string, limit?: number): OrchestrationMessage[] {
    const rows = this.messages
      .filter((m) => m.toResumeId === toResumeId)
      .sort((a, b) => b.createdAt - a.createdAt)
    return limit !== undefined && limit > 0 ? rows.slice(0, limit) : rows
  }

  messagesForDispatch(dispatchId: string): OrchestrationMessage[] {
    return this.messages
      .filter((m) => m.dispatchId === dispatchId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Unique recipients with deliverable work (`unread` or expired `leased`) and no active lease. */
  recipientsWithDeliverableWork(nowMs?: number): string[] {
    const at = nowMs ?? Date.now()
    const out = new Set<string>()
    for (const m of this.messages) {
      const deliverable =
        m.status === 'unread' || (m.status === 'leased' && (m.leaseExpiresAt ?? 0) <= at)
      if (deliverable && !this.hasActiveLease(m.toResumeId, at)) {
        out.add(m.toResumeId)
      }
    }
    return [...out]
  }

  private prune(): void {
    if (this.tasks.length > this.maxTasks) {
      let overflow = this.tasks.length - this.maxTasks
      const kept: OrchestrationTask[] = []
      for (const task of this.tasks) {
        if (overflow > 0 && isSettledStatus(task.status)) {
          overflow -= 1
          continue
        }
        kept.push(task)
      }
      this.tasks = kept
    }

    if (this.messages.length > this.maxMessages) {
      let overflow = this.messages.length - this.maxMessages
      const kept: OrchestrationMessage[] = []
      for (const msg of this.messages) {
        if (overflow > 0 && msg.status === 'acked') {
          overflow -= 1
          continue
        }
        kept.push(msg)
      }
      this.messages = kept
    }
  }

  private async flush(): Promise<void> {
    const next = this.flushChain.then(() => this.flushNow())
    this.flushChain = next.catch(() => undefined)
    await next
  }

  private async flushNow(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    const payload: PersistedOrchestrationState = {
      version: SCHEMA_VERSION,
      tasks: this.tasks,
      messages: this.messages,
    }
    await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8')
    await rename(tmp, this.path)
  }
}
