/**
 * OrchestrationDelivery — multi-surface, lease-based wake delivery + 60s watchdog.
 *
 * Priority: live Web session -> live Terminal PTY -> headless continuation.
 *
 * Key invariants:
 * - Inline delivery on Web/Headless when formatted messages fit under threshold
 *   (default 4000 chars); compact pointer (`alice orchestration check`) on PTY
 *   or when oversized.
 * - Finite delivery leases (default 120s) scoped strictly to the exact
 *   `messageIds` captured before delivery — zero infinite watermarks and zero
 *   concurrent-arrival swallowing.
 * - Immutable `replyRoute` passed to `deliverToHeadless` when waking a parent,
 *   preserving Telegram/connector phone-desk reply channels without guessing
 *   from `latestForResumeId`.
 * - Durable retry + stall watchdog via `tick(nowMs)` driven by ScheduleScanner's
 *   60s tick (zero extra timers).
 */
import type { OrchestrationStore } from './store.js'
import type {
  OrchestrationHeadlessDeliveryOutcome,
  OrchestrationMessage,
  OrchestrationReplyRoute,
  OrchestrationSurfaceDeliveryResult,
  OrchestrationTask,
  OrchestrationTickSummary,
  OrchestrationTryDeliverResult,
} from './types.js'

export const DEFAULT_LEASE_MS = 120_000
export const DEFAULT_INLINE_THRESHOLD_CHARS = 4_000

export function formatCompactPointer(
  messages: readonly OrchestrationMessage[],
  _recipientResumeId: string,
): string {
  const count = messages.length
  const plural = count === 1 ? '' : 's'
  const kinds = [...new Set(messages.map((m) => m.kind))].join(', ')
  return `You have ${count} pending orchestration message${plural} (${kinds}). Run \`alice orchestration check\` to read and acknowledge.`
}

function formatSingleInlineMessage(message: OrchestrationMessage): string {
  const lines: string[] = []
  const headerSubject = message.subject ? ` — ${message.subject}` : ''
  lines.push(`### [${message.kind}] ${message.id} (dispatch: ${message.dispatchId}, task: ${message.taskId})${headerSubject}`)
  lines.push(`From: ${message.fromResumeId}`)

  if (message.kind === 'question') {
    lines.push('')
    lines.push(message.body)
    lines.push('')
    lines.push(`Action: Reply with \`alice orchestration reply --id ${message.id} --body "<your answer>"\``)
  } else if (message.kind === 'escalation') {
    if (message.metadata?.stopReason) {
      lines.push(`Stop Reason: ${message.metadata.stopReason}`)
    }
    if (message.metadata?.error) {
      lines.push(`Error: ${message.metadata.error}`)
    }
    lines.push('')
    lines.push(message.body)
    if (message.metadata?.assistantPreview) {
      lines.push('')
      lines.push(`Last Worker Output Preview:\n${message.metadata.assistantPreview}`)
    }
    lines.push('')
    lines.push(
      `Action: Follow up with \`alice orchestration send --to dispatch:${message.dispatchId} --body "<instructions>"\` or acknowledge with \`alice orchestration check\`.`,
    )
  } else if (message.kind === 'worker_done') {
    if (message.metadata?.outcome) {
      lines.push(`Outcome: ${message.metadata.outcome}`)
    }
    lines.push('')
    lines.push(`Summary: ${message.body}`)
    if (message.metadata?.evidence) {
      lines.push(`Evidence: ${message.metadata.evidence}`)
    }
    if (message.metadata?.deliverables && message.metadata.deliverables.length > 0) {
      lines.push('Deliverables:')
      for (const item of message.metadata.deliverables) {
        const suffix = item.summary ? ` — ${item.summary}` : ''
        const wsPrefix = item.workspaceId ? `[${item.workspaceId}] ` : ''
        lines.push(`- ${wsPrefix}${item.path}${suffix}`)
      }
    }
    lines.push('')
    lines.push(
      `Action: Run \`alice orchestration check\` to acknowledge, or send a follow-up with \`alice orchestration send --to dispatch:${message.dispatchId} --body "<instructions>"\`.`,
    )
  } else if (message.kind === 'reply') {
    if (message.replyToMessageId) {
      lines.push(`In-Reply-To: ${message.replyToMessageId}`)
    }
    lines.push('')
    lines.push(message.body)
    lines.push('')
    lines.push(
      `Action: Continue your work and finish with \`alice orchestration worker-done --dispatch ${message.dispatchId} --outcome completed|failed|inconclusive --summary "..."\` or ask again with \`alice orchestration ask --dispatch ${message.dispatchId} --body "..."\`.`,
    )
  } else {
    // 'send'
    lines.push('')
    lines.push(message.body)
    lines.push('')
    lines.push(
      `Action: Handle this message and finish with \`alice orchestration worker-done --dispatch ${message.dispatchId} --outcome completed|failed|inconclusive --summary "..."\` or ask with \`alice orchestration ask --dispatch ${message.dispatchId} --body "..."\`.`,
    )
  }

  return lines.join('\n')
}

export function formatInlineWake(messages: readonly OrchestrationMessage[]): string {
  const count = messages.length
  const plural = count === 1 ? '' : 's'
  const header = `[Orchestration Wake — ${count} pending message${plural}]`
  return [header, '', ...messages.map(formatSingleInlineMessage)].join('\n\n')
}

export interface HeadlessDeliveredEvent {
  readonly recipientResumeId: string
  readonly headlessTaskId?: string
  readonly messageIds: readonly string[]
  readonly messages: readonly OrchestrationMessage[]
}

export interface OrchestrationDeliveryDeps {
  readonly store: OrchestrationStore
  readonly deliverToWeb: (
    resumeId: string,
    prompt: string,
  ) => Promise<OrchestrationSurfaceDeliveryResult>
  readonly deliverToPty: (
    resumeId: string,
    pointerText: string,
  ) => Promise<OrchestrationSurfaceDeliveryResult>
  readonly deliverToHeadless?: (
    resumeId: string,
    prompt: string,
    replyRoute: OrchestrationReplyRoute | undefined,
  ) => Promise<OrchestrationHeadlessDeliveryOutcome>
  /** Invoked after a headless delivery succeeds so callers can track worker turn ids. */
  readonly onHeadlessDelivered?: (event: HeadlessDeliveredEvent) => Promise<void> | void
  /** Best-effort stop when watchdog detects a running task past `maxIdleMs`. */
  readonly stopStalledWorker?: (task: OrchestrationTask) => Promise<void> | void
  readonly warn?: (event: string, detail: Record<string, unknown>) => void
  readonly leaseMs?: number
  readonly inlineThresholdChars?: number
  readonly now?: () => number
}

function normalizeHeadlessOutcome(
  outcome: OrchestrationHeadlessDeliveryOutcome,
): { status: 'delivered' | 'busy' | 'unavailable'; headlessTaskId?: string } {
  if (typeof outcome === 'string') return { status: outcome }
  return { status: outcome.status, ...(outcome.headlessTaskId ? { headlessTaskId: outcome.headlessTaskId } : {}) }
}

export class OrchestrationDelivery {
  private readonly inFlight = new Set<string>()
  private readonly reentrantPending = new Set<string>()
  private readonly parked = new Set<string>()
  private readonly headlessDeliveredListeners: Array<
    (event: HeadlessDeliveredEvent) => Promise<void> | void
  > = []
  private readonly leaseMs: number
  private readonly inlineThresholdChars: number
  private readonly now: () => number

  constructor(private readonly deps: OrchestrationDeliveryDeps) {
    this.leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS
    this.inlineThresholdChars = deps.inlineThresholdChars ?? DEFAULT_INLINE_THRESHOLD_CHARS
    this.now = deps.now ?? Date.now
  }

  addHeadlessDeliveredListener(
    listener: (event: HeadlessDeliveredEvent) => Promise<void> | void,
  ): void {
    this.headlessDeliveredListeners.push(listener)
  }

  /**
   * Attempt delivery to `recipientResumeId`. Safe under concurrent calls:
   * re-entrant callers mark `reentrantPending` and drain after the current
   * attempt finishes instead of stranding unread work.
   */
  async tryDeliver(
    recipientResumeId: string,
    replyRouteOverride?: OrchestrationReplyRoute,
  ): Promise<OrchestrationTryDeliverResult> {
    if (this.inFlight.has(recipientResumeId)) {
      this.reentrantPending.add(recipientResumeId)
      this.parked.add(recipientResumeId)
      return 'parked'
    }

    this.inFlight.add(recipientResumeId)
    let result: OrchestrationTryDeliverResult = 'noop'
    try {
      result = await this.deliverOnce(recipientResumeId, replyRouteOverride)
    } finally {
      this.inFlight.delete(recipientResumeId)
    }

    if (this.reentrantPending.delete(recipientResumeId)) {
      const nowMs = this.now()
      if (
        !this.deps.store.hasActiveLease(recipientResumeId, nowMs) &&
        this.deps.store.deliverableMessagesFor(recipientResumeId, nowMs).length > 0
      ) {
        return this.tryDeliver(recipientResumeId, replyRouteOverride)
      }
    }

    return result
  }

  /** Called when a surface settles (Web idle, PTY quiescent, headless turn finished). */
  async onSessionSettled(recipientResumeId: string): Promise<void> {
    const nowMs = this.now()
    const hasDeliverable =
      this.deps.store.deliverableMessagesFor(recipientResumeId, nowMs).length > 0
    if (this.parked.has(recipientResumeId) || hasDeliverable) {
      this.parked.delete(recipientResumeId)
      if (hasDeliverable && !this.deps.store.hasActiveLease(recipientResumeId, nowMs)) {
        await this.tryDeliver(recipientResumeId)
      }
    }
  }

  /**
   * Periodic watchdog tick (wired to ScheduleScanner's 60s tick):
   * 1. Expire any stale delivery leases back to `unread`.
   * 2. Detect stalled `running` tasks past `maxIdleMs`, mark `failed` with
   *    `stopReason: 'stalled'`, and enqueue an `escalation` to `parentResumeId`.
   * 3. Durably retry delivery for all sessions with deliverable work.
   */
  async tick(nowMs?: number): Promise<OrchestrationTickSummary> {
    const at = nowMs ?? this.now()
    const expired = await this.deps.store.expireLeases(at)

    const stalledDispatchIds: string[] = []
    for (const task of this.deps.store.runningTasks()) {
      if (task.maxIdleMs === undefined || task.maxIdleMs <= 0) continue
      if (at - task.updatedAt < task.maxIdleMs) continue

      stalledDispatchIds.push(task.dispatchId)
      await this.deps.store.updateTask(
        task.dispatchId,
        (t) => {
          t.status = 'failed'
          t.outcome = 'failed'
          t.stopReason = 'stalled'
          t.settledAt = at
        },
        at,
      )
      if (this.deps.stopStalledWorker) {
        try {
          await this.deps.stopStalledWorker(task)
        } catch (err) {
          this.deps.warn?.('orchestration.stalled_worker_stop_failed', {
            dispatchId: task.dispatchId,
            workerResumeId: task.workerResumeId,
            err,
          })
        }
      }
      await this.deps.store.enqueueMessage({
        kind: 'escalation',
        taskId: task.taskId,
        dispatchId: task.dispatchId,
        fromResumeId: task.workerResumeId,
        toResumeId: task.parentResumeId,
        subject: 'Worker stalled past maxIdleMs',
        body: `Worker dispatch ${task.dispatchId} exceeded its idle budget (${task.maxIdleMs}ms) without reporting progress (stopReason: stalled).`,
        metadata: {
          stopReason: 'stalled',
          workerWorkspaceId: task.workerWorkspaceId,
          workerAgent: task.workerAgent,
        },
        createdAt: at,
      })
    }

    const recipients = this.deps.store.recipientsWithDeliverableWork(at)
    const deliveredRecipients: string[] = []
    for (const recipientResumeId of recipients) {
      try {
        const res = await this.tryDeliver(recipientResumeId)
        if (res === 'delivered') deliveredRecipients.push(recipientResumeId)
      } catch (err) {
        this.deps.warn?.('orchestration.tick_delivery_failed', { recipientResumeId, err })
      }
    }

    return {
      expiredLeaseCount: expired.length,
      stalledDispatchIds,
      attemptedRecipients: recipients,
      deliveredRecipients,
    }
  }

  private resolveReplyRoute(
    recipientResumeId: string,
    messages: readonly OrchestrationMessage[],
    override?: OrchestrationReplyRoute,
  ): OrchestrationReplyRoute | undefined {
    if (override && override.resumeId === recipientResumeId) {
      return override
    }
    // Walk newest-first so the most recent dispatch context governs routing.
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const msg = messages[i]
      if (!msg) continue
      const task = this.deps.store.getTaskByDispatchId(msg.dispatchId)
      if (!task) continue
      if (recipientResumeId === task.parentResumeId) {
        return task.replyRoute
      }
      if (recipientResumeId === task.workerResumeId) {
        // Worker resumes must NEVER inherit parent's connector trigger/inquiry.
        return {
          workspaceId: task.workerWorkspaceId,
          resumeId: task.workerResumeId,
          surface: 'headless',
        }
      }
    }
    return override
  }

  private async deliverOnce(
    recipientResumeId: string,
    replyRouteOverride?: OrchestrationReplyRoute,
  ): Promise<OrchestrationTryDeliverResult> {
    const nowMs = this.now()
    const deliverable = this.deps.store.deliverableMessagesFor(recipientResumeId, nowMs)
    if (deliverable.length === 0) return 'noop'
    if (this.deps.store.hasActiveLease(recipientResumeId, nowMs)) return 'leased'

    const messageIds = deliverable.map((m) => m.id)
    const pointerText = formatCompactPointer(deliverable, recipientResumeId)
    const inlineText = formatInlineWake(deliverable)
    const richPrompt =
      inlineText.length <= this.inlineThresholdChars ? inlineText : pointerText

    // 1. Live Web session
    try {
      const web = await this.deps.deliverToWeb(recipientResumeId, richPrompt)
      if (web === 'delivered') {
        await this.deps.store.leaseMessages(recipientResumeId, messageIds, this.leaseMs, this.now())
        this.parked.delete(recipientResumeId)
        return 'delivered'
      }
      if (web === 'busy') {
        this.parked.add(recipientResumeId)
        return 'parked'
      }
    } catch (err) {
      this.deps.warn?.('orchestration.deliver_web_failed', { recipientResumeId, err })
      this.parked.add(recipientResumeId)
      return 'parked'
    }

    // 2. Live Terminal PTY (always compact pointer to avoid corrupting TUI input)
    try {
      const pty = await this.deps.deliverToPty(recipientResumeId, pointerText)
      if (pty === 'delivered') {
        await this.deps.store.leaseMessages(recipientResumeId, messageIds, this.leaseMs, this.now())
        this.parked.delete(recipientResumeId)
        return 'delivered'
      }
      if (pty === 'busy') {
        this.parked.add(recipientResumeId)
        return 'parked'
      }
    } catch (err) {
      this.deps.warn?.('orchestration.deliver_pty_failed', { recipientResumeId, err })
      this.parked.add(recipientResumeId)
      return 'parked'
    }

    // 3. Headless continuation with immutable ReplyRoute
    if (this.deps.deliverToHeadless) {
      const replyRoute = this.resolveReplyRoute(recipientResumeId, deliverable, replyRouteOverride)
      try {
        const raw = await this.deps.deliverToHeadless(recipientResumeId, richPrompt, replyRoute)
        const headless = normalizeHeadlessOutcome(raw)
        if (headless.status === 'delivered') {
          await this.deps.store.leaseMessages(recipientResumeId, messageIds, this.leaseMs, this.now())
          this.parked.delete(recipientResumeId)
          const event: HeadlessDeliveredEvent = {
            recipientResumeId,
            ...(headless.headlessTaskId ? { headlessTaskId: headless.headlessTaskId } : {}),
            messageIds,
            messages: deliverable,
          }
          if (this.deps.onHeadlessDelivered) {
            await this.deps.onHeadlessDelivered(event)
          }
          for (const listener of this.headlessDeliveredListeners) {
            await listener(event)
          }
          return 'delivered'
        }
        if (headless.status === 'busy') {
          this.parked.add(recipientResumeId)
          return 'parked'
        }
        this.parked.add(recipientResumeId)
        return 'unavailable'
      } catch (err) {
        this.deps.warn?.('orchestration.deliver_headless_failed', { recipientResumeId, err })
        this.parked.add(recipientResumeId)
        return 'parked'
      }
    }

    this.parked.add(recipientResumeId)
    return 'parked'
  }
}
