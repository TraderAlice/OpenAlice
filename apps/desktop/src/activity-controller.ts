import { z } from 'zod'
import type { AgentRuntimeEvent } from './activity-journal-types.js'
import { projectGlobalActivity, type AgentActivitySignal } from './activity-projection.js'
import { ActivityAnnouncements } from './activity-announcements.js'
import { NotificationQueue, type NotificationInput } from './notification-queue.js'
import { allowsActivity, briefNotification, type ActivityPreferences, type SerializedNotification, type ActivityContext } from './activity-policy.js'
const text = z.string().max(16_384).optional()
const payloadSchema = z.object({
  workspaceId: text, resumeId: text, agent: text, sessionRecordId: text, taskId: text,
  inboxEntryId: text, newsItemId: z.number().int().nonnegative().optional(), source: text,
  title: text, image: text, summary: text, error: text, reason: text, launchErrorCode: text,
  message: text, originKind: z.string().optional(), testState: z.enum(['running', 'success', 'error']).optional(),
  status: z.enum(['done', 'failed', 'interrupted', 'paused']).optional(),
  cause: z.object({ kind: z.enum(['conversation','issue','ui','http']),
    from: z.object({kind:z.enum(['session','workspace','human']),workspaceId:text,resumeId:text,agent:text}).optional(),
  }).passthrough().optional(),
}).passthrough()
const eventSchema = z.object({ seq: z.number().int().positive(), ts: z.number().finite().nonnegative(),
  type: z.string().max(100), payload: payloadSchema })
const pageSchema = z.object({ lastSeq: z.number().int().nonnegative(), entries: z.array(eventSchema).max(500) })
export interface ActivitySource {
  identity(): string | null
  read(query: string, signal?: AbortSignal): Promise<unknown>
}
export type ActivityDisplay = { type: 'show'; displayId: string; input: SerializedNotification } | { type: 'hide'; displayId: string }
export interface ActivitySurface {
  foreground(): boolean
  petVisible(): boolean
  send(surface: 'main' | 'pet', event: ActivityDisplay): void
  open(context: ActivityContext): void
  signals?(signals: AgentActivitySignal[]): void
}
/** One trusted source, one cursor, one arbitration decision. No renderer timers feed the pet. */
export class ActivityController {
  private identity: string | null = null
  private epoch = 0
  private cursor: number | null = null
  private events: AgentRuntimeEvent[] = []
  private signals: AgentActivitySignal[] = []
  private announcements = new ActivityAnnouncements()
  private queue: NotificationQueue
  private busyEpoch: number | null = null
  private abort: AbortController | null = null
  private stopped = false
  private targets = new Map<string, { identity: string; surface: 'main' | 'pet'; input: SerializedNotification }>()
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private prefs: ActivityPreferences
  constructor(private source: ActivitySource, private surface: ActivitySurface, prefs: ActivityPreferences) {
    this.prefs = prefs
    this.queue = this.makeQueue()
  }
  private makeQueue() {
    return new NotificationQueue({
      show: (displayId, input, close) => {
        const old = this.targets.get(displayId)
        const chosen = old?.surface ?? (this.surface.foreground() ? (this.prefs.main ? 'main' : null)
          : this.surface.petVisible() && this.prefs.pet ? 'pet' : null)
        if (!chosen || !this.identity) { close(); return }
        // Functions remain in main. Only the safe context and display token cross IPC.
        const context: ActivityContext = input.group?.startsWith('news:') ? 'news'
          : input.group?.startsWith('inbox:') ? 'inbox' : 'office'
        const { action: _action, image: _image, onDismiss: _onDismiss, ...content } = input
        let serialized: SerializedNotification = { ...content, duration: Number.isFinite(input.duration) ? input.duration : null, context }
        if (chosen === 'pet' && this.prefs.brief) serialized = briefNotification(serialized)
        this.closeCallbacks.set(displayId, close)
        this.targets.set(displayId, { identity: this.identity, surface: chosen, input: serialized })
        this.surface.send(chosen, { type: 'show', displayId, input: serialized })
        // Group updates retain the original timer; lifecycle changes get a new duration.
        if (!old || old.input.duration !== serialized.duration) {
          clearTimeout(this.timers.get(displayId))
          if (serialized.duration !== null) this.timers.set(displayId, setTimeout(close, serialized.duration))
        }
      },
      hide: displayId => {
        const target = this.targets.get(displayId)
        this.targets.delete(displayId)
        this.closeCallbacks.delete(displayId)
        clearTimeout(this.timers.get(displayId)); this.timers.delete(displayId)
        if (target) this.surface.send(target.surface, { type: 'hide', displayId })
      },
    }, Date.now, this.surface.foreground() ? 3 : 1, 100)
  }
  setPreferences(prefs: ActivityPreferences) { this.prefs = prefs; this.clearQueue() }
  private clearQueue() { this.queue.dispose(); if (!this.stopped) this.queue = this.makeQueue() }
  /** Hide old announcements on a surface transition. Never transfer/replay them. */
  transition() { this.clearQueue() }
  private reset(identity: string | null) {
    this.abort?.abort(); this.epoch++; this.identity = identity; this.cursor = null; this.events = []
    this.announcements = new ActivityAnnouncements(); this.signals = []; this.surface.signals?.([]); this.clearQueue()
  }
  dismiss(displayId: unknown, surface: 'main' | 'pet') {
    if (typeof displayId !== 'string') return false
    const target = this.targets.get(displayId)
    if (!target || target.surface !== surface || target.identity !== this.source.identity()) return false
    this.queueClose(displayId)
    return true
  }
  private closeCallbacks = new Map<string, () => void>()
  private queueClose(displayId: string) { this.closeCallbacks.get(displayId)?.() }
  open(displayId: unknown, surface: 'main' | 'pet') {
    if (typeof displayId !== 'string') return false
    const target = this.targets.get(displayId)
    if (!target || target.surface !== surface || target.identity !== this.source.identity()) return false
    this.surface.open(target.input.context)
    this.queueClose(displayId)
    return true
  }
  signalSnapshot() { return this.signals }
  snapshot() { return [...this.targets].filter(([, v]) => v.surface === 'main' && v.identity === this.source.identity()).map(([displayId, v]) => ({ type: 'show' as const, displayId, input: v.input })) }
  stop() {
    if (this.stopped) return
    this.stopped = true; this.epoch++; this.abort?.abort(); this.queue.dispose()
  }
  async poll() {
    if (this.stopped) return
    const identity = this.source.identity()
    if (identity !== this.identity) this.reset(identity)
    if (this.busyEpoch === this.epoch || this.stopped || !identity) return
    const epoch = this.epoch
    this.busyEpoch = epoch
    const abort = this.abort = new AbortController()
    try {
      const result = pageSchema.parse(await this.source.read(this.cursor === null ? '?page=1&pageSize=100' : `?afterSeq=${this.cursor}&limit=500`, abort.signal))
      if (this.stopped || epoch !== this.epoch || identity !== this.source.identity()) return
      const incoming = result.entries as AgentRuntimeEvent[]
      if (this.cursor === null || result.lastSeq < this.cursor) {
        this.clearQueue(); this.announcements = new ActivityAnnouncements(); this.events = incoming; this.cursor = result.lastSeq; this.announcements.baseline(result.lastSeq);
        this.signals = projectGlobalActivity({ runtimeEvents: this.events }); this.surface.signals?.(this.signals); return
      }
      const seen = new Set(this.events.map(event => event.seq))
      this.events = [...this.events, ...incoming.filter(e => !seen.has(e.seq))].sort((a,b) => a.seq - b.seq).slice(-500)
      // Bounded reconnect catch-up: consume up to 500 facts; a bigger backlog is silently baselined.
      const newest = Math.max(this.cursor, ...incoming.map(e => e.seq))
      if (result.lastSeq > newest) { this.cursor = result.lastSeq; this.announcements.baseline(result.lastSeq); return }
      this.cursor = newest
      const signals = this.signals = projectGlobalActivity({ runtimeEvents: this.events })
      this.surface.signals?.(signals)
      const allowed = new Set(signals.filter(s => allowsActivity(this.prefs, s)).map(s => s.revision))
      this.announcements.accept(signals, {
        publish: input => {
          if (!allowed.has(input.revision ?? -1)) { if (input.id) this.queue.withdraw(input.id); return }
          this.queue.publish(input)
        }, withdraw: id => this.queue.withdraw(id),
      }, {
        agent: () => 'Agent', action: () => undefined, open: () => {},
        t: key => ({ 'activityToast.conversationRunning': 'Work in progress', 'activityToast.conversationCompleted': 'Work completed',
          'activityToast.conversationFailed': 'Work failed', 'activityToast.conversationSpawnFailed': 'Work could not start',
          'activityToast.conversationRejected': 'Action needed', 'activityToast.conversationPaused': 'Work paused',
          'activityToast.conversationInterrupted': 'Work interrupted', 'activityToast.inboxDelivered': 'Report ready',
          'activityToast.newsSource': 'News' }[key] ?? key),
      })
    } catch { /* Offline/invalid snapshot: cursor stays; no invented activity or completion. */ }
    finally { if (this.busyEpoch === epoch) this.busyEpoch = null }
  }
}
