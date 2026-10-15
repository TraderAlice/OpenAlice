import { ConnectorClient, OWNER_CHAT_TEXT_MAX, type OwnerChatMessage } from '@traderalice/connector-protocol'
import { resolveConnectorUrl } from '../services/connector-client/index.js'
import type { HeadlessTaskRecord, HeadlessTaskRegistry } from './headless-task-registry.js'
import type { HeadlessTurnProgress } from './headless-progress.js'
import { deskProgressMessageId, sealedProgressTexts } from './issues/telegram-desk-project.js'

export function dispatchMessage(task: HeadlessTaskRecord, phase: OwnerChatMessage['phase'], text?: string): OwnerChatMessage | null {
  const delivery = task.communication?.delivery
  if (!delivery) return null
  return {
    id: `turn-${task.taskId}-${phase}`, adapterId: delivery.connectorId, conversationId: task.taskId, phase,
    workspaceId: delivery.contentWorkspaceId, source: delivery.source,
    ...(text?.trim() ? { text: text.trim().slice(0, OWNER_CHAT_TEXT_MAX) } : {}),
    ...(phase === 'accepted' || phase === 'progress' ? { activityLeaseMs: 60_000 } : {}),
  }
}

/** One owner for live activity and terminal delivery, independent of comment persistence. */
export class DispatchDelivery {
  private readonly progress = new Map<string, Set<string>>()
  private readonly live = new Set<string>()
  private recoveryOffset = 0
  private readonly busy = new Set<string>()
  constructor(
    private readonly tasks: HeadlessTaskRegistry,
    private readonly warn: (message: string, detail: Record<string, unknown>) => void,
    private readonly client: Pick<ConnectorClient, 'sendOwnerMessage'> = new ConnectorClient(resolveConnectorUrl()),
  ) {}

  private async send(message: OwnerChatMessage): Promise<void> {
    await this.client.sendOwnerMessage(message, AbortSignal.timeout(5_000))
  }

  async accepted(task: HeadlessTaskRecord, heartbeat = false): Promise<void> {
    if (task.status !== 'running' || task.terminalDelivery) return
    this.live.add(task.taskId)
    const message = dispatchMessage(task, 'accepted')
    if (!message) return
    if (heartbeat) message.id += `-${Math.floor(Date.now() / 20_000)}`
    try { await this.send(message) } catch (error) {
      this.warn('dispatch.delivery_activity_failed', { taskId: task.taskId, error: String(error) })
    }
  }

  async offer(task: HeadlessTaskRecord, snapshot: HeadlessTurnProgress): Promise<void> {
    if (task.status !== 'running' || task.terminalDelivery || !task.communication?.delivery) return
    const seen = this.progress.get(task.taskId) ?? new Set<string>()
    this.progress.set(task.taskId, seen)
    for (const text of sealedProgressTexts(snapshot)) {
      if (seen.has(text)) continue
      const message = dispatchMessage(task, 'progress', text)!
      message.id = deskProgressMessageId(task.taskId, text)
      try { await this.send(message); seen.add(text) } catch (error) {
        this.warn('dispatch.delivery_progress_failed', { taskId: task.taskId, error: String(error) })
      }
    }
  }

  async finish(task: HeadlessTaskRecord, text?: string | null): Promise<void> {
    this.progress.delete(task.taskId)
    this.live.delete(task.taskId)
    if (!task.communication?.delivery || task.status === 'running' || task.terminalDelivery || this.busy.has(task.taskId)) return
    const message = dispatchMessage(task, task.status === 'done' ? 'final' : 'failed',
      task.status === 'done' ? text ?? undefined : `The Agent could not complete this reply: ${task.error ?? task.status}.`)!
    // Persist before crossing the process boundary. An uncertain receipt must
    // never cause automatic replay of public text/files after restart. The
    // receipt only acknowledges Connector acceptance, not external delivery.
    this.busy.add(task.taskId)
    try {
      await this.tasks.setTerminalDelivery(task.taskId, { message, state: 'pending' })
      await this.send(message)
      await this.tasks.setTerminalDelivery(task.taskId, { message, state: 'accepted' })
    } catch (error) {
      await this.tasks.setTerminalDelivery(task.taskId, { message, state: 'uncertain', error: String(error) })
      this.warn('dispatch.delivery_terminal_uncertain', { taskId: task.taskId, error: String(error) })
    } finally { this.busy.delete(task.taskId) }
  }

  /** Heartbeats renew activity leases; recovery only closes, never replays bodies. */
  async reconcile(): Promise<void> {
    const candidates = this.tasks.list().filter(task => task.communication?.delivery
      && (task.status === 'running' || !task.terminalDelivery || ['pending', 'uncertain'].includes(task.terminalDelivery.state)))
    const active = candidates.filter(task => task.status === 'running')
    const recovery = candidates.filter(task => task.status !== 'running')
    const offset = recovery.length ? this.recoveryOffset % recovery.length : 0
    const batch = [...recovery.slice(offset), ...recovery.slice(0, offset)].slice(0, 32)
    this.recoveryOffset = offset + batch.length
    await Promise.all([...active, ...batch].map(async task => {
      if (this.busy.has(task.taskId)) return
      if (task.status === 'running') return this.accepted(task, true)
      if (!task.terminalDelivery) {
        if (this.live.has(task.taskId)) return
        return this.finish(task)
      }
      if ((task.terminalDelivery.state === 'accepted' || task.terminalDelivery.state === 'closed')) return
      this.busy.add(task.taskId)
      const pending = task.terminalDelivery
      const close = dispatchMessage(task, 'final')!
      close.id = `turn-${task.taskId}-recovery-close`
      try {
        await this.send(close)
        // Preserve uncertain body delivery as an operator-visible fact even
        // after activity cleanup succeeds. Do not keep retrying the cleanup.
        await this.tasks.setTerminalDelivery(task.taskId, { ...pending, state: 'closed' })
      } catch (error) {
        this.warn('dispatch.delivery_recovery_failed', { taskId: task.taskId, error: String(error) })
      } finally { this.busy.delete(task.taskId) }
    }))
  }
}
