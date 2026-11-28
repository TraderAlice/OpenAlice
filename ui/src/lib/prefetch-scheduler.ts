/**
 * Priority-aware task scheduler for background resource prefetching.
 *
 * - `high` tasks (user clicks, visible detail fetches) run immediately and
 *   pause dispatching of new `low` tasks until they settle, so background
 *   warming never contends with interactive requests over slow remote links.
 * - `low` tasks (greedy background warm-up) run with bounded concurrency
 *   (`maxConcurrent = 2`), yield to the main thread via `scheduler.postTask`
 *   (falling back to `setTimeout(..., 0)` where unavailable), and pause while
 *   the document is hidden.
 * - Duplicate keys are coalesced; a `high` call for a queued `low` key promotes
 *   it immediately and shares the same promise.
 */

export type PrefetchPriority = 'high' | 'low'

interface GlobalScheduler {
  postTask<T>(callback: () => T | Promise<T>, options?: { priority?: 'user-blocking' | 'user-visible' | 'background' }): Promise<T>
}

interface QueuedTask<T = unknown> {
  key: string
  run: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason?: unknown) => void
  promise: Promise<T>
}

export interface PrefetchSchedulerOptions {
  maxConcurrent?: number
  /** Test seam to override visibility detection. */
  isHidden?: () => boolean
}

export interface ScheduleOptions {
  /** Place a low-priority task at the front of the background queue. */
  front?: boolean
}

export interface PrefetchScheduler {
  schedule<T>(key: string, run: () => Promise<T>, priority?: PrefetchPriority, opts?: ScheduleOptions): Promise<T>
  cancel(key: string): void
  clear(): void
  stats(): { activeHigh: number; activeLow: number; queuedLow: number }
  dispose(): void
}

function defaultIsHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden'
}

function scheduleBackgroundTurn(cb: () => void): void {
  const maybeScheduler = typeof globalThis !== 'undefined'
    ? (globalThis as { scheduler?: GlobalScheduler }).scheduler
    : undefined
  if (maybeScheduler && typeof maybeScheduler.postTask === 'function') {
    void maybeScheduler.postTask(cb, { priority: 'background' }).catch(() => {
      // Background turn callback handles its own errors; ignore abort noise.
    })
    return
  }
  setTimeout(cb, 0)
}

export function createPrefetchScheduler(opts: PrefetchSchedulerOptions = {}): PrefetchScheduler {
  const maxConcurrent = Math.max(1, opts.maxConcurrent ?? 2)
  const isHidden = opts.isHidden ?? defaultIsHidden

  const queue: QueuedTask[] = []
  const queuedByKey = new Map<string, QueuedTask>()
  const runningByKey = new Map<string, Promise<unknown>>()
  let activeHigh = 0
  let activeLow = 0
  let drainScheduled = false

  function scheduleDrain() {
    if (drainScheduled) return
    if (queue.length === 0 || activeHigh > 0 || activeLow >= maxConcurrent || isHidden()) return
    drainScheduled = true
    scheduleBackgroundTurn(() => {
      drainScheduled = false
      drain()
    })
  }

  function drain() {
    while (queue.length > 0 && activeHigh === 0 && activeLow < maxConcurrent && !isHidden()) {
      const task = queue.shift()!
      queuedByKey.delete(task.key)
      activeLow++
      const finish = () => {
        activeLow--
        if (runningByKey.get(task.key) === task.promise) {
          runningByKey.delete(task.key)
        }
        scheduleDrain()
      }
      const execution = Promise.resolve()
        .then(() => task.run())
        .then(
          (value) => {
            finish()
            task.resolve(value)
            return value
          },
          (error) => {
            finish()
            task.reject(error)
            throw error
          },
        )
      // Avoid unhandled rejection warning on the internal wrapper when callers
      // observe `task.promise` instead.
      execution.catch(() => {})
      runningByKey.set(task.key, task.promise)
    }
  }

  const onVisibilityChange = () => {
    if (!isHidden()) scheduleDrain()
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  function runHigh<T>(key: string, run: () => Promise<T>, existing?: QueuedTask<T>): Promise<T> {
    activeHigh++
    let resolveFn!: (v: T) => void
    let rejectFn!: (r?: unknown) => void
    const promise = existing
      ? existing.promise
      : new Promise<T>((resolve, reject) => {
        resolveFn = resolve
        rejectFn = reject
      })

    runningByKey.set(key, promise)

    const finish = () => {
      activeHigh--
      if (runningByKey.get(key) === promise) {
        runningByKey.delete(key)
      }
      scheduleDrain()
    }

    Promise.resolve()
      .then(() => run())
      .then(
        (value) => {
          finish()
          if (existing) existing.resolve(value)
          else resolveFn(value)
        },
        (error) => {
          finish()
          if (existing) existing.reject(error)
          else rejectFn(error)
        },
      )

    return promise
  }

  function schedule<T>(
    key: string,
    run: () => Promise<T>,
    priority: PrefetchPriority = 'low',
    opts?: ScheduleOptions,
  ): Promise<T> {
    const running = runningByKey.get(key)
    if (running) return running as Promise<T>

    const queued = queuedByKey.get(key) as QueuedTask<T> | undefined
    if (queued) {
      if (priority === 'high') {
        const idx = queue.indexOf(queued as QueuedTask)
        if (idx >= 0) queue.splice(idx, 1)
        queuedByKey.delete(key)
        return runHigh(key, run, queued)
      }
      if (opts?.front) {
        const idx = queue.indexOf(queued as QueuedTask)
        if (idx > 0) {
          queue.splice(idx, 1)
          queue.unshift(queued as QueuedTask)
        }
      }
      return queued.promise
    }

    if (priority === 'high') {
      return runHigh(key, run)
    }

    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })
    const task: QueuedTask<T> = { key, run, resolve, reject, promise }
    if (opts?.front) queue.unshift(task as QueuedTask)
    else queue.push(task as QueuedTask)
    queuedByKey.set(key, task as QueuedTask)
    scheduleDrain()
    return promise
  }

  function cancel(key: string): void {
    const queued = queuedByKey.get(key)
    if (!queued) return
    const idx = queue.indexOf(queued)
    if (idx >= 0) queue.splice(idx, 1)
    queuedByKey.delete(key)
  }

  function clear(): void {
    queue.length = 0
    queuedByKey.clear()
  }

  function stats() {
    return { activeHigh, activeLow, queuedLow: queue.length }
  }

  function dispose(): void {
    clear()
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }

  return { schedule, cancel, clear, stats, dispose }
}

/** Shared singleton scheduler for app-wide resource prefetching. */
export const prefetchScheduler = createPrefetchScheduler({ maxConcurrent: 2 })
