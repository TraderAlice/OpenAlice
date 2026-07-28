/**
 * Append-only cross-Agent conversation log.
 *
 * HeadlessTaskRegistry remains execution truth for every automation/manual
 * run. This separate stream records only messages dispatched through the
 * Workspace conversation surface, preserving the original prompt, the prompt
 * actually delivered after optional host guidance, safe product identities,
 * and the terminal assistant reply. It is an analysis/audit projection for
 * future prompt-flow inspection and visualization, never a dispatch authority.
 *
 * The log is launcher-owned and private (0600). Native runtime session ids and
 * tool blocks do not enter it.
 */
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

import type {
  WorkspaceConversationCaller,
  WorkspaceConversationResolution,
  WorkspaceConversationTarget,
} from '../core/workspace-tool-center.js'
import type {
  HeadlessInquirySubject,
  HeadlessTaskStatus,
} from './headless-task-registry.js'

interface LoggerLike {
  warn(message: string, meta?: Record<string, unknown>): void
}

export interface AgentConversationDispatch {
  readonly source: WorkspaceConversationCaller
  readonly requestedTarget: WorkspaceConversationTarget
  readonly originalPrompt: string
  readonly deliveredPrompt: string
  readonly promptMode: 'plain' | 'reconstruction'
  readonly resolution: Exclude<WorkspaceConversationResolution, { mode: 'unavailable' }>
  readonly subject?: HeadlessInquirySubject
}

export interface AgentConversationDispatchedEvent {
  readonly schemaVersion: 1
  readonly eventId: string
  readonly type: 'conversation.dispatched'
  readonly at: number
  readonly taskId: string
  readonly parentTaskId?: string
  readonly source: WorkspaceConversationCaller
  readonly target: {
    readonly workspaceId: string
    readonly resumeId: string
    readonly agent: string
  }
  readonly requestedTarget: WorkspaceConversationTarget
  readonly resolution: {
    readonly mode: 'exact' | 'reconstructed'
    readonly reason?: string
  }
  readonly prompt: {
    readonly original: string
    readonly delivered: string
    readonly mode: 'plain' | 'reconstruction'
  }
  readonly subject?: HeadlessInquirySubject
}

export interface AgentConversationCompletedEvent {
  readonly schemaVersion: 1
  readonly eventId: string
  readonly type: 'conversation.completed'
  readonly at: number
  readonly taskId: string
  readonly status: HeadlessTaskStatus
  readonly assistantText: string | null
  readonly durationMs?: number
  readonly error?: string
}

export type AgentConversationLogEvent =
  | AgentConversationDispatchedEvent
  | AgentConversationCompletedEvent

export class AgentConversationLog {
  private appendChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly logger: LoggerLike,
  ) {}

  async recordDispatch(input: {
    readonly taskId: string
    readonly parentTaskId?: string
    readonly resumeId: string
    readonly workspaceId: string
    readonly agent: string
    readonly startedAt: number
    readonly conversation: AgentConversationDispatch
  }): Promise<void> {
    const reason = input.conversation.resolution.mode === 'reconstructed'
      ? input.conversation.resolution.reason
      : undefined
    await this.append({
      schemaVersion: 1,
      eventId: randomUUID(),
      type: 'conversation.dispatched',
      at: input.startedAt,
      taskId: input.taskId,
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      source: input.conversation.source,
      target: {
        workspaceId: input.workspaceId,
        resumeId: input.resumeId,
        agent: input.agent,
      },
      requestedTarget: input.conversation.requestedTarget,
      resolution: {
        mode: input.conversation.resolution.mode,
        ...(reason ? { reason } : {}),
      },
      prompt: {
        original: input.conversation.originalPrompt,
        delivered: input.conversation.deliveredPrompt,
        mode: input.conversation.promptMode,
      },
      ...(input.conversation.subject ? { subject: input.conversation.subject } : {}),
    })
  }

  async recordCompletion(input: {
    readonly taskId: string
    readonly status: HeadlessTaskStatus
    readonly finishedAt: number
    readonly assistantText: string | null
    readonly durationMs?: number
    readonly error?: string
  }): Promise<void> {
    await this.append({
      schemaVersion: 1,
      eventId: randomUUID(),
      type: 'conversation.completed',
      at: input.finishedAt,
      taskId: input.taskId,
      status: input.status,
      assistantText: input.assistantText,
      ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
      ...(input.error ? { error: input.error } : {}),
    })
  }

  private async append(event: AgentConversationLogEvent): Promise<void> {
    const next = this.appendChain.then(async () => {
      try {
        await mkdir(dirname(this.path), { recursive: true })
        await appendFile(this.path, `${JSON.stringify(event)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        })
      } catch (err) {
        this.logger.warn('agent_conversation_log.append_failed', {
          taskId: event.taskId,
          type: event.type,
          err,
        })
      }
    })
    this.appendChain = next.catch(() => undefined)
    await next
  }
}
