/**
 * Cron listener for daily-pick internal jobs.
 *
 * Subscribes to `cron.fire` events and dispatches based on jobName:
 *   __daily_pick_open__    → pick today's stock
 *   __daily_pick_hourly__  → hourly council deliberation
 *   __daily_pick_wrap__    → 5-day wrap-up
 *
 * The default cron-router skips internal jobs (prefixed __), so these
 * handlers are the only ones that act on these names.
 */

import type { EventLogEntry } from '../../core/event-log.js'
import type { CronFirePayload } from '../../core/agent-event.js'
import type { Listener, ListenerContext } from '../../core/listener.js'
import type { ListenerRegistry } from '../../core/listener-registry.js'
import type { DailyPickEngine } from './engine.js'

// Internal jobs act directly on the engine; they emit no downstream
// events (the old cron.done / cron.error lifecycle events were removed
// when the cron pipeline was rebuilt around agent.work.*).
const EMITS = [] as const
type Emits = typeof EMITS

export interface DailyPickListenerOpts {
  engine: DailyPickEngine
  registry: ListenerRegistry
}

export interface DailyPickListener {
  start(): Promise<void>
  stop(): void
}

export const DAILY_PICK_OPEN_JOB = '__daily_pick_open__'
export const DAILY_PICK_HOURLY_JOB = '__daily_pick_hourly__'
export const DAILY_PICK_WRAP_JOB = '__daily_pick_wrap__'

const HANDLED = new Set([DAILY_PICK_OPEN_JOB, DAILY_PICK_HOURLY_JOB, DAILY_PICK_WRAP_JOB])

export function createDailyPickListener(opts: DailyPickListenerOpts): DailyPickListener {
  const { engine, registry } = opts
  let registered = false

  const listener: Listener<'cron.fire', Emits> = {
    name: 'daily-pick-router',
    subscribes: 'cron.fire',
    emits: EMITS,
    async handle(entry: EventLogEntry<CronFirePayload>, _ctx: ListenerContext<Emits>): Promise<void> {
      const { jobName } = entry.payload
      if (!HANDLED.has(jobName)) return

      const startMs = Date.now()
      try {
        if (jobName === DAILY_PICK_OPEN_JOB) await engine.pickToday()
        else if (jobName === DAILY_PICK_HOURLY_JOB) await engine.runHourly()
        else if (jobName === DAILY_PICK_WRAP_JOB) await engine.runWrap()

        console.log(`[daily-pick] handled ${jobName} in ${Date.now() - startMs}ms`)
      } catch (err) {
        console.error(`[daily-pick] job ${jobName} failed:`, err)
      }
    },
  }

  return {
    async start() {
      if (registered) return
      registry.register(listener)
      registered = true
    },
    stop() {
      if (!registered) return
      registry.unregister(listener.name)
      registered = false
    },
  }
}
