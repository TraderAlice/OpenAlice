/**
 * ExplorationScheduler — independent node-cron driver for the explorer loop.
 *
 * Mirrors the pattern in strategy/scheduler.ts: idempotent start/stop,
 * in-memory running guard, per-expression validation.
 */

import * as cron from 'node-cron'
import type { Explorer } from './explorer.js'
import type { ExplorationConfig } from './types.js'

export interface ExplorationScheduler {
  start(): void
  stop(): void
  runNow(): Promise<void>
  isRunning(): boolean
}

export function createExplorationScheduler(opts: {
  explorer: Explorer
  config: ExplorationConfig
}): ExplorationScheduler {
  let task: cron.ScheduledTask | null = null
  let running = false

  function start(): void {
    if (task) return
    const { enabled, schedule: scheduleCfg } = opts.config
    if (!enabled || !scheduleCfg.enabled) {
      console.log(
        'Exploration scheduler disabled (enabled=%s, schedule.enabled=%s)',
        enabled,
        scheduleCfg.enabled,
      )
      return
    }
    if (!cron.validate(scheduleCfg.cronExpression)) {
      throw new Error(`Invalid exploration cron expression: ${scheduleCfg.cronExpression}`)
    }

    task = cron.schedule(
      scheduleCfg.cronExpression,
      async () => {
        if (running) {
          console.warn('Exploration already running, skipping this tick')
          return
        }
        running = true
        try {
          await opts.explorer.run({ source: 'cron' })
        } catch (err) {
          console.error('Scheduled exploration failed: %s', err)
        } finally {
          running = false
        }
      },
      { timezone: scheduleCfg.timezone },
    )

    console.log(
      'Exploration scheduler started: %s (%s)',
      scheduleCfg.cronExpression,
      scheduleCfg.timezone,
    )
  }

  function stop(): void {
    if (task) {
      task.stop()
      task = null
      console.log('Exploration scheduler stopped')
    }
  }

  async function runNow(): Promise<void> {
    if (running) {
      throw new Error('Exploration is already running')
    }
    running = true
    try {
      await opts.explorer.run({ source: 'manual' })
    } finally {
      running = false
    }
  }

  return { start, stop, runNow, isRunning: () => running }
}
