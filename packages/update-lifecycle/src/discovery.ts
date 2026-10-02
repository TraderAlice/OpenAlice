/** One discovery resource, owned by a target/channel adapter. No transport,
 * timers or installation authority lives here. A failed refresh retains the
 * last observation, but never returns it as a successful fresh check. */
export interface DiscoverySnapshot<T> {
  value: T | null
  error: string | null
  checking: boolean
  checkedAt: number | null
  succeededAt: number | null
}
export class DiscoveryStore<T> {
  private snapshot: DiscoverySnapshot<T> = this.empty()
  private listeners = new Set<() => void>()
  private pending: Promise<T | null> | null = null
  private generation = 0
  constructor(private readonly options: {
    successTtlMs?: number; errorTtlMs?: number; now?: () => number
  } = {}) {}
  private empty(): DiscoverySnapshot<T> {
    return { value: null, error: null, checking: false, checkedAt: null, succeededAt: null }
  }
  getSnapshot = (): DiscoverySnapshot<T> => this.snapshot
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private publish(snapshot: DiscoverySnapshot<T>): void {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
  /** Retire this scope's work. A late transport result cannot repopulate it. */
  clear = (): void => {
    this.generation++
    this.pending = null
    this.publish(this.empty())
  }
  check = (read: () => Promise<T>, force = false): Promise<T | null> => {
    // Force bypasses a settled cache, not an already running probe. Repeated
    // clicks and automatic polling join the same read-only operation.
    if (this.pending) return this.pending
    const now = this.options.now ?? Date.now
    const previous = this.snapshot
    const ttl = previous.error ? this.options.errorTtlMs : this.options.successTtlMs
    if (!force && previous.checkedAt !== null && now() - previous.checkedAt < (ttl ?? 0)) {
      return Promise.resolve(previous.error ? null : previous.value)
    }
    const generation = this.generation
    // Install the flight before publishing checking, including reentrant
    // subscribers. Invoke transport in a microtask so synchronous throws use
    // the same error path as asynchronous failures.
    const pending = Promise.resolve().then(async () => {
      if (generation !== this.generation) return null
      try {
        const value = await read()
        if (generation !== this.generation) return null
        const completedAt = now()
        this.pending = null
        this.publish({ value, error: null, checking: false, checkedAt: completedAt, succeededAt: completedAt })
        return value
      } catch (cause) {
        if (generation !== this.generation) return null
        this.pending = null
        this.publish({ ...this.snapshot, checking: false, checkedAt: now(),
          error: (cause instanceof Error ? cause.message : String(cause)) || 'Discovery failed' })
        return null
      }
    })
    this.pending = pending
    this.publish({ ...previous, checking: true })
    return pending
  }
}
