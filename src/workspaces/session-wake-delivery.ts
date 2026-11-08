/**
 * SessionWakeDelivery — wakes the recipient session across three surfaces.
 *
 * Priority: live Web session → live Terminal PTY → headless continuation.
 * A busy surface parks the recipient; `onSessionSettled` retries once the
 * surface quiesces. The mailbox watermark coalesces bursts: while an injected
 * pointer awaits `alice conversation check`, new completions stay `unread`
 * instead of pinging the TUI again.
 */
import type { SessionMailbox, SessionMailboxMessage } from './session-mailbox.js'

export type DeliveryResult = 'delivered' | 'busy' | 'absent'
export type HeadlessDeliveryResult = 'delivered' | 'busy' | 'unavailable'

export function formatSessionWakePointer(count: number, _recipientResumeId: string): string {
  const plural = count === 1 ? '' : 's'
  return `You have ${count} completed peer task${plural}. Run \`alice conversation check\` to read the result${plural} and continue.`
}

export interface SessionWakeDeliveryDeps {
  readonly mailbox: SessionMailbox
  /** Try to deliver pointer text to a live Terminal PTY owning this resumeId. */
  readonly deliverToPty: (
    resumeId: string,
    pointerText: string,
  ) => Promise<DeliveryResult>
  /** Try to deliver pointer text to a live Web session owning this resumeId. */
  readonly deliverToWeb: (
    resumeId: string,
    pointerText: string,
  ) => Promise<DeliveryResult>
  /** Fallback when neither PTY nor Web owns this resumeId. */
  readonly deliverToHeadless?: (
    resumeId: string,
    pointerText: string,
  ) => Promise<HeadlessDeliveryResult>
  readonly warn?: (event: string, detail: Record<string, unknown>) => void
}

export type TryDeliverResult = 'delivered' | 'watermarked' | 'parked' | 'noop' | 'unavailable'

export class SessionWakeDelivery {
  private readonly inFlight = new Set<string>()
  private readonly parked = new Set<string>()

  constructor(private readonly deps: SessionWakeDeliveryDeps) {}

  /** A child task finished: record it durably, then wake the parent. */
  async notifyTaskCompleted(
    input: Omit<SessionMailboxMessage, 'id' | 'status' | 'createdAt'>,
  ): Promise<void> {
    await this.deps.mailbox.enqueue(input)
    await this.tryDeliver(input.recipientResumeId)
  }

  async tryDeliver(recipientResumeId: string): Promise<TryDeliverResult> {
    if (this.inFlight.has(recipientResumeId)) {
      this.parked.add(recipientResumeId)
      return 'parked'
    }
    this.inFlight.add(recipientResumeId)
    try {
      return await this.deliver(recipientResumeId)
    } finally {
      this.inFlight.delete(recipientResumeId)
    }
  }

  private async deliver(recipientResumeId: string): Promise<TryDeliverResult> {
    const pending = this.deps.mailbox.pendingFor(recipientResumeId)
    if (pending.length === 0) return 'noop'

    // Pointer already injected and awaiting `alice conversation check`: leave
    // new completions unread so one check acks everything together.
    if (this.deps.mailbox.hasActiveWatermark(recipientResumeId)) return 'watermarked'

    const pointerText = formatSessionWakePointer(pending.length, recipientResumeId)

    const web = await this.deps.deliverToWeb(recipientResumeId, pointerText)
    if (web === 'delivered') {
      await this.deps.mailbox.markNotified(recipientResumeId)
      return 'delivered'
    }
    if (web === 'busy') {
      this.parked.add(recipientResumeId)
      return 'parked'
    }

    const pty = await this.deps.deliverToPty(recipientResumeId, pointerText)
    if (pty === 'delivered') {
      await this.deps.mailbox.markNotified(recipientResumeId)
      return 'delivered'
    }
    if (pty === 'busy') {
      this.parked.add(recipientResumeId)
      return 'parked'
    }

    if (this.deps.deliverToHeadless) {
      const headless = await this.deps.deliverToHeadless(recipientResumeId, pointerText)
      if (headless === 'delivered') {
        await this.deps.mailbox.markNotified(recipientResumeId)
        return 'delivered'
      }
      if (headless === 'busy') {
        this.parked.add(recipientResumeId)
        return 'parked'
      }
      return 'unavailable'
    }

    this.parked.add(recipientResumeId)
    return 'parked'
  }

  /** A surface quiesced (PTY `onQuiescent`, Web idle, headless turn done): retry parked work. */
  async onSessionSettled(recipientResumeId: string): Promise<void> {
    if (
      this.parked.has(recipientResumeId) ||
      this.deps.mailbox.unreadFor(recipientResumeId).length > 0
    ) {
      this.parked.delete(recipientResumeId)
      await this.tryDeliver(recipientResumeId)
    }
  }
}
