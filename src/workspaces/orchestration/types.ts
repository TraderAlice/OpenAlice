import type { ModelReasoningEffort } from '../../ai-providers/model-semantics.js'
import type {
  HeadlessTaskInquiry,
  HeadlessTaskTrigger,
} from '../headless-task-registry.js'

export type OrchestrationTaskStatus =
  | 'running'
  | 'waiting_parent'
  | 'done'
  | 'failed'
  | 'stopped'

export type OrchestrationTaskOutcome = 'completed' | 'failed' | 'inconclusive'

export type OrchestrationReplySurface = 'connector' | 'web' | 'pty' | 'headless'

/**
 * Immutable routing context captured when a coordinator launches a worker.
 *
 * Waking a parent (especially a Telegram/connector phone-desk Session) ALWAYS
 * replays this captured route instead of guessing from `latestForResumeId`,
 * ensuring replies stay bound to the originating channel.
 */
export interface OrchestrationReplyRoute {
  readonly workspaceId: string
  readonly resumeId: string
  readonly trigger?: HeadlessTaskTrigger
  readonly inquiry?: HeadlessTaskInquiry
  readonly connectorId?: string
  readonly issueId?: string
  readonly surface?: OrchestrationReplySurface
}

export interface OrchestrationDeliverable {
  readonly path: string
  readonly workspaceId?: string
  readonly summary?: string
}

export interface OrchestrationTask {
  readonly taskId: string
  readonly dispatchId: string
  readonly parentResumeId: string
  readonly parentWorkspaceId: string
  readonly workerResumeId: string
  readonly workerWorkspaceId: string
  readonly workerAgent: string
  /** Latest headless execution id (`run-...`) for liveness and settlement correlation. */
  headlessTaskId?: string
  readonly spec: string
  status: OrchestrationTaskStatus
  readonly createdAt: number
  updatedAt: number
  settledAt?: number
  outcome?: OrchestrationTaskOutcome
  summary?: string
  evidence?: string
  deliverables?: OrchestrationDeliverable[]
  stopReason?: string
  readonly replyRoute: OrchestrationReplyRoute
  turnCount: number
  readonly maxIdleMs?: number
}

export type OrchestrationMessageKind =
  | 'question'
  | 'reply'
  | 'worker_done'
  | 'escalation'
  | 'send'

export type OrchestrationMessageStatus = 'unread' | 'leased' | 'acked'

export interface OrchestrationMessageMetadata {
  readonly outcome?: OrchestrationTaskOutcome
  readonly evidence?: string
  readonly deliverables?: readonly OrchestrationDeliverable[]
  readonly stopReason?: string
  readonly assistantPreview?: string | null
  readonly error?: string
  readonly workerWorkspaceId?: string
  readonly workerAgent?: string
}

export interface OrchestrationMessage {
  readonly id: string
  readonly kind: OrchestrationMessageKind
  readonly taskId: string
  readonly dispatchId: string
  readonly fromResumeId: string
  readonly toResumeId: string
  readonly subject?: string
  readonly body: string
  readonly metadata?: OrchestrationMessageMetadata
  status: OrchestrationMessageStatus
  readonly createdAt: number
  leasedAt?: number
  leaseExpiresAt?: number
  ackedAt?: number
  readonly replyToMessageId?: string
}

export type OrchestrationSurfaceDeliveryResult = 'delivered' | 'busy' | 'absent'

export type OrchestrationHeadlessDeliveryOutcome =
  | 'delivered'
  | 'busy'
  | 'unavailable'
  | { readonly status: 'delivered'; readonly headlessTaskId?: string }

export type OrchestrationTryDeliverResult =
  | 'delivered'
  | 'leased'
  | 'parked'
  | 'noop'
  | 'unavailable'

export interface OrchestrationTickSummary {
  readonly expiredLeaseCount: number
  readonly stalledDispatchIds: readonly string[]
  readonly attemptedRecipients: readonly string[]
  readonly deliveredRecipients: readonly string[]
}

export type OrchestrationHarnessTarget = 'chat' | 'autoquant' | 'prediction'

export interface WorkerStartInput {
  readonly parentResumeId: string
  readonly parentWorkspaceId: string
  /** Target workspace id (overrides `harness`; defaults to `parentWorkspaceId`). */
  readonly workspaceId?: string
  /** Optional harness workspace resolution when `workspaceId` is omitted. */
  readonly harness?: OrchestrationHarnessTarget
  readonly spec: string
  /** Optional task id to group multiple dispatches under one logical task. */
  readonly taskId?: string
  readonly agent?: string
  readonly model?: string
  readonly effort?: ModelReasoningEffort
  readonly credential?: string
  readonly credentialSource?: 'native'
  readonly timeoutMs?: number
  readonly maxIdleMs?: number
  /** Optional explicit replyRoute fields merged on top of auto-captured context. */
  readonly replyRoute?: Partial<OrchestrationReplyRoute>
}

export interface WorkerStartResult {
  readonly task: OrchestrationTask
  readonly headlessTaskId: string
  readonly workerResumeId: string
  readonly workerWorkspaceId: string
  readonly workerWorkspaceTag: string
  readonly workerAgent: string
}

export interface WorkerListFilter {
  readonly parentResumeId?: string
  readonly workerResumeId?: string
  readonly workerWorkspaceId?: string
  readonly taskId?: string
  readonly dispatchId?: string
  readonly status?: OrchestrationTaskStatus | readonly OrchestrationTaskStatus[]
  readonly includeSettled?: boolean
  readonly limit?: number
}

export interface WorkerListItem {
  readonly task: OrchestrationTask
  readonly live: boolean
  readonly pendingQuestions: readonly OrchestrationMessage[]
  readonly unreadMessagesForParent: number
  readonly queuedMessagesForWorker: number
  readonly nextAction: string
}

export interface WorkerStopResult {
  readonly task: OrchestrationTask
  readonly stoppedExecution: boolean
}

export interface OrchestrationSendInput {
  readonly toDispatchId: string
  readonly fromResumeId: string
  readonly subject?: string
  readonly body: string
}

export interface OrchestrationSendResult {
  readonly task: OrchestrationTask
  readonly message: OrchestrationMessage
  readonly mode: 'queued' | 'resumed'
  readonly headlessTaskId?: string
}

export interface OrchestrationAskInput {
  readonly dispatchId: string
  readonly fromResumeId: string
  readonly subject?: string
  readonly body: string
}

export interface OrchestrationAskResult {
  readonly task: OrchestrationTask
  readonly message: OrchestrationMessage
  readonly wakeResult: OrchestrationTryDeliverResult
}

export interface OrchestrationReplyInput {
  readonly messageId: string
  readonly fromResumeId: string
  readonly body: string
}

export interface OrchestrationReplyResult {
  readonly task: OrchestrationTask
  readonly question: OrchestrationMessage
  readonly reply: OrchestrationMessage
  readonly wakeResult: OrchestrationTryDeliverResult
}

export interface OrchestrationWorkerDoneInput {
  readonly dispatchId: string
  readonly fromResumeId: string
  readonly outcome: OrchestrationTaskOutcome
  readonly summary: string
  readonly evidence?: string
  readonly deliverables?: readonly OrchestrationDeliverable[]
}

export interface OrchestrationWorkerDoneResult {
  readonly task: OrchestrationTask
  readonly message: OrchestrationMessage
  readonly wakeResult: OrchestrationTryDeliverResult
}

export interface OrchestrationCheckInput {
  readonly recipientResumeId: string
}

export interface OrchestrationInboxInput {
  readonly recipientResumeId: string
  readonly limit?: number
}

export interface WorkerHeadlessSettledInput {
  readonly headlessTaskId: string
  readonly workerResumeId: string
  readonly status: 'done' | 'failed' | 'interrupted'
  readonly assistantPreview?: string | null
  readonly error?: string
}

export interface StartupReconcileResult {
  readonly lostTasks: readonly OrchestrationTask[]
  readonly escalations: readonly OrchestrationMessage[]
}

export type OrchestrationErrorCode =
  | 'not_found'
  | 'invalid_state'
  | 'unauthorized'
  | 'workspace_unavailable'
  | 'adapter_unavailable'
  | 'invalid_input'

export class OrchestrationError extends Error {
  constructor(
    readonly code: OrchestrationErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'OrchestrationError'
  }
}
