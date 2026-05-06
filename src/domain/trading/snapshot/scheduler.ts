/**
 * Snapshot scheduler — periodic snapshots via cron engine.
 *
 * Registers a cron job (`__snapshot__`) and registers a `cron.fire` listener
 * with the ListenerRegistry. When fired, captures snapshots for all accounts.
 *
 * Follows the same pattern as the heartbeat system.
 */

import type { EventLogEntry } from '../../../core/event-log.js'
import type { CronFirePayload } from '../../../core/agent-event.js'
import type { CronEngine } from '../../../task/cron/engine.js'
import type { SnapshotService } from './service.js'
import type { Listener } from '../../../core/listener.js'
import type { ListenerRegistry } from '../../../core/listener-registry.js'

const SNAPSHOT_JOB_NAME = '__snapshot__'

export interface SnapshotConfig {
  enabled: boolean
  every: string
}

export interface SnapshotScheduler {
  start(): Promise<void>
  stop(): void
  readonly listener: Listener<'cron.fire'>
}

export function createSnapshotScheduler(deps: {
  snapshotService: SnapshotService
  cronEngine: CronEngine
  registry: ListenerRegistry
  config: SnapshotConfig
}): SnapshotScheduler {
  const { snapshotService, cronEngine, registry, config } = deps

  let processing = false
  let registered = false

  async function handleFire(entry: EventLogEntry<CronFirePayload>): Promise<void> {
    const payload = entry.payload
    if (payload.jobName !== SNAPSHOT_JOB_NAME) return
    if (processing) return

    processing = true
    try {
      await snapshotService.takeAllSnapshots('scheduled')
    } catch (err) {
      console.warn('snapshot-scheduler: error:', err instanceof Error ? err.message : err)
    } finally {
      processing = false
    }
  }

  const listener: Listener<'cron.fire'> = {
    name: 'snapshot',
    subscribes: 'cron.fire',
    handle: handleFire,
  }

  return {
    listener,
    async start() {
      // Find or create the cron job
      const jobs = await cronEngine.list()
      const existing = jobs.find(j => j.name === SNAPSHOT_JOB_NAME)
      if (existing) {
        await cronEngine.update(existing.id, {
          schedule: { kind: 'every', every: config.every },
          enabled: config.enabled,
        })
      } else {
        await cronEngine.add({
          name: SNAPSHOT_JOB_NAME,
          schedule: { kind: 'every', every: config.every },
          payload: '',
          enabled: config.enabled,
        })
      }

      // Register listener exactly once
      if (!registered) {
        registry.register(listener)
        registered = true
      }
    },

    stop() {
      if (registered) {
        registry.unregister(listener.name)
        registered = false
      }
    },
  }
}
