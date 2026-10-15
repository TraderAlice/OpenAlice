export type NotificationStatus = 'running' | 'info' | 'success' | 'warning' | 'error' | 'neutral'

export interface NotificationContent {
  status: NotificationStatus
  title: string
  description?: string
  image?: string
  /** This tuple is replaced together with description/image when groups update. */
  articleId?: number
  count?: number
  action?: { label: string; onClick(): void }
}

export interface NotificationInput extends NotificationContent {
  id?: string
  group?: string
  windowMs?: number
  revision?: number
  duration: number
  onDismiss?(): void
}

interface Entry {
  id: string
  input: NotificationInput
  order: number
  displayId?: string
}

export interface NotificationTransport {
  show(displayId: string, input: NotificationInput, onClose: () => void): void
  hide(displayId: string): void
}

const priority: Record<NotificationStatus, number> = {
  error: 5, warning: 4, success: 3, neutral: 3, info: 2, running: 1,
}

/** UI display policy only. Sonner owns motion, focus, swipe and paused timers. */
export class NotificationQueue {
  private entries = new Map<string, Entry>()
  private groups = new Map<string, { id: string; expires: number }>()
  private dismissedRunning = new Set<string>()
  private serial = 0

  constructor(private transport: NotificationTransport, private now = Date.now, private capacity = 3, private maxEntries = Infinity) {}

  publish(input: NotificationInput): string {
    const now = this.now()
    for (const [key, group] of this.groups) {
      if (group.expires <= now && !this.entries.has(group.id)) this.groups.delete(key)
    }
    let group = input.group ? this.groups.get(input.group) : undefined
    const groupedEntry = group ? this.entries.get(group.id) : undefined
    // Pending source groups continue to collect until their first display.
    if (group && group.expires <= now && (!groupedEntry || groupedEntry.displayId)) group = undefined
    const id = group?.id ?? input.id ?? `notification:${++this.serial}`
    if (input.id && input.id !== id) {
      const replaced = this.entries.get(input.id)
      if (replaced) this.remove(replaced)
    }
    if (input.status === 'running' && this.dismissedRunning.has(id)) return id
    if (input.status !== 'running') this.dismissedRunning.delete(id)
    const previous = this.entries.get(id)
    if (!previous && group?.id === id) return id // Closed group stays quiet within its window.
    if (previous && input.revision !== undefined && previous.input.revision !== undefined
      && input.revision <= previous.input.revision) return id
    if (!previous && this.entries.size >= this.maxEntries) {
      const victim = [...this.entries.values()].filter(item => !item.displayId)
        .sort((a, b) => priority[a.input.status] - priority[b.input.status] || a.order - b.order)[0]
      if (!victim || priority[victim.input.status] > priority[input.status]) return id
      this.remove(victim)
    }
    const entry: Entry = previous ?? { id, input, order: ++this.serial }
    entry.input = {
      ...input,
      count: input.group ? (previous?.input.count ?? 0) + 1 : input.count,
    }
    this.entries.set(id, entry)
    if (input.group && !group) {
      this.groups.set(input.group, { id, expires: now + (input.windowMs ?? 4_000) })
    }
    if (entry.displayId) this.show(entry)
    this.flush()
    return id
  }

  /** Dismissal never cancels the underlying task or acknowledges domain content. */
  dismiss(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    if (entry.input.status === 'running') {
      this.dismissedRunning.add(id)
      if (this.dismissedRunning.size > 500) {
        this.dismissedRunning.delete(this.dismissedRunning.values().next().value!)
      }
    }
    this.remove(entry)
    entry.input.onDismiss?.()
    this.flush()
  }

  /** A projection disappeared (completed before observation, or stale); no result is invented. */
  withdraw(id: string): void {
    const entry = this.entries.get(id)
    if (entry?.input.status === 'running') {
      this.remove(entry)
      this.flush()
    }
  }

  dispose(): void {
    const entries = [...this.entries.values()]
    this.entries.clear()
    this.groups.clear()
    this.dismissedRunning.clear()
    for (const entry of entries) if (entry.displayId) this.transport.hide(entry.displayId)
  }

  private remove(entry: Entry): void {
    this.entries.delete(entry.id)
    if (entry.displayId) this.transport.hide(entry.displayId)
  }

  private show(entry: Entry): void {
    const displayId = entry.displayId ??= `openalice:${entry.id}:${++this.serial}`
    this.transport.show(displayId, entry.input, () => {
      // A preempted toast's delayed Sonner callback cannot remove its redisplay.
      if (this.entries.get(entry.id)?.displayId === displayId) this.dismiss(entry.id)
    })
  }

  private flush(): void {
    const waiting = [...this.entries.values()].filter(entry => !entry.displayId)
      .sort((a, b) => priority[b.input.status] - priority[a.input.status] || a.order - b.order)
    for (const entry of waiting) {
      const visible = [...this.entries.values()].filter(item => item.displayId)
      if (visible.length >= this.capacity) {
        if (entry.input.status !== 'error') break
        const victim = visible.filter(item => item.input.status !== 'error')
          .sort((a, b) => priority[a.input.status] - priority[b.input.status] || b.order - a.order)[0]
        if (!victim) break
        const oldDisplayId = victim.displayId!
        victim.displayId = undefined
        this.transport.hide(oldDisplayId)
      }
      this.show(entry)
    }
  }
}
