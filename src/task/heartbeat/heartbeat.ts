/**
 * Heartbeat — periodic AI self-check, built on top of the cron engine.
 *
 * Registers a cron job (`__heartbeat__`) that fires at a configured interval.
 * When fired, calls the AI engine and filters the response:
 *   1. Active hours guard — skip if outside configured window
 *   2. AI call — engine.askWithSession(prompt, heartbeatSession)
 *   3. Ack token filter — skip if AI says "nothing to report"
 *   4. Dedup — skip if same text was sent within 24h
 *   5. Deliver — resolveDeliveryTarget()?.deliver(text)
 *
 * Events written to eventLog:
 *   - heartbeat.done  { reply, durationMs, delivered }
 *   - heartbeat.skip  { reason }
 *   - heartbeat.error { error, durationMs }
 */

import type { EventLog, EventLogEntry } from '../../core/event-log.js'
import type { Engine } from '../../core/engine.js'
import { SessionStore } from '../../core/session.js'
import { resolveDeliveryTarget } from '../../core/connector-registry.js'
import type { CronEngine, CronFirePayload } from '../cron/engine.js'

// ==================== Constants ====================

export const HEARTBEAT_JOB_NAME = '__heartbeat__'

// ==================== Config ====================

export interface HeartbeatConfig {
  enabled: boolean
  /** Interval between heartbeats, e.g. "30m", "1h". */
  every: string
  /** Prompt sent to the AI on each heartbeat. */
  prompt: string
  /** Token the AI can return to signal "nothing to report". */
  ackToken: string
  /** Max chars for a response to be considered a short ack (suppressed). */
  ackMaxChars: number
  /** Active hours window. Null = always active. */
  activeHours: {
    start: string   // "HH:MM"
    end: string     // "HH:MM"
    timezone: string // IANA timezone or "local"
  } | null
}

export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  enabled: false,
  every: '30m',
  prompt: 'Check if anything needs attention. If nothing to report, reply HEARTBEAT_OK.',
  ackToken: 'HEARTBEAT_OK',
  ackMaxChars: 300,
  activeHours: null,
}

// ==================== Types ====================

export interface HeartbeatOpts {
  config: HeartbeatConfig
  cronEngine: CronEngine
  eventLog: EventLog
  engine: Engine
  /** Optional: inject a session for testing. */
  session?: SessionStore
  /** Inject clock for testing. */
  now?: () => number
}

export interface Heartbeat {
  start(): Promise<void>
  stop(): void
}

// ==================== Factory ====================

export function createHeartbeat(opts: HeartbeatOpts): Heartbeat {
  const { config, cronEngine, eventLog, engine } = opts
  const session = opts.session ?? new SessionStore('heartbeat')
  const now = opts.now ?? Date.now

  let unsubscribe: (() => void) | null = null
  let jobId: string | null = null
  let processing = false

  const dedup = new HeartbeatDedup()

  async function handleFire(entry: EventLogEntry): Promise<void> {
    const payload = entry.payload as CronFirePayload

    // Only handle our own job
    if (payload.jobName !== HEARTBEAT_JOB_NAME) return

    // Guard: skip if already processing
    if (processing) return

    processing = true
    const startMs = now()

    try {
      // 1. Active hours guard
      if (!isWithinActiveHours(config.activeHours, now())) {
        await eventLog.append('heartbeat.skip', { reason: 'outside-active-hours' })
        return
      }

      // 2. Call AI
      const result = await engine.askWithSession(payload.payload, session, {
        historyPreamble: 'The following is the recent heartbeat conversation history.',
      })

      // 3. Ack token filter
      const { shouldSkip, text } = stripAckToken(result.text, config.ackToken, config.ackMaxChars)
      if (shouldSkip) {
        await eventLog.append('heartbeat.skip', { reason: 'ack', text })
        return
      }

      if (!text.trim()) {
        await eventLog.append('heartbeat.skip', { reason: 'empty' })
        return
      }

      // 4. Dedup
      if (dedup.isDuplicate(text, now())) {
        await eventLog.append('heartbeat.skip', { reason: 'duplicate' })
        return
      }

      // 5. Deliver
      let delivered = false
      const target = resolveDeliveryTarget()
      if (target) {
        try {
          await target.deliver(text)
          delivered = true
          dedup.record(text, now())
        } catch (deliveryErr) {
          console.warn('heartbeat: delivery failed:', deliveryErr)
        }
      }

      // 6. Done event
      await eventLog.append('heartbeat.done', {
        reply: text,
        durationMs: now() - startMs,
        delivered,
      })
    } catch (err) {
      console.error('heartbeat: error:', err)
      await eventLog.append('heartbeat.error', {
        error: err instanceof Error ? err.message : String(err),
        durationMs: now() - startMs,
      })
    } finally {
      processing = false
    }
  }

  return {
    async start() {
      if (!config.enabled) return

      // Idempotent: find existing heartbeat job or create one
      const existing = cronEngine.list().find((j) => j.name === HEARTBEAT_JOB_NAME)
      if (existing) {
        jobId = existing.id
        // Update schedule & payload in case config changed
        await cronEngine.update(existing.id, {
          schedule: { kind: 'every', every: config.every },
          payload: config.prompt,
          enabled: true,
        })
      } else {
        jobId = await cronEngine.add({
          name: HEARTBEAT_JOB_NAME,
          schedule: { kind: 'every', every: config.every },
          payload: config.prompt,
        })
      }

      // Subscribe to cron.fire events (filtered in handler)
      unsubscribe = eventLog.subscribeType('cron.fire', (entry) => {
        handleFire(entry).catch((err) => {
          console.error('heartbeat: unhandled error:', err)
        })
      })
    },

    stop() {
      unsubscribe?.()
      unsubscribe = null
      // Don't delete the cron job — it persists for restart recovery
    },
  }
}

// ==================== Ack Token ====================

export interface StripResult {
  shouldSkip: boolean
  text: string
}

/**
 * Strip the ack token from an AI response.
 *
 * If the remaining text after stripping is empty or under ackMaxChars,
 * it's considered "nothing to report" (shouldSkip = true).
 */
export function stripAckToken(raw: string, ackToken: string, ackMaxChars: number): StripResult {
  if (!raw.trim()) return { shouldSkip: true, text: '' }

  // Remove all occurrences of the ack token (case-insensitive, with optional markdown wrapping)
  const escaped = ackToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `(?:\\*{0,2}|<[^>]+>)?\\s*${escaped}\\s*(?:\\*{0,2}|<\\/[^>]+>)?`,
    'gi',
  )

  const stripped = raw.replace(pattern, '').trim()

  if (!stripped) return { shouldSkip: true, text: '' }

  // Short remaining text after stripping → treat as ack noise
  if (stripped.length <= ackMaxChars && raw.includes(ackToken)) {
    return { shouldSkip: true, text: stripped }
  }

  return { shouldSkip: false, text: stripped || raw }
}

// ==================== Active Hours ====================

/**
 * Check if the current time falls within the active hours window.
 * Returns true if no activeHours configured (always active).
 */
export function isWithinActiveHours(
  activeHours: HeartbeatConfig['activeHours'],
  nowMs?: number,
): boolean {
  if (!activeHours) return true

  const { start, end, timezone } = activeHours

  const startMinutes = parseHHMM(start)
  const endMinutes = parseHHMM(end)
  if (startMinutes === null || endMinutes === null) return true

  const nowMinutes = currentMinutesInTimezone(timezone, nowMs)

  // Normal range (e.g. 09:00 → 22:00)
  if (startMinutes <= endMinutes) {
    return nowMinutes >= startMinutes && nowMinutes < endMinutes
  }

  // Overnight range (e.g. 22:00 → 06:00)
  return nowMinutes >= startMinutes || nowMinutes < endMinutes
}

function parseHHMM(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h > 23 || min > 59) return null
  return h * 60 + min
}

function currentMinutesInTimezone(tz: string, nowMs?: number): number {
  const date = nowMs ? new Date(nowMs) : new Date()

  if (tz === 'local') {
    return date.getHours() * 60 + date.getMinutes()
  }

  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    })
    const parts = fmt.formatToParts(date)
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
    return hour * 60 + minute
  } catch {
    return date.getHours() * 60 + date.getMinutes()
  }
}

// ==================== Dedup ====================

/**
 * Suppress identical heartbeat messages within a time window (default 24h).
 */
export class HeartbeatDedup {
  private lastText: string | null = null
  private lastSentAt = 0
  private windowMs: number

  constructor(windowMs = 24 * 60 * 60 * 1000) {
    this.windowMs = windowMs
  }

  isDuplicate(text: string, nowMs = Date.now()): boolean {
    if (this.lastText === null) return false
    if (text !== this.lastText) return false
    return (nowMs - this.lastSentAt) < this.windowMs
  }

  record(text: string, nowMs = Date.now()): void {
    this.lastText = text
    this.lastSentAt = nowMs
  }
}
