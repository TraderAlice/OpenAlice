/**
 * Append-only agent runtime lifecycle log.
 *
 * HeadlessTaskRegistry and the Session roster remain process/current-state
 * truth. This journal records desk/employee occupancy so Office and a
 * later Office replay can reconstruct who sat down, why, and how they left.
 * It never dispatches work.
 */
import {
  createEventLog,
  type EventLog,
  type EventLogEntry,
  type EventLogQueryResult,
} from '../core/event-log.js'

export const AGENT_RUNTIME_EVENT_TYPES = [
  'session.born',
  'runtime.started',
  'runtime.spawn_failed',
  'runtime.stopped',
  'runtime.rejected',
  'runtime.turn.text',
  'runtime.turn.tool',
  'runtime.turn.error',
] as const

export type AgentRuntimeEventType = (typeof AGENT_RUNTIME_EVENT_TYPES)[number]
export type AgentRuntimeSurface = 'terminal' | 'webpi' | 'headless'
export type AgentRuntimeStopStatus = 'done' | 'failed' | 'interrupted' | 'paused'
export type AgentRuntimeToolStatus = 'running' | 'completed' | 'failed'

export interface AgentRuntimeTurnMetrics {
  readonly textBlocks: number
  readonly toolCalls: number
  readonly toolFailures: number
}

export type AgentRuntimeCause =
  | { readonly kind: 'issue'; readonly workspaceId: string; readonly issueId: string }
  | {
      readonly kind: 'conversation'
      readonly from?: {
        readonly kind: 'session' | 'workspace' | 'human'
        readonly resumeId?: string
        readonly workspaceId?: string
        readonly agent?: string
      }
      readonly resolution?: 'exact' | 'reconstructed'
    }
  | { readonly kind: 'ui' }
  | { readonly kind: 'http' }

export interface AgentRuntimeSubject {
  readonly workspaceId: string
  readonly resumeId: string
  readonly agent: string
  readonly sessionRecordId?: string
  readonly taskId?: string
  readonly surface?: AgentRuntimeSurface
  readonly cause?: AgentRuntimeCause
}

export type AgentRuntimePayload =
  | AgentRuntimeSubject
  | (AgentRuntimeSubject & {
      readonly launchErrorCode?: string
      readonly error?: string
    })
  | (AgentRuntimeSubject & {
      readonly status: AgentRuntimeStopStatus
      readonly exitCode?: number | null
      readonly error?: string
      readonly assistantText?: string
      readonly metrics?: AgentRuntimeTurnMetrics
      readonly truncated?: boolean
    })
  | (AgentRuntimeSubject & {
      readonly reason: string
    })
  | (AgentRuntimeSubject & {
      readonly text: string
    })
  | (AgentRuntimeSubject & {
      readonly toolId: string
      readonly toolName: string
      readonly toolStatus: AgentRuntimeToolStatus
    })
  | (AgentRuntimeSubject & {
      readonly message: string
    })

export type AgentRuntimeEvent = EventLogEntry<AgentRuntimePayload> & {
  readonly type: AgentRuntimeEventType
}

interface LoggerLike {
  warn(message: string, meta?: Record<string, unknown>): void
}

export class AgentRuntimeLog {
  private constructor(
    private readonly events: EventLog,
    private readonly logger: LoggerLike,
  ) {}

  static async open(path: string, logger: LoggerLike): Promise<AgentRuntimeLog> {
    const events = await createEventLog({ logPath: path, bufferSize: 2_000 })
    return new AgentRuntimeLog(events, logger)
  }

  lastSeq(): number {
    return this.events.lastSeq()
  }

  async record(
    type: AgentRuntimeEventType,
    payload: AgentRuntimePayload,
    opts?: { readonly causedBy?: number },
  ): Promise<AgentRuntimeEvent | null> {
    try {
      const entry = await this.events.append(type, payload, opts)
      return { ...entry, type }
    } catch (err) {
      this.logger.warn('agent_runtime_log.append_failed', { type, err })
      return null
    }
  }

  async read(opts: {
    readonly afterSeq?: number
    readonly limit?: number
    readonly type?: AgentRuntimeEventType
  } = {}): Promise<AgentRuntimeEvent[]> {
    const entries = await this.events.read(opts)
    return entries.flatMap((entry) => {
      if (!isAgentRuntimeEventType(entry.type)) return []
      return [{ ...entry, type: entry.type, payload: entry.payload as AgentRuntimePayload }]
    })
  }

  async query(opts: {
    readonly page?: number
    readonly pageSize?: number
    readonly type?: AgentRuntimeEventType
  } = {}): Promise<EventLogQueryResult> {
    return this.events.query(opts)
  }

  async close(): Promise<void> {
    await this.events.close()
  }
}

export function isAgentRuntimeEventType(value: string): value is AgentRuntimeEventType {
  return (AGENT_RUNTIME_EVENT_TYPES as readonly string[]).includes(value)
}

export function conversationCause(input: {
  readonly source?: {
    readonly kind: 'session' | 'workspace' | 'human'
    readonly resumeId?: string
    readonly workspaceId?: string
    readonly agent?: string
  }
  readonly resolution?: 'exact' | 'reconstructed'
}): AgentRuntimeCause {
  return {
    kind: 'conversation',
    ...(input.source ? { from: input.source } : {}),
    ...(input.resolution ? { resolution: input.resolution } : {}),
  }
}

export function issueCause(workspaceId: string, issueId: string): AgentRuntimeCause {
  return { kind: 'issue', workspaceId, issueId }
}
