/**
 * ScheduleMarkerStore - the scanner's OWN last-fired log: `(wsId, taskId) -> ts`.
 *
 * This is the only state the external scheduler keeps, and it deliberately holds
 * NO schedule semantics (no cadence, no `what`, no condition) - just "I last
 * poked this task at T". That keeps the self-description from overflowing
 * outside the workspace: the schedule lives in the workspace's file; the
 * scheduler only remembers its own actions. Due-ness is then (declared cadence)
 * vs (this marker), so a restart that drops the in-memory timer never
 * double-fires, and a window missed during downtime fires exactly once on the
 * next scan (the marker is one timestamp, not a queue of missed windows).
 *
 * Disk shape mirrors HeadlessTaskRegistry: versioned JSON, atomic tmp->rename,
 * co-located under the launcher `state/` dir.
 *
 * Version 2 records last successful fire separately from a held cron cursor
 * (catch-up or calendar-only skip). Version 1 numeric values remain last-fired.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Logger } from '../logger.js'

// A wsId is a route-safe slug (no spaces), so a space cleanly delimits the wsId
// prefix from an agent-authored taskId - the composite is an injective, opaque
// map key.
const SEP = ' '
const composite = (wsId: string, taskId: string): string => `${wsId}${SEP}${taskId}`

interface MarkerRecord {
  fired?: number
  held?: number
}

export class ScheduleMarkerStore {
  private readonly records = new Map<string, MarkerRecord>()

  private constructor(
    private readonly path: string,
    private readonly logger: Logger,
  ) {}

  static async load(path: string, logger: Logger): Promise<ScheduleMarkerStore> {
    const store = new ScheduleMarkerStore(path, logger)
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as { markers?: Record<string, unknown> }
      if (parsed.markers) {
        for (const [key, value] of Object.entries(parsed.markers)) {
          const record = decodeMarker(value)
          if (record) store.records.set(key, record)
        }
      }
    } catch {
      // missing or corrupt -> start clean
    }
    return store
  }

  /** Stable composite key - also used to build the "seen this scan" set for prune(). */
  key(wsId: string, taskId: string): string {
    return composite(wsId, taskId)
  }

  get(wsId: string, taskId: string): number | undefined {
    return this.records.get(composite(wsId, taskId))?.fired
  }

  getHeld(wsId: string, taskId: string): number | undefined {
    return this.records.get(composite(wsId, taskId))?.held
  }

  async set(wsId: string, taskId: string, ts: number): Promise<void> {
    this.records.set(composite(wsId, taskId), { fired: ts })
    await this.flush()
  }

  async hold(wsId: string, taskId: string, ts: number): Promise<void> {
    const current = this.records.get(composite(wsId, taskId)) ?? {}
    this.records.set(composite(wsId, taskId), { ...current, held: ts })
    await this.flush()
  }

  /** Drop markers whose key wasn't seen this scan (workspace/task gone) - bounds growth. */
  async prune(seenKeys: Set<string>): Promise<void> {
    let changed = false
    for (const key of [...this.records.keys()]) {
      if (!seenKeys.has(key)) {
        this.records.delete(key)
        changed = true
      }
    }
    if (changed) await this.flush()
  }

  private async flush(): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true })
      const markers: Record<string, MarkerRecord> = {}
      for (const [key, value] of this.records) markers[key] = value
      const tmp = `${this.path}.tmp`
      await writeFile(tmp, JSON.stringify({ version: 2, markers }, null, 2), 'utf8')
      await rename(tmp, this.path)
    } catch (err) {
      this.logger.warn('schedule_marker.flush_failed', { err })
    }
  }
}

function decodeMarker(value: unknown): MarkerRecord | null {
  if (typeof value === 'number' && Number.isFinite(value)) return { fired: value }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as { fired?: unknown; held?: unknown }
  const next: MarkerRecord = {}
  if (typeof record.fired === 'number' && Number.isFinite(record.fired)) next.fired = record.fired
  if (typeof record.held === 'number' && Number.isFinite(record.held)) next.held = record.held
  return next.fired !== undefined || next.held !== undefined ? next : null
}
