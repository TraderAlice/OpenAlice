/**
 * Auto-trading scheduler — Phase 1 (read-only).
 *
 * Runs a Pump tick every `tickEvery`. On each tick:
 *   1. Read market-snapshot.json written by okx_snapshot_writer.py.
 *   2. Skip if snapshot is stale (> 15 min) or CIRCUIT_BREAKER=HALT.
 *   3. For each symbol that transitions from all_clear=false → true,
 *      send one notification via ConnectorCenter.
 *   4. Same symbol staying true across ticks is NOT re-notified (dedup set).
 *
 * Phase 2 (open/reduce/stp order execution) is deliberately out of scope
 * here — it requires new UTA HTTP routes that don't exist yet.
 */

import type { ConnectorCenter } from '../../core/connector-center.js'
import type { EventLog } from '../../core/event-log.js'
import { createPump, type Pump } from '../../core/pump.js'
import {
  readMarketSnapshotFile,
  isSnapshotStale,
  MARKET_SNAPSHOT_MAX_AGE_MS,
} from './market-snapshot.js'

export interface AutoTradingSchedulerConfig {
  enabled: boolean
  tickEvery: string
  marketSnapshotPath: string
}

export interface AutoTradingScheduler {
  start(): void
  stop(): void
}

export function createAutoTradingScheduler(deps: {
  config: AutoTradingSchedulerConfig
  connectorCenter: ConnectorCenter
  eventLog: EventLog
}): AutoTradingScheduler {
  const { config, connectorCenter, eventLog } = deps

  /** Track which symbols were all_clear last tick to avoid duplicate notifications. */
  const prevAllClear = new Set<string>()

  async function tick(): Promise<void> {
    const snap = await readMarketSnapshotFile(config.marketSnapshotPath)
    if (!snap?.signals) return

    if (isSnapshotStale(snap, MARKET_SNAPSHOT_MAX_AGE_MS)) {
      await eventLog.append('auto-trading.signal-notify', {
        ok: false,
        reason: 'stale_snapshot',
        updatedAt: snap.updated_at,
      })
      return
    }

    if (snap.CIRCUIT_BREAKER === 'HALT') {
      await eventLog.append('auto-trading.signal-notify', {
        ok: false,
        reason: 'snapshot_circuit_halt',
      })
      return
    }

    const newlyClear: Array<{ symbol: string; price: number; stopLoss?: number }> = []
    const currentClear = new Set<string>()

    for (const [symbol, row] of Object.entries(snap.signals)) {
      if (row.all_clear) {
        currentClear.add(symbol)
        if (!prevAllClear.has(symbol)) {
          newlyClear.push({
            symbol,
            price: (row as Record<string, unknown>).price as number,
            stopLoss: row.suggested_stop_loss,
          })
        }
      }
    }

    prevAllClear.clear()
    for (const s of currentClear) prevAllClear.add(s)

    for (const item of newlyClear) {
      const slText = item.stopLoss != null ? `\n止損建議：${item.stopLoss}` : ''
      const text = `🟢 進場訊號！${item.symbol}\n價格：${item.price}${slText}`
      try {
        await connectorCenter.notify(text, { source: 'cron' })
        await eventLog.append('auto-trading.signal-notify', {
          ok: true,
          symbol: item.symbol,
          price: item.price,
        })
      } catch (err) {
        console.warn(
          'auto-trading-scheduler: notify error:',
          err instanceof Error ? err.message : err,
        )
      }
    }
  }

  const pump: Pump = createPump({
    name: 'auto-trading',
    every: config.tickEvery,
    enabled: config.enabled,
    onTick: tick,
  })

  return {
    start() {
      pump.start()
    },
    stop() {
      pump.stop()
    },
  }
}
