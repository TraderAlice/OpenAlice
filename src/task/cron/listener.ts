/**
 * Cron Listener — subscribes to `cron.fire` events from the EventLog
 * and routes them through the AI Engine for processing.
 *
 * Flow:
 *   eventLog 'cron.fire' → engine.askWithSession(payload, session)
 *                         → resolveDeliveryTarget()?.deliver(reply)
 *                         → eventLog 'cron.done' / 'cron.error'
 *
 * The listener owns a dedicated SessionStore for cron conversations,
 * independent of user chat sessions (Telegram, Web, etc.).
 */

import type { EventLog, EventLogEntry } from '../../core/event-log.js'
import type { Engine } from '../../core/engine.js'
import { SessionStore } from '../../core/session.js'
import { resolveDeliveryTarget } from '../../core/connector-registry.js'
import type { CronFirePayload } from './engine.js'
import { HEARTBEAT_JOB_NAME } from '../heartbeat/heartbeat.js'

// ==================== Types ====================

export interface CronListenerOpts {
  eventLog: EventLog
  engine: Engine
  /** Optional: inject a session for testing. Otherwise creates a dedicated cron session. */
  session?: SessionStore
}

export interface CronListener {
  start(): void
  stop(): void
}

// ==================== Factory ====================

export function createCronListener(opts: CronListenerOpts): CronListener {
  const { eventLog, engine } = opts
  const session = opts.session ?? new SessionStore('cron/default')

  let unsubscribe: (() => void) | null = null
  let processing = false

  async function handleFire(entry: EventLogEntry): Promise<void> {
    const payload = entry.payload as CronFirePayload

    // Guard: heartbeat events are handled by the heartbeat listener
    if (payload.jobName === HEARTBEAT_JOB_NAME) return

    // Guard: skip if already processing (serial execution)
    if (processing) {
      console.warn(`cron-listener: skipping job ${payload.jobId} (already processing)`)
      return
    }

    processing = true
    const startMs = Date.now()

    try {
      // Ask the AI engine with the cron payload
      const result = await engine.askWithSession(payload.payload, session, {
        historyPreamble: 'The following is the recent cron session conversation. This is an automated cron job execution.',
      })

      // Deliver the reply through the last-interacted connector
      const target = resolveDeliveryTarget()
      if (target) {
        try {
          await target.deliver(result.text)
        } catch (deliveryErr) {
          console.warn(`cron-listener: delivery failed for job ${payload.jobId}:`, deliveryErr)
        }
      }

      // Log success
      await eventLog.append('cron.done', {
        jobId: payload.jobId,
        jobName: payload.jobName,
        reply: result.text,
        durationMs: Date.now() - startMs,
      })
    } catch (err) {
      console.error(`cron-listener: error processing job ${payload.jobId}:`, err)

      // Log error
      await eventLog.append('cron.error', {
        jobId: payload.jobId,
        jobName: payload.jobName,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startMs,
      })
    } finally {
      processing = false
    }
  }

  return {
    start() {
      if (unsubscribe) return // already started
      unsubscribe = eventLog.subscribeType('cron.fire', (entry) => {
        // Fire-and-forget — errors are caught inside handleFire
        handleFire(entry).catch((err) => {
          console.error('cron-listener: unhandled error in handleFire:', err)
        })
      })
    },

    stop() {
      unsubscribe?.()
      unsubscribe = null
    },
  }
}
