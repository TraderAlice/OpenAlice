import type { AgentActivitySignal } from './activity-projection.js'
import type { NotificationInput } from './notification-queue.js'
function operationId(signal: AgentActivitySignal): string {
  return signal.operationId ?? (signal.taskId ? `task:${signal.taskId}`
    : signal.workspaceId && signal.resumeId ? `session:${signal.workspaceId}:${signal.resumeId}` : `event:${signal.revision}`)
}


export interface AnnouncementContext {
  agent(signal: AgentActivitySignal): string
  action(signal: AgentActivitySignal): NotificationInput['action']
  t(key: string, values?: { agent?: string }): string
  open(context: 'office' | 'inbox' | 'news'): void
}
export class ActivityAnnouncements {
  private announcedThrough: number | null = null
  private running = new Set<string>()
  private delivered = new Map<string, number>()
  private failed = new Map<string, number>()
  baseline(revision: number) { this.announcedThrough = revision }
  accept(signals: readonly AgentActivitySignal[], queue: { publish(input: NotificationInput): unknown; withdraw(id: string): void }, context: AnnouncementContext) {
    if (this.announcedThrough === null) { this.baseline(Math.max(0, ...signals.map(s => s.revision))); return }
    for (const map of [this.delivered, this.failed]) {
      while (map.size > 500) map.delete(map.keys().next().value!)
    }
    const active = new Set(signals.filter(signal => signal.kind === 'conversation' || signal.kind === 'sonner-test-running')
      .map(signal => signal.kind === 'conversation' ? `activity:${operationId(signal)}` : `activity:${signal.id}`))

    // Announce in journal order. A polling replay (even >200 facts) never emits twice.
    for (const signal of [...signals].sort((a, b) => a.revision - b.revision)) {
      if (signal.revision <= this.announcedThrough) continue
      this.announcedThrough = signal.revision
      const operation = operationId(signal)
      const id = `activity:${operation}`
      const agent = context.agent(signal)
      const inspect = context.action(signal)
      const common = { id, revision: signal.revision, action: inspect }
      let input: NotificationInput
      switch (signal.kind) {
        case 'conversation':
          if (this.delivered.has(operation) || this.failed.has(operation)) continue
          input = { ...common, status: 'running', title: agent,
            description: context.t('activityToast.conversationRunning', { agent }), duration: Infinity }
          break
        case 'conversation-failed':
          this.failed.set(operation, signal.revision)
          input = { ...common, status: signal.failureKind === 'rejected' ? 'warning' : 'error',
            title: context.t(signal.failureKind === 'spawn' ? 'activityToast.conversationSpawnFailed'
              : signal.failureKind === 'rejected' ? 'activityToast.conversationRejected' : 'activityToast.conversationFailed', { agent }),
            description: signal.detail, duration: signal.failureKind === 'rejected' ? 8_000 : 10_000 }
          break
        case 'conversation-completed':
          if (this.delivered.has(operation) || this.failed.has(operation)) continue
          input = { ...common, status: 'success', title: context.t('activityToast.conversationCompleted', { agent }), duration: 4_000 }
          break
        case 'conversation-interrupted':
        case 'conversation-paused':
          input = { ...common, status: 'neutral', title: context.t(signal.kind === 'conversation-paused'
            ? 'activityToast.conversationPaused' : 'activityToast.conversationInterrupted', { agent }), duration: 4_000 }
          break
        case 'inbox': {
          const related = signal.taskId ? `task:${signal.taskId}` : undefined
          // If failure is already known, the report is a delivery fact, not a successful execution.
          const reportsFailure = related && this.failed.has(related)
          if (related) this.delivered.set(related, signal.revision)
          input = {
            ...(related && !reportsFailure ? { id: `activity:${related}` } : {}),
            group: `inbox:${signal.workspaceId}:${signal.sessionRecordId ?? signal.resumeId ?? signal.agent ?? 'unknown'}`,
            windowMs: 4_000, revision: signal.revision, status: 'success',
            title: context.t('activityToast.inboxDelivered', { agent }), description: signal.detail, duration: 6_000,
            action: { label: context.t('activityToast.viewInbox'), onClick: () => context.open('inbox') },
          }
          break
        }
        case 'news':
          input = { status: 'info', title: signal.source ?? context.t('activityToast.newsSource'),
            description: signal.detail, articleId: signal.newsItemId, image: signal.image,
            group: `news:${(signal.source ?? '').trim().toLowerCase()}`, windowMs: 4_000,
            revision: signal.revision, duration: 6_000,
            action: { label: context.t('activityToast.viewNews'), onClick: () => context.open('news') },
          }
          break
        default:
          input = { id: `activity:${signal.id}`, revision: signal.revision,
            status: signal.kind === 'sonner-test-running' ? 'running' : signal.kind === 'sonner-test-success' ? 'success' : 'error',
            title: signal.detail ?? 'Sonner test', duration: signal.kind === 'sonner-test-running' ? Infinity : signal.kind === 'sonner-test-success' ? 4_000 : 10_000 }
      }
      queue.publish(input)
    }
    for (const id of this.running) if (!active.has(id)) queue.withdraw(id)
    this.running = active
  }
}
