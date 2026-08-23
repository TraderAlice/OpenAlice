export interface RestartBackoffOptions {
  baseDelayMs?: number
  maxDelayMs?: number
  jitterRatio?: number
  random?: () => number
  onScheduled?: (delayMs: number, attempt: number) => void
}

/** Infinite capped retry scheduler for optional Guardian children. One failed
 * recovery schedules the next; a successful recovery resets the backoff. */
export class RestartBackoff {
  private timer?: ReturnType<typeof setTimeout>
  private failures = 0
  private stopped = false

  constructor(private readonly options: RestartBackoffOptions = {}) {}

  schedule(recover: () => Promise<boolean>): void {
    if (this.stopped || this.timer) return
    const base = this.options.baseDelayMs ?? 1_000
    const max = this.options.maxDelayMs ?? 60_000
    const jitterRatio = this.options.jitterRatio ?? 0.2
    const random = this.options.random ?? Math.random
    const unjittered = Math.min(base * 2 ** this.failures, max)
    const jitter = 1 + (random() * 2 - 1) * jitterRatio
    const delayMs = Math.max(0, Math.round(unjittered * jitter))
    const attempt = this.failures + 1
    this.failures += 1
    this.options.onScheduled?.(delayMs, attempt)
    this.timer = setTimeout(() => {
      this.timer = undefined
      if (this.stopped) return
      void recover().then((ready) => {
        if (ready) this.reset()
        else this.schedule(recover)
      }).catch(() => this.schedule(recover))
    }, delayMs)
    this.timer.unref?.()
  }

  reset(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    this.failures = 0
  }

  stop(): void {
    this.stopped = true
    this.reset()
  }
}
