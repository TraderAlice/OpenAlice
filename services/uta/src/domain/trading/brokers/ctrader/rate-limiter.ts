/**
 * FIFO sliding-window limiter: at most `limit` grants in any `windowMs`.
 *
 * `tryAcquire` grants synchronously when a slot is free and nobody is
 * queued, so an idle connection sends without an extra async hop.
 */
export class RateLimiter {
  private readonly stamps: number[] = []
  private readonly waiters: Array<() => void> = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(readonly limit: number, readonly windowMs: number) {}

  tryAcquire(): boolean {
    if (this.waiters.length > 0) return false
    return this.take()
  }

  /** Queue for the next free slot. Call only after `tryAcquire` failed. */
  waitTurn(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve)
      this.schedule()
    })
  }

  /** Release every waiter immediately; their callers re-check liveness. */
  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    for (const resolve of this.waiters.splice(0)) resolve()
  }

  private take(): boolean {
    this.prune(Date.now())
    if (this.stamps.length >= this.limit) return false
    this.stamps.push(Date.now())
    return true
  }

  private prune(now: number): void {
    while (this.stamps.length > 0 && this.stamps[0]! <= now - this.windowMs) this.stamps.shift()
  }

  private schedule(): void {
    if (this.timer || this.waiters.length === 0) return
    const now = Date.now()
    this.prune(now)
    const wait = this.stamps.length < this.limit ? 0 : this.stamps[0]! + this.windowMs - now
    this.timer = setTimeout(() => {
      this.timer = null
      while (this.waiters.length > 0 && this.take()) this.waiters.shift()!()
      this.schedule()
    }, Math.max(0, wait))
  }
}
