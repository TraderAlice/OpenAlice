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
  'dev.sonner_test',
] as const

export type AgentRuntimeEventType = (typeof AGENT_RUNTIME_EVENT_TYPES)[number]
export type AgentRuntimeSurface = 'terminal' | 'webpi' | 'headless'
export type AgentRuntimeStopStatus = 'done' | 'failed' | 'interrupted' | 'paused'
export type AgentRuntimeToolStatus = 'running' | 'completed' | 'failed'
export type SonnerTestState = 'running' | 'success' | 'error'

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
  | (AgentRuntimeSubject & {
      readonly testState: SonnerTestState
      readonly message: string
    })

export type AgentRuntimeEvent = EventLogEntry<AgentRuntimePayload> & {
  readonly type: AgentRuntimeEventType
}

interface LoggerLike {
  warn(message: string, meta?: Record<string, unknown>): void
}

export class AgentRuntimeLog {
  private readonly latestBySession = new Map<string, AgentRuntimeEvent>()
  private total = 0
  private first = 0

  private constructor(
    private readonly events: EventLog,
    private readonly logger: LoggerLike,
  ) {}

  static async open(path: string, logger: LoggerLike): Promise<AgentRuntimeLog> {
    const events = await createEventLog({ logPath: path, bufferSize: 2_000 })
    const log = new AgentRuntimeLog(events, logger)
    // EventLog restores only its bounded recent ring. Recover the compact live
    // projection once here so Office polling never has to rescan the journal.
    // The projection keeps one enriched event per Session, not the full log.
    log.recoverProjection(await events.read())
    return log
  }

  lastSeq(): number {
    return this.events.lastSeq()
  }

  firstSeq(): number {
    return this.first
  }

  /**
   * Compact current-state input for Office. Full disk history remains the
   * source for explicit replay; ordinary live reads stay bounded by Sessions.
   */
  projectionEvents(): AgentRuntimeEvent[] {
    return [...this.latestBySession.values()].sort((a, b) => a.seq - b.seq)
  }

  async record(
    type: AgentRuntimeEventType,
    payload: AgentRuntimePayload,
    opts?: { readonly causedBy?: number },
  ): Promise<AgentRuntimeEvent | null> {
    try {
      const entry = await this.events.append(type, payload, opts)
      const event = { ...entry, type }
      this.accept(event)
      return event
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
    if (opts.afterSeq !== undefined) {
      const recent = this.events.recent({
        afterSeq: opts.afterSeq,
        ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
        ...(opts.type ? { type: opts.type } : {}),
      })
      const ring = this.events.recent()
      const earliestBufferedSeq = ring[0]?.seq
      if (
        opts.afterSeq >= this.lastSeq()
        || (earliestBufferedSeq !== undefined && opts.afterSeq >= earliestBufferedSeq - 1)
      ) {
        return this.asAgentRuntimeEvents(recent)
      }
    }
    const entries = await this.events.read(opts)
    return this.asAgentRuntimeEvents(entries)
  }

  async query(opts: {
    readonly page?: number
    readonly pageSize?: number
    readonly type?: AgentRuntimeEventType
  } = {}): Promise<EventLogQueryResult> {
    const page = Math.max(1, opts.page ?? 1)
    const pageSize = Math.max(1, opts.pageSize ?? 100)
    if (page === 1 && !opts.type) {
      const recent = this.asAgentRuntimeEvents(this.events.recent())
        .slice(-pageSize)
        .reverse()
      return {
        entries: recent,
        total: this.total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(this.total / pageSize)),
      }
    }
    return this.events.query(opts)
  }

  async close(): Promise<void> {
    await this.events.close()
    this.latestBySession.clear()
    this.total = 0
    this.first = 0
  }

  private recoverProjection(entries: readonly EventLogEntry[]): void {
    for (const event of this.asAgentRuntimeEvents(entries)) this.accept(event)
  }

  private accept(event: AgentRuntimeEvent): void {
    this.total += 1
    if (this.first === 0 || event.seq < this.first) this.first = event.seq
    // Dev-only notification probes belong to the append-only diagnostic stream
    // so they exercise the real UI projection, but never represent occupancy.
    if (event.type === 'dev.sonner_test') return
    const payload = event.payload as AgentRuntimeSubject
    if (!payload.workspaceId || !payload.resumeId) return
    const key = `${payload.workspaceId}\u0000${payload.resumeId}`
    const previous = this.latestBySession.get(key)
    if (previous && previous.seq >= event.seq) return
    const previousPayload = previous?.payload as AgentRuntimeSubject | undefined
    const enrichedPayload = !payload.surface && previousPayload?.surface
      ? { ...event.payload, surface: previousPayload.surface }
      : event.payload
    this.latestBySession.set(key, { ...event, payload: enrichedPayload })
  }

  private asAgentRuntimeEvents(entries: readonly EventLogEntry[]): AgentRuntimeEvent[] {
    return entries.flatMap((entry) => {
      if (!isAgentRuntimeEventType(entry.type)) return []
      return [{ ...entry, type: entry.type, payload: entry.payload as AgentRuntimePayload }]
    })
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
