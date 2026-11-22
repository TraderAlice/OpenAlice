/**
 * OrchestrationManager — control plane for Orca-grade worker orchestration.
 *
 * Runtime-agnostic: coordinates Tasks/Dispatches, strict worker protocol
 * (`ask` / `reply` / `worker-done` / `send` / `stopped_without_done` escalation),
 * immutable `ReplyRoute` capture, and multi-surface wake delivery.
 */
import type { SessionCreatedBy } from '../session-metadata.js'
import type { SessionRuntimeSelection } from '../session-runtime-binding.js'
import type { ExecutionOrigin } from '../session-execution-manager.js'
import type { WorkspaceMeta } from '../workspace-registry.js'

import type { HeadlessDeliveredEvent, OrchestrationDelivery } from './delivery.js'
import { buildWorkerPreamble } from './preamble.js'
import type { OrchestrationStore } from './store.js'
import {
  OrchestrationError,
  type OrchestrationAskInput,
  type OrchestrationAskResult,
  type OrchestrationCheckInput,
  type OrchestrationHarnessTarget,
  type OrchestrationInboxInput,
  type OrchestrationMessage,
  type OrchestrationReplyInput,
  type OrchestrationReplyRoute,
  type OrchestrationReplyResult,
  type OrchestrationSendInput,
  type OrchestrationSendResult,
  type OrchestrationTask,
  type OrchestrationTickSummary,
  type OrchestrationWorkerDoneInput,
  type OrchestrationWorkerDoneResult,
  type StartupReconcileResult,
  type WorkerHeadlessSettledInput,
  type WorkerListFilter,
  type WorkerListItem,
  type WorkerStartInput,
  type WorkerStartResult,
  type WorkerStopResult,
} from './types.js'

export interface WorkerDispatchRequest {
  readonly workspace: WorkspaceMeta
  readonly agent?: string
  readonly selection?: SessionRuntimeSelection
  readonly prompt: string
  readonly origin: ExecutionOrigin
  readonly timeoutMs?: number
  readonly createdBy: SessionCreatedBy
}

export interface WorkerDispatchResult {
  readonly taskId: string
  readonly resumeId: string
  readonly agent: string
}

export interface OrchestrationManagerDeps {
  readonly store: OrchestrationStore
  readonly delivery: OrchestrationDelivery
  readonly resolveWorkspace: (workspaceId: string) => WorkspaceMeta | undefined
  readonly resolveHarnessWorkspace?: (
    harness: OrchestrationHarnessTarget,
  ) => Promise<WorkspaceMeta | undefined>
  readonly captureReplyRoute: (
    parentResumeId: string,
    parentWorkspaceId: string,
  ) => Promise<OrchestrationReplyRoute> | OrchestrationReplyRoute
  readonly dispatchWorker: (request: WorkerDispatchRequest) => Promise<WorkerDispatchResult>
  readonly stopWorkerExecution: (workerResumeId: string, reason: string) => Promise<boolean>
  readonly isSessionRunning: (resumeId: string) => boolean
  readonly now?: () => number
}

function buildRuntimeSelection(input: WorkerStartInput): SessionRuntimeSelection | undefined {
  if (input.credential && input.credentialSource === 'native') {
    throw new OrchestrationError(
      'invalid_input',
      'Cannot specify both credential slug and credentialSource "native".',
    )
  }
  const hasAny =
    input.credential !== undefined ||
    input.credentialSource !== undefined ||
    input.model !== undefined ||
    input.effort !== undefined
  if (!hasAny) return undefined
  return {
    ...(input.credentialSource ? { credentialSource: input.credentialSource } : {}),
    ...(input.credential ? { credentialSlug: input.credential } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.effort ? { reasoningEffort: input.effort } : {}),
  }
}

function birthReasonForHarness(
  harness: OrchestrationHarnessTarget | undefined,
): 'explicit-workspace' | 'harness-chat' | 'harness-autoquant' | 'harness-prediction' {
  if (harness === 'chat') return 'harness-chat'
  if (harness === 'autoquant') return 'harness-autoquant'
  if (harness === 'prediction') return 'harness-prediction'
  return 'explicit-workspace'
}

function nextActionHint(
  task: OrchestrationTask,
  live: boolean,
  pendingQuestions: readonly OrchestrationMessage[],
): string {
  if (pendingQuestions.length > 0) {
    const first = pendingQuestions[0]!
    return `Reply to worker question: alice orchestration reply --id ${first.id} --body "<answer>"`
  }
  if (task.status === 'running') {
    if (live) {
      return `Worker is running (turn ${task.turnCount}). Wait for completion or queue a message with: alice orchestration send --to dispatch:${task.dispatchId} --body "<message>"`
    }
    return `Worker has no active process; follow up with: alice orchestration send --to dispatch:${task.dispatchId} --body "<message>"`
  }
  if (task.status === 'waiting_parent') {
    return `Worker is waiting for parent reply; run \`alice orchestration check\` to view pending question(s).`
  }
  if (task.status === 'done') {
    return `Completed (${task.outcome ?? 'completed'}). Send a follow-up if needed: alice orchestration send --to dispatch:${task.dispatchId} --body "<message>"`
  }
  if (task.status === 'failed') {
    return `Failed (${task.stopReason ?? task.outcome ?? 'failed'}). Resume with: alice orchestration send --to dispatch:${task.dispatchId} --body "<message>"`
  }
  return `Stopped (${task.stopReason ?? 'stopped'}). Resume with: alice orchestration send --to dispatch:${task.dispatchId} --body "<message>"`
}

export class OrchestrationManager {
  private readonly now: () => number

  constructor(private readonly deps: OrchestrationManagerDeps) {
    this.now = deps.now ?? Date.now
    this.deps.delivery.addHeadlessDeliveredListener((event) =>
      this.handleHeadlessDelivered(event),
    )
  }

  getTask(dispatchId: string): OrchestrationTask | undefined {
    return this.deps.store.getTaskByDispatchId(dispatchId)
  }

  listTasks(filter: WorkerListFilter = {}): OrchestrationTask[] {
    return this.deps.store.listTasks(filter).map((task) => structuredClone(task))
  }

  listMessages(
    filter: Parameters<OrchestrationStore['listMessages']>[0] = {},
  ): OrchestrationMessage[] {
    return this.deps.store.listMessages(filter)
  }

  async reconcileOnStartup(
    isTaskActive: (headlessTaskId: string) => boolean,
    nowMs?: number,
  ): Promise<StartupReconcileResult> {
    return this.deps.store.reconcileOnStartup(isTaskActive, nowMs ?? this.now())
  }

  /**
   * Launch a new orchestrated worker dispatch:
   * - Resolves target Workspace (`workspaceId` -> `harness` -> `parentWorkspaceId`)
   * - Captures immutable `replyRoute` from the parent Session
   * - Injects the strict Orca worker Preamble
   * - Dispatches the headless worker and persists the Task/Dispatch record
   */
  async workerStart(input: WorkerStartInput): Promise<WorkerStartResult> {
    const spec = input.spec.trim()
    if (!spec) {
      throw new OrchestrationError('invalid_input', 'Worker spec must be non-empty.')
    }
    if (!input.parentResumeId.trim() || !input.parentWorkspaceId.trim()) {
      throw new OrchestrationError(
        'invalid_input',
        'parentResumeId and parentWorkspaceId are required.',
      )
    }

    const targetWorkspace = await this.resolveTargetWorkspace(input)
    const selection = buildRuntimeSelection(input)

    const capturedRoute = await this.deps.captureReplyRoute(
      input.parentResumeId,
      input.parentWorkspaceId,
    )
    const replyRoute: OrchestrationReplyRoute = {
      ...capturedRoute,
      ...(input.replyRoute ?? {}),
      workspaceId: input.replyRoute?.workspaceId ?? capturedRoute.workspaceId ?? input.parentWorkspaceId,
      resumeId: input.parentResumeId,
    }

    const taskId = input.taskId?.trim() || this.deps.store.generateTaskId()
    const dispatchId = this.deps.store.generateDispatchId()
    const prompt = buildWorkerPreamble({
      taskId,
      dispatchId,
      parentResumeId: input.parentResumeId,
      workerWorkspaceId: targetWorkspace.id,
      spec,
    })

    const dispatched = await this.deps.dispatchWorker({
      workspace: targetWorkspace,
      ...(input.agent ? { agent: input.agent } : {}),
      ...(selection ? { selection } : {}),
      prompt,
      origin: {
        kind: 'session',
        entry: 'orchestration-worker-start',
        workspaceId: input.parentWorkspaceId,
        resumeId: input.parentResumeId,
      },
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      createdBy: {
        kind: 'conversation',
        caller: {
          kind: 'agent',
          resumeId: input.parentResumeId,
          workspaceId: input.parentWorkspaceId,
        },
        reason: birthReasonForHarness(input.workspaceId ? undefined : input.harness),
      },
    })

    const task = await this.deps.store.createTask({
      taskId,
      dispatchId,
      parentResumeId: input.parentResumeId,
      parentWorkspaceId: input.parentWorkspaceId,
      workerResumeId: dispatched.resumeId,
      workerWorkspaceId: targetWorkspace.id,
      workerAgent: dispatched.agent,
      headlessTaskId: dispatched.taskId,
      spec,
      replyRoute,
      ...(input.maxIdleMs !== undefined ? { maxIdleMs: input.maxIdleMs } : {}),
      createdAt: this.now(),
    })

    return {
      task,
      headlessTaskId: dispatched.taskId,
      workerResumeId: dispatched.resumeId,
      workerWorkspaceId: targetWorkspace.id,
      workerWorkspaceTag: targetWorkspace.tag,
      workerAgent: dispatched.agent,
    }
  }

  /** List tasks/dispatches with live execution state, pending questions, and next action hints. */
  workerList(filter: WorkerListFilter = {}): WorkerListItem[] {
    const tasks = this.deps.store.listTasks(filter)
    return tasks.map((task) => {
      const live = this.deps.isSessionRunning(task.workerResumeId)
      const messages = this.deps.store.messagesForDispatch(task.dispatchId)
      const pendingQuestions = messages.filter(
        (m) => m.kind === 'question' && m.status !== 'acked',
      )
      const unreadMessagesForParent = messages.filter(
        (m) => m.toResumeId === task.parentResumeId && m.status !== 'acked',
      ).length
      const queuedMessagesForWorker = messages.filter(
        (m) => m.toResumeId === task.workerResumeId && m.status !== 'acked',
      ).length
      return {
        task,
        live,
        pendingQuestions,
        unreadMessagesForParent,
        queuedMessagesForWorker,
        nextAction: nextActionHint(task, live, pendingQuestions),
      }
    })
  }

  /** Stop a worker and mark its dispatch `stopped` before terminating execution. */
  async workerStop(
    dispatchId: string,
    reason = 'stopped_by_coordinator',
  ): Promise<WorkerStopResult> {
    const existing = this.deps.store.getTaskByDispatchId(dispatchId)
    if (!existing) {
      throw new OrchestrationError('not_found', `Orchestration dispatch not found: ${dispatchId}`)
    }
    const at = this.now()
    const cleanReason = reason.trim() || 'stopped_by_coordinator'

    // Mark `stopped` BEFORE stopping the underlying execution so the resulting
    // `interrupted` settlement does not emit a spurious escalation.
    const updated = await this.deps.store.updateTask(
      dispatchId,
      (task) => {
        task.status = 'stopped'
        task.stopReason = cleanReason
        task.settledAt = at
      },
      at,
    )

    // Clear pending parent-bound questions/escalations AND any queued worker-bound
    // messages for this stopped dispatch so settlement / watchdog ticks never
    // resurrect an explicitly stopped worker.
    await this.deps.store.ackMatchingMessages(
      (m) =>
        m.dispatchId === dispatchId &&
        (
          (m.toResumeId === existing.parentResumeId &&
            (m.kind === 'question' || m.kind === 'escalation')) ||
          m.toResumeId === existing.workerResumeId
        ),
      at,
    )

    const stoppedExecution = await this.deps.stopWorkerExecution(
      existing.workerResumeId,
      cleanReason,
    )

    return {
      task: updated ?? existing,
      stoppedExecution,
    }
  }

  /**
   * Send a follow-up message to a worker dispatch in ANY state:
   * - If the worker is currently running, queues `'send'` delivered on turn settle.
   * - If the worker is idle/finished/waiting/failed/stopped, resumes the worker
   *   Session immediately as a follow-up turn.
   */
  async send(input: OrchestrationSendInput): Promise<OrchestrationSendResult> {
    const body = input.body.trim()
    if (!body) {
      throw new OrchestrationError('invalid_input', 'Message body must be non-empty.')
    }
    const task = this.deps.store.getTaskByDispatchId(input.toDispatchId)
    if (!task) {
      throw new OrchestrationError(
        'not_found',
        `Orchestration dispatch not found: ${input.toDispatchId}`,
      )
    }

    const at = this.now()
    if (input.fromResumeId === task.parentResumeId) {
      await this.deps.store.ackMatchingMessages(
        (m) =>
          m.dispatchId === task.dispatchId &&
          m.toResumeId === task.parentResumeId &&
          m.kind === 'escalation' &&
          m.status === 'leased',
        at,
      )
    }

    const running = this.deps.isSessionRunning(task.workerResumeId)
    if (!running) {
      // Clear any stale leases from an already-ended worker turn so immediate
      // follow-up delivery is never blocked by a prior turn's lease.
      await this.deps.store.ackMatchingMessages(
        (m) =>
          m.dispatchId === task.dispatchId &&
          m.toResumeId === task.workerResumeId &&
          m.status === 'leased',
        at,
      )
    }

    const message = await this.deps.store.enqueueMessage({
      kind: 'send',
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      fromResumeId: input.fromResumeId,
      toResumeId: task.workerResumeId,
      ...(input.subject?.trim() ? { subject: input.subject.trim() } : {}),
      body,
      createdAt: at,
    })

    if (running) {
      return {
        task,
        message,
        mode: 'queued',
      }
    }

    const previousTurnCount = task.turnCount
    const wakeResult = await this.deps.delivery.tryDeliver(task.workerResumeId)
    if (wakeResult === 'delivered') {
      const latest = this.deps.store.getTaskByDispatchId(task.dispatchId) ?? task
      // If delivered via Web/PTY rather than headless, `handleHeadlessDelivered`
      // did not run — update task status and turn count here.
      if (latest.turnCount === previousTurnCount || latest.status !== 'running') {
        await this.deps.store.updateTask(
          task.dispatchId,
          (t) => {
            t.status = 'running'
            delete t.settledAt
            delete t.stopReason
            if (t.turnCount === previousTurnCount) {
              t.turnCount += 1
            }
          },
          this.now(),
        )
      }
      const resumedTask = this.deps.store.getTaskByDispatchId(task.dispatchId) ?? task
      return {
        task: resumedTask,
        message,
        mode: 'resumed',
        ...(resumedTask.headlessTaskId ? { headlessTaskId: resumedTask.headlessTaskId } : {}),
      }
    }

    return {
      task,
      message,
      mode: 'queued',
    }
  }

  /**
   * Worker asks coordinator a question: transitions task to `'waiting_parent'`,
   * enqueues `'question'` to `parentResumeId`, and wakes parent immediately.
   */
  async ask(input: OrchestrationAskInput): Promise<OrchestrationAskResult> {
    const body = input.body.trim()
    if (!body) {
      throw new OrchestrationError('invalid_input', 'Question body must be non-empty.')
    }
    const task = this.deps.store.getTaskByDispatchId(input.dispatchId)
    if (!task) {
      throw new OrchestrationError(
        'not_found',
        `Orchestration dispatch not found: ${input.dispatchId}`,
      )
    }
    if (input.fromResumeId !== task.workerResumeId) {
      throw new OrchestrationError(
        'unauthorized',
        `Session ${input.fromResumeId} does not own worker dispatch ${input.dispatchId}.`,
      )
    }
    if (task.status !== 'running' && task.status !== 'waiting_parent') {
      throw new OrchestrationError(
        'invalid_state',
        `Cannot ask on dispatch ${input.dispatchId} in status "${task.status}".`,
      )
    }

    const at = this.now()
    // Worker acted on any leased inbound instructions/replies for this dispatch.
    await this.deps.store.ackMatchingMessages(
      (m) =>
        m.dispatchId === task.dispatchId &&
        m.toResumeId === task.workerResumeId &&
        m.status === 'leased',
      at,
    )

    const updated =
      (await this.deps.store.updateTask(
        task.dispatchId,
        (t) => {
          t.status = 'waiting_parent'
        },
        at,
      )) ?? task

    const message = await this.deps.store.enqueueMessage({
      kind: 'question',
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      fromResumeId: task.workerResumeId,
      toResumeId: task.parentResumeId,
      ...(input.subject?.trim() ? { subject: input.subject.trim() } : {}),
      body,
      metadata: {
        workerWorkspaceId: task.workerWorkspaceId,
        workerAgent: task.workerAgent,
      },
      createdAt: at,
    })

    const wakeResult = await this.deps.delivery.tryDeliver(
      task.parentResumeId,
      task.replyRoute,
    )

    return {
      task: updated,
      message,
      wakeResult,
    }
  }

  /**
   * Coordinator replies to a worker's `'question'`: validates target message,
   * acks the question, transitions task back to `'running'`, enqueues `'reply'`
   * to `workerResumeId`, and wakes worker immediately.
   */
  async reply(input: OrchestrationReplyInput): Promise<OrchestrationReplyResult> {
    const body = input.body.trim()
    if (!body) {
      throw new OrchestrationError('invalid_input', 'Reply body must be non-empty.')
    }
    const question = this.deps.store.getMessage(input.messageId)
    if (!question) {
      throw new OrchestrationError(
        'not_found',
        `Orchestration message not found: ${input.messageId}`,
      )
    }
    if (question.kind !== 'question') {
      throw new OrchestrationError(
        'invalid_input',
        `Message ${input.messageId} is kind "${question.kind}", expected "question".`,
      )
    }
    if (question.status === 'acked') {
      throw new OrchestrationError(
        'invalid_state',
        `Question ${input.messageId} has already been answered/acknowledged.`,
      )
    }

    const task = this.deps.store.getTaskByDispatchId(question.dispatchId)
    if (!task) {
      throw new OrchestrationError(
        'not_found',
        `Orchestration dispatch not found: ${question.dispatchId}`,
      )
    }
    if (input.fromResumeId !== task.parentResumeId) {
      throw new OrchestrationError(
        'unauthorized',
        `Session ${input.fromResumeId} is not the coordinator for dispatch ${task.dispatchId}.`,
      )
    }
    if (task.status === 'stopped') {
      throw new OrchestrationError(
        'invalid_state',
        `Cannot reply to stopped dispatch ${task.dispatchId}.`,
      )
    }

    const at = this.now()
    await this.deps.store.ackMessageById(question.id, at)

    if (!this.deps.isSessionRunning(task.workerResumeId)) {
      await this.deps.store.ackMatchingMessages(
        (m) =>
          m.dispatchId === task.dispatchId &&
          m.toResumeId === task.workerResumeId &&
          m.status === 'leased',
        at,
      )
    }

    const replyMessage = await this.deps.store.enqueueMessage({
      kind: 'reply',
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      fromResumeId: task.parentResumeId,
      toResumeId: task.workerResumeId,
      body,
      replyToMessageId: question.id,
      createdAt: at,
    })

    // Only transition task -> `running` once delivery actually succeeds.
    // If the worker's `ask` turn is still wrapping up (`parked`) or hits
    // transient capacity, keeping `waiting_parent` prevents a false
    // `stopped_without_done` escalation when turn 1 exits; `onWorkerHeadlessSettled`
    // (or `tick()`) will drain the queued reply and flip to `running` via
    // `handleHeadlessDelivered`.
    const previousTurnCount = task.turnCount
    const wakeResult = await this.deps.delivery.tryDeliver(task.workerResumeId)
    if (wakeResult === 'delivered') {
      const latest = this.deps.store.getTaskByDispatchId(task.dispatchId) ?? task
      if (latest.turnCount === previousTurnCount || latest.status !== 'running') {
        await this.deps.store.updateTask(
          task.dispatchId,
          (t) => {
            t.status = 'running'
            delete t.settledAt
            delete t.stopReason
            if (t.turnCount === previousTurnCount) {
              t.turnCount += 1
            }
          },
          this.now(),
        )
      }
    }
    const updatedTask = this.deps.store.getTaskByDispatchId(task.dispatchId) ?? task

    return {
      task: updatedTask,
      question,
      reply: replyMessage,
      wakeResult,
    }
  }

  /**
   * Worker reports completion: settles task (`done` or `failed`), enqueues
   * `'worker_done'` to `parentResumeId`, and wakes parent immediately.
   */
  async workerDone(
    input: OrchestrationWorkerDoneInput,
  ): Promise<OrchestrationWorkerDoneResult> {
    const summary = input.summary.trim()
    if (!summary) {
      throw new OrchestrationError('invalid_input', 'worker-done summary must be non-empty.')
    }
    const task = this.deps.store.getTaskByDispatchId(input.dispatchId)
    if (!task) {
      throw new OrchestrationError(
        'not_found',
        `Orchestration dispatch not found: ${input.dispatchId}`,
      )
    }
    if (input.fromResumeId !== task.workerResumeId) {
      throw new OrchestrationError(
        'unauthorized',
        `Session ${input.fromResumeId} does not own worker dispatch ${input.dispatchId}.`,
      )
    }
    if (task.status !== 'running' && task.status !== 'waiting_parent') {
      throw new OrchestrationError(
        'invalid_state',
        `Cannot call worker-done on dispatch ${input.dispatchId} in status "${task.status}".`,
      )
    }

    const at = this.now()
    await this.deps.store.ackMatchingMessages(
      (m) =>
        m.dispatchId === task.dispatchId &&
        m.toResumeId === task.workerResumeId &&
        m.status === 'leased',
      at,
    )

    const nextStatus = input.outcome === 'failed' ? 'failed' : 'done'
    const deliverables = input.deliverables ? [...input.deliverables] : undefined
    const updated =
      (await this.deps.store.updateTask(
        task.dispatchId,
        (t) => {
          t.status = nextStatus
          t.outcome = input.outcome
          t.summary = summary
          if (input.evidence !== undefined) t.evidence = input.evidence
          if (deliverables !== undefined) t.deliverables = deliverables
          t.settledAt = at
          delete t.stopReason
        },
        at,
      )) ?? task

    const message = await this.deps.store.enqueueMessage({
      kind: 'worker_done',
      taskId: task.taskId,
      dispatchId: task.dispatchId,
      fromResumeId: task.workerResumeId,
      toResumeId: task.parentResumeId,
      body: summary,
      metadata: {
        outcome: input.outcome,
        ...(input.evidence !== undefined ? { evidence: input.evidence } : {}),
        ...(deliverables !== undefined ? { deliverables } : {}),
        workerWorkspaceId: task.workerWorkspaceId,
        workerAgent: task.workerAgent,
      },
      createdAt: at,
    })

    const wakeResult = await this.deps.delivery.tryDeliver(
      task.parentResumeId,
      task.replyRoute,
    )

    return {
      task: updated,
      message,
      wakeResult,
    }
  }

  /** Return all pending (`unread` + `leased`) messages for `recipientResumeId` and ack them. */
  async check(input: OrchestrationCheckInput): Promise<OrchestrationMessage[]> {
    return this.deps.store.ackMessages(input.recipientResumeId, undefined, this.now())
  }

  /** Read-only audit history for `recipientResumeId` including already-acked messages. */
  inbox(input: OrchestrationInboxInput): OrchestrationMessage[] {
    return this.deps.store.inboxFor(input.recipientResumeId, input.limit)
  }

  /**
   * Strict Orca guard invoked when any headless turn settles:
   * - If the dispatch is still `'running'` (neither `worker-done` nor `ask` called),
   *   marks it `'failed'` and emits an `'escalation'` (`stopped_without_done` /
   *   `failed` / `interrupted`) with `assistantPreview` & `error` to `parentResumeId`.
   * - Drains any queued `'send'` / `'reply'` messages waiting for that worker.
   */
  async onWorkerHeadlessSettled(input: WorkerHeadlessSettledInput): Promise<void> {
    const task = this.deps.store.findTaskByHeadlessTaskId(input.headlessTaskId)
    if (!task) return
    if (task.workerResumeId !== input.workerResumeId) return

    const at = this.now()

    if (task.status === 'running') {
      const stopReason =
        input.status === 'done' ? 'stopped_without_done' : input.status
      await this.deps.store.updateTask(
        task.dispatchId,
        (t) => {
          t.status = 'failed'
          t.outcome = 'failed'
          t.stopReason = stopReason
          t.settledAt = at
        },
        at,
      )

      const detailParts: string[] = [
        stopReason === 'stopped_without_done'
          ? `Worker dispatch ${task.dispatchId} exited without calling \`worker-done\` or \`ask\`.`
          : `Worker dispatch ${task.dispatchId} terminated with status "${stopReason}".`,
      ]
      if (input.error) {
        detailParts.push(`Error: ${input.error}`)
      }

      await this.deps.store.enqueueMessage({
        kind: 'escalation',
        taskId: task.taskId,
        dispatchId: task.dispatchId,
        fromResumeId: task.workerResumeId,
        toResumeId: task.parentResumeId,
        subject: `Worker escalation (${stopReason})`,
        body: detailParts.join('\n'),
        metadata: {
          stopReason,
          assistantPreview: input.assistantPreview ?? null,
          ...(input.error ? { error: input.error } : {}),
          workerWorkspaceId: task.workerWorkspaceId,
          workerAgent: task.workerAgent,
        },
        createdAt: at,
      })

      await this.deps.delivery.tryDeliver(task.parentResumeId, task.replyRoute)
    }

    // Never resurrect an explicitly stopped worker via settle drain.
    const latestAfterGuard = this.deps.store.getTaskByDispatchId(task.dispatchId) ?? task
    if (latestAfterGuard.status === 'stopped') return

    // Drain any queued `send` / `reply` messages waiting for this worker.
    const queuedForWorker = this.deps.store
      .deliverableMessagesFor(input.workerResumeId, at)
      .filter((m) => m.dispatchId === task.dispatchId)
    if (queuedForWorker.length > 0) {
      // Clear any stale leases from the turn that just ended so queued messages deliver immediately.
      await this.deps.store.ackMatchingMessages(
        (m) =>
          m.dispatchId === task.dispatchId &&
          m.toResumeId === input.workerResumeId &&
          m.status === 'leased',
        at,
      )
      const previousTurnCount = latestAfterGuard.turnCount
      const wakeResult = await this.deps.delivery.tryDeliver(input.workerResumeId)
      if (wakeResult === 'delivered') {
        const latest = this.deps.store.getTaskByDispatchId(task.dispatchId) ?? latestAfterGuard
        if (latest.turnCount === previousTurnCount || latest.status !== 'running') {
          await this.deps.store.updateTask(
            task.dispatchId,
            (t) => {
              t.status = 'running'
              delete t.settledAt
              delete t.stopReason
              if (t.turnCount === previousTurnCount) {
                t.turnCount += 1
              }
            },
            this.now(),
          )
        }
      }
    }
  }

  async onSessionSettled(resumeId: string): Promise<void> {
    await this.deps.delivery.onSessionSettled(resumeId)
  }

  async tick(nowMs?: number): Promise<OrchestrationTickSummary> {
    return this.deps.delivery.tick(nowMs ?? this.now())
  }

  private async handleHeadlessDelivered(event: HeadlessDeliveredEvent): Promise<void> {
    const at = this.now()
    const workerDispatchIds = new Set<string>()
    for (const msg of event.messages) {
      const task = this.deps.store.getTaskByDispatchId(msg.dispatchId)
      if (task && task.workerResumeId === event.recipientResumeId) {
        workerDispatchIds.add(task.dispatchId)
      }
    }
    for (const dispatchId of workerDispatchIds) {
      await this.deps.store.updateTask(
        dispatchId,
        (t) => {
          t.status = 'running'
          delete t.settledAt
          delete t.stopReason
          if (event.headlessTaskId) {
            t.headlessTaskId = event.headlessTaskId
          }
          t.turnCount += 1
        },
        at,
      )
    }
  }

  private async resolveTargetWorkspace(input: WorkerStartInput): Promise<WorkspaceMeta> {
    if (input.workspaceId) {
      const ws = this.deps.resolveWorkspace(input.workspaceId)
      if (!ws) {
        throw new OrchestrationError(
          'workspace_unavailable',
          `Target workspace not found: ${input.workspaceId}`,
        )
      }
      return ws
    }

    if (input.harness) {
      if (!this.deps.resolveHarnessWorkspace) {
        throw new OrchestrationError(
          'workspace_unavailable',
          `Harness resolution is not configured for "${input.harness}".`,
        )
      }
      const ws = await this.deps.resolveHarnessWorkspace(input.harness)
      if (!ws) {
        throw new OrchestrationError(
          'workspace_unavailable',
          `Harness workspace "${input.harness}" is not available or initialized.`,
        )
      }
      return ws
    }

    const parentWs = this.deps.resolveWorkspace(input.parentWorkspaceId)
    if (!parentWs) {
      throw new OrchestrationError(
        'workspace_unavailable',
        `Parent workspace not found: ${input.parentWorkspaceId}`,
      )
    }
    return parentWs
  }
}
