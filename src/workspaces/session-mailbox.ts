/**
 * SessionMailbox — durable inbox of completed peer-task notifications.
 *
 * Child headless tasks enqueue a message when they finish; the recipient
 * session is woken with a one-line pointer (`alice conversation check`) and
 * the message is acked when the parent actually reads it. The watermark
 * (`notified` without a following `checkAndAck`) coalesces bursts so the
 * recipient TUI is only pinged once per idle window.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type SessionMailboxMessageStatus = 'unread' | 'notified' | 'acked'

export interface SessionMailboxReportSource {
  readonly kind: 'scheduled-issue'
  readonly workspaceId: string
  readonly workspaceTag?: string
  readonly issueId: string
  readonly issueTitle?: string
  readonly fire?: 'schedule' | 'manual' | 'retry'
}

export interface SessionMailboxMessage {
  readonly id: string // e.g. `mail-${taskId}`
  readonly recipientResumeId: string
  readonly recipientWorkspaceId: string
  readonly taskId: string
  readonly childResumeId: string
  readonly childWorkspaceId: string
  readonly childAgent: string
  readonly taskStatus: 'done' | 'failed' | 'interrupted'
  readonly assistantPreview: string | null
  readonly error?: string
  readonly durationMs?: number
  readonly reportSource?: SessionMailboxReportSource
  readonly createdAt: number
  status: SessionMailboxMessageStatus
  notifiedAt?: number
  ackedAt?: number
}

/** Keep the file bounded: drop oldest acked messages beyond this total. */
const MAX_MESSAGES = 500

/**
 * Default watermark lease TTL. If a woken session ignores or crashes on a wake,
 * the watermark expires after this window so future completions can wake it again.
 */
export const DEFAULT_WATERMARK_TTL_MS = 120_000

export interface SessionMailboxOptions {
  readonly watermarkTtlMs?: number
}

export class SessionMailbox {
  private messages: SessionMailboxMessage[] = [] // oldest-first in memory
  /** Mutations may finish concurrently; serialize tmp→rename writes. */
  private flushChain: Promise<void> = Promise.resolve()

  private constructor(
    private readonly path: string,
    private readonly watermarkTtlMs: number = DEFAULT_WATERMARK_TTL_MS,
  ) {}

  /** Load persisted messages; a missing or corrupt file starts empty. */
  static async load(path: string, options?: SessionMailboxOptions): Promise<SessionMailbox> {
    const mailbox = new SessionMailbox(path, options?.watermarkTtlMs ?? DEFAULT_WATERMARK_TTL_MS)
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as {
        messages?: SessionMailboxMessage[]
      }
      mailbox.messages = Array.isArray(parsed.messages) ? parsed.messages : []
    } catch {
      mailbox.messages = []
    }
    return mailbox
  }

  /**
   * Append a completion message. Idempotent per (`taskId`, `recipientResumeId`):
   * re-enqueueing a finished task returns the existing record unchanged.
   */
  async enqueue(
    input: Omit<SessionMailboxMessage, 'id' | 'status' | 'createdAt'> & {
      id?: string
      createdAt?: number
    },
  ): Promise<SessionMailboxMessage> {
    const existing = this.messages.find(
      (m) => m.taskId === input.taskId && m.recipientResumeId === input.recipientResumeId,
    )
    if (existing) return existing

    const message: SessionMailboxMessage = {
      ...input,
      id: input.id ?? `mail-${input.taskId}`,
      createdAt: input.createdAt ?? Date.now(),
      status: 'unread',
    }
    this.messages.push(message)
    this.pruneAcked()
    await this.flush()
    return message
  }

  /** Messages still awaiting the recipient's `alice conversation check`, oldest-first. */
  pendingFor(recipientResumeId: string): SessionMailboxMessage[] {
    return this.messages
      .filter(
        (m) =>
          m.recipientResumeId === recipientResumeId &&
          (m.status === 'unread' || m.status === 'notified'),
      )
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Messages not yet surfaced to the recipient, oldest-first. */
  unreadFor(recipientResumeId: string): SessionMailboxMessage[] {
    return this.messages
      .filter((m) => m.recipientResumeId === recipientResumeId && m.status === 'unread')
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /**
   * Recent messages including `acked`, sorted oldest-first, for read-only
   * observability projections (e.g. Dispatch Board causal reporting edges).
   */
  listRecent(opts?: {
    sinceMs?: number
    recipientResumeId?: string
  }): SessionMailboxMessage[] {
    const sinceMs = opts?.sinceMs
    const recipientResumeId = opts?.recipientResumeId
    return this.messages
      .filter((m) => {
        if (recipientResumeId !== undefined && m.recipientResumeId !== recipientResumeId) return false
        if (sinceMs !== undefined && m.createdAt < sinceMs) return false
        return true
      })
      .map((m) => ({
        ...m,
        ...(m.reportSource ? { reportSource: { ...m.reportSource } } : {}),
      }))
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  /**
   * True while a pointer wakeup has been injected into the recipient session
   * within the watermark lease TTL and has not been acked since: `checkAndAck`
   * or `ackByTaskIds` transitions `notified` messages to `acked`, clearing the
   * watermark. Once `nowMs - notifiedAt >= watermarkTtlMs`, the lease expires
   * so a crashed or ignored wake cannot permanently jam future notifications.
   */
  hasActiveWatermark(recipientResumeId: string, nowMs: number = Date.now()): boolean {
    return this.messages.some(
      (m) =>
        m.recipientResumeId === recipientResumeId &&
        m.status === 'notified' &&
        typeof m.notifiedAt === 'number' &&
        nowMs - m.notifiedAt < this.watermarkTtlMs,
    )
  }

  /** Mark pending messages as surfaced (pointer delivered). Persists and returns the pending set. */
  async markNotified(
    recipientResumeId: string,
    messageIds?: readonly string[],
    nowMs?: number,
  ): Promise<SessionMailboxMessage[]> {
    const at = nowMs ?? Date.now()
    const targetIds = messageIds ? new Set(messageIds) : undefined
    let changed = false
    for (const m of this.messages) {
      if (
        m.recipientResumeId === recipientResumeId &&
        (m.status === 'unread' || m.status === 'notified') &&
        (!targetIds || targetIds.has(m.id))
      ) {
        if (m.status !== 'notified' || m.notifiedAt !== at) {
          m.status = 'notified'
          m.notifiedAt = at
          changed = true
        }
      }
    }
    if (changed) await this.flush()
    return this.pendingFor(recipientResumeId)
  }

  /**
   * Ack pending messages matching specific taskIds for a recipient.
   * Used when the recipient consumes completed task results via
   * `conversation read` / `await` / `collect` / `ask --await`.
   */
  async ackByTaskIds(
    recipientResumeId: string,
    taskIds: readonly string[],
    nowMs?: number,
  ): Promise<SessionMailboxMessage[]> {
    if (taskIds.length === 0) return []
    const wanted = new Set(taskIds)
    const at = nowMs ?? Date.now()
    const acked: SessionMailboxMessage[] = []
    for (const m of this.messages) {
      if (
        m.recipientResumeId === recipientResumeId &&
        (m.status === 'unread' || m.status === 'notified') &&
        wanted.has(m.taskId)
      ) {
        m.status = 'acked'
        m.ackedAt = at
        acked.push(m)
      }
    }
    if (acked.length > 0) await this.flush()
    return acked.sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Ack every pending message: hand payloads to the parent and clear the watermark. */
  async checkAndAck(
    recipientResumeId: string,
    nowMs?: number,
  ): Promise<SessionMailboxMessage[]> {
    const at = nowMs ?? Date.now()
    const pending = this.pendingFor(recipientResumeId)
    for (const m of pending) {
      m.status = 'acked'
      m.ackedAt = at
    }
    if (pending.length > 0) await this.flush()
    return pending
  }

  /** Recipients that should be woken now: unread work and no unexpired watermark. */
  recipientsWithUnread(nowMs: number = Date.now()): string[] {
    const out = new Set<string>()
    for (const m of this.messages) {
      if (m.status === 'unread' && !this.hasActiveWatermark(m.recipientResumeId, nowMs)) {
        out.add(m.recipientResumeId)
      }
    }
    return [...out]
  }

  /** Bound the file: drop oldest acked messages once past MAX_MESSAGES. */
  private pruneAcked(): void {
    if (this.messages.length <= MAX_MESSAGES) return
    let overflow = this.messages.length - MAX_MESSAGES
    const kept: SessionMailboxMessage[] = []
    for (const m of this.messages) {
      if (overflow > 0 && m.status === 'acked') {
        overflow -= 1
        continue
      }
      kept.push(m)
    }
    this.messages = kept
  }

  private async flush(): Promise<void> {
    const next = this.flushChain.then(() => this.flushNow())
    this.flushChain = next.catch(() => undefined)
    await next
  }

  private async flushNow(): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    await writeFile(tmp, JSON.stringify({ version: 1, messages: this.messages }, null, 2), 'utf8')
    await rename(tmp, this.path)
  }
}
