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
import { appendFile, mkdir, readFile } from 'node:fs/promises'
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

export type AgentConversationSource =
  | { readonly kind: 'human' }
  | { readonly kind: 'workspace'; readonly workspaceId: string }
  | {
      readonly kind: 'session'
      readonly workspaceId: string
      readonly resumeId: string
      readonly agent: string
    }

export interface AgentConversationRecord {
  readonly taskId: string
  readonly parentTaskId?: string
  readonly dispatchedAt: number
  readonly completedAt?: number
  readonly status: HeadlessTaskStatus
  readonly source: AgentConversationSource
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
  readonly assistantText: string | null
  readonly durationMs?: number
  readonly error?: string
}

export interface AgentConversationQueryResult {
  readonly entries: AgentConversationRecord[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly totalPages: number
}

export class AgentConversationLog {
  private appendChain: Promise<void> = Promise.resolve()
  private cachedEvents: AgentConversationLogEvent[] | null = null
  private cacheRevision = 0

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

  /** Read a UI-safe joined projection. Page 1 contains the newest dispatches. */
  async query(opts: {
    readonly page?: number
    readonly pageSize?: number
  } = {}): Promise<AgentConversationQueryResult> {
    await this.appendChain
    const page = Math.max(1, Math.floor(opts.page ?? 1))
    const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 50)))
    const events = await this.readEvents()
    const completions = new Map<string, AgentConversationCompletedEvent>()
    const dispatches: AgentConversationDispatchedEvent[] = []
    for (const event of events) {
      if (event.type === 'conversation.dispatched') {
        dispatches.push(event)
      } else {
        completions.set(event.taskId, event)
      }
    }

    const all = dispatches
      .map((dispatch): AgentConversationRecord => {
        const completion = completions.get(dispatch.taskId)
        return {
          taskId: dispatch.taskId,
          ...(dispatch.parentTaskId ? { parentTaskId: dispatch.parentTaskId } : {}),
          dispatchedAt: dispatch.at,
          ...(completion ? { completedAt: completion.at } : {}),
          status: completion?.status ?? 'running',
          source: publicConversationSource(dispatch.source),
          target: dispatch.target,
          requestedTarget: dispatch.requestedTarget,
          resolution: dispatch.resolution,
          prompt: dispatch.prompt,
          assistantText: completion?.assistantText ?? null,
          ...(completion?.durationMs !== undefined ? { durationMs: completion.durationMs } : {}),
          ...(completion?.error ? { error: completion.error } : {}),
        }
      })
      .sort((a, b) => b.dispatchedAt - a.dispatchedAt)
    const total = all.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const start = (page - 1) * pageSize
    return {
      entries: all.slice(start, start + pageSize),
      total,
      page,
      pageSize,
      totalPages,
    }
  }

  private async append(event: AgentConversationLogEvent): Promise<void> {
    const next = this.appendChain.then(async () => {
      try {
        await mkdir(dirname(this.path), { recursive: true })
        await appendFile(this.path, `${JSON.stringify(event)}\n`, {
          encoding: 'utf8',
          mode: 0o600,
        })
        this.cachedEvents?.push(event)
        this.cacheRevision += 1
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

  private async readEvents(): Promise<AgentConversationLogEvent[]> {
    if (this.cachedEvents) return this.cachedEvents
    const revisionBeforeRead = this.cacheRevision
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        this.cachedEvents = []
        return this.cachedEvents
      }
      throw err
    }
    const events: AgentConversationLogEvent[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const value = JSON.parse(line) as unknown
        if (isAgentConversationLogEvent(value)) events.push(value)
      } catch {
        // Ignore an incomplete final append or a hand-edited malformed line.
      }
    }
    if (this.cacheRevision !== revisionBeforeRead) return this.readEvents()
    this.cachedEvents = events
    return events
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function publicConversationSource(source: WorkspaceConversationCaller): AgentConversationSource {
  if (source.kind !== 'session') return source
  return {
    kind: 'session',
    workspaceId: source.workspaceId,
    resumeId: source.resumeId,
    agent: source.agent,
  }
}

function isAgentConversationLogEvent(value: unknown): value is AgentConversationLogEvent {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.taskId !== 'string') return false
  if (value.type === 'conversation.completed') {
    return typeof value.eventId === 'string'
      && typeof value.at === 'number'
      && ['running', 'done', 'failed', 'interrupted'].includes(String(value.status))
      && (typeof value.assistantText === 'string' || value.assistantText === null)
      && (value.durationMs === undefined || typeof value.durationMs === 'number')
      && (value.error === undefined || typeof value.error === 'string')
  }
  if (value.type !== 'conversation.dispatched') return false
  if (
    typeof value.eventId !== 'string'
    || typeof value.at !== 'number'
    || !isConversationSource(value.source)
    || !isRecord(value.target)
    || typeof value.target.workspaceId !== 'string'
    || typeof value.target.resumeId !== 'string'
    || typeof value.target.agent !== 'string'
    || !isConversationTarget(value.requestedTarget)
    || !isRecord(value.resolution)
    || !['exact', 'reconstructed'].includes(String(value.resolution.mode))
    || (value.resolution.reason !== undefined && typeof value.resolution.reason !== 'string')
    || !isRecord(value.prompt)
    || typeof value.prompt.original !== 'string'
    || typeof value.prompt.delivered !== 'string'
    || !['plain', 'reconstruction'].includes(String(value.prompt.mode))
    || (value.parentTaskId !== undefined && typeof value.parentTaskId !== 'string')
  ) {
    return false
  }
  return true
}

function isConversationSource(value: unknown): value is WorkspaceConversationCaller {
  if (!isRecord(value)) return false
  if (value.kind === 'human') return true
  if (value.kind === 'workspace') return typeof value.workspaceId === 'string'
  return value.kind === 'session'
    && typeof value.workspaceId === 'string'
    && typeof value.resumeId === 'string'
    && typeof value.agent === 'string'
}

function isConversationTarget(value: unknown): value is WorkspaceConversationTarget {
  if (!isRecord(value) || typeof value.kind !== 'string') return false
  switch (value.kind) {
    case 'resume':
      return typeof value.resumeId === 'string'
    case 'workspace':
      return typeof value.workspaceId === 'string'
    case 'harness':
      return value.harness === 'chat' || value.harness === 'autoquant'
    case 'inbox':
      return typeof value.inboxEntryId === 'string'
        && (value.workspaceId === undefined || typeof value.workspaceId === 'string')
    case 'issue':
      return typeof value.workspaceId === 'string' && typeof value.issueId === 'string'
    case 'report':
      return typeof value.workspaceId === 'string' && typeof value.path === 'string'
    case 'trade-decision':
      return typeof value.accountId === 'string' && typeof value.decisionId === 'string'
    default:
      return false
  }
}
