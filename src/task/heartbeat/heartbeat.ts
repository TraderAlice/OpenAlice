/**
 * Heartbeat — periodic AI self-check, built on top of the cron engine.
 *
 * Registers a cron job (`__heartbeat__`) that fires at a configured interval.
 * When fired, calls the AI engine and filters the response:
 *   1. Active hours guard — skip if outside configured window
 *   2. AI call — engine.askWithSession(prompt, heartbeatSession)
 *   3. Ack token filter — skip if AI says "nothing to report"
 *   4. Dedup — skip if same text was sent within 24h
 *   5. Send — connectorCenter.notify(text)
 *
 * Events written to eventLog:
 *   - heartbeat.done  { reply, durationMs, delivered }
 *   - heartbeat.skip  { reason }
 *   - heartbeat.error { error, durationMs }
 */

import type { EventLog, EventLogEntry } from '../../core/event-log.js'
import type { Engine } from '../../core/engine.js'
import { SessionStore } from '../../core/session.js'
import type { ConnectorCenter } from '../../core/connector-center.js'
import { writeConfigSection } from '../../core/config.js'
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
  prompt: `Check if anything needs attention. Respond using the structured format below.

## Response Format

STATUS: HEARTBEAT_OK | CHAT_YES
REASON: <brief explanation of your decision>
CONTENT: <message to deliver, only when STATUS is CHAT_YES>

## Rules

- If in doubt, prefer CHAT_YES over HEARTBEAT_OK — better to over-report than to miss something.
- Keep CONTENT concise but actionable.

## Examples

If nothing to report:
STATUS: HEARTBEAT_OK
REASON: All systems normal, no alerts or notable changes.

If you want to send a message:
STATUS: CHAT_YES
REASON: Significant price movement detected.
CONTENT: BTC just dropped 8% in the last hour — now at $87,200. This may trigger stop-losses.`,
  activeHours: null,
}

// ==================== Types ====================

export interface HeartbeatOpts {
  config: HeartbeatConfig
  connectorCenter: ConnectorCenter
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
  /** Hot-toggle heartbeat on/off (persists to config + updates cron job). */
  setEnabled(enabled: boolean): Promise<void>
  /** Current enabled state. */
  isEnabled(): boolean
}

// ==================== Factory ====================

export function createHeartbeat(opts: HeartbeatOpts): Heartbeat {
  const { config, connectorCenter, cronEngine, eventLog, engine } = opts
  const session = opts.session ?? new SessionStore('heartbeat')
  const now = opts.now ?? Date.now

  let unsubscribe: (() => void) | null = null
  let jobId: string | null = null
  let processing = false
  let enabled = config.enabled

  const dedup = new HeartbeatDedup()

  async function handleFire(entry: EventLogEntry): Promise<void> {
    const payload = entry.payload as CronFirePayload

    // Only handle our own job
    if (payload.jobName !== HEARTBEAT_JOB_NAME) return

    // Guard: skip if already processing
    if (processing) return

    processing = true
    const startMs = now()
    console.log(`heartbeat: firing at ${new Date(startMs).toISOString()}`)

    try {
      // 1. Active hours guard
      if (!isWithinActiveHours(config.activeHours, now())) {
        console.log('heartbeat: skipped (outside active hours)')
        await eventLog.append('heartbeat.skip', { reason: 'outside-active-hours' })
        return
      }

      // 2. Call AI
      const result = await engine.askWithSession(payload.payload, session, {
        historyPreamble: 'The following is the recent heartbeat conversation history.',
      })
      const durationMs = now() - startMs

      // 3. Parse structured response
      const parsed = parseHeartbeatResponse(result.text)

      if (parsed.status === 'HEARTBEAT_OK') {
        console.log(`heartbeat: HEARTBEAT_OK — ${parsed.reason || 'no reason'} (${durationMs}ms)`)
        await eventLog.append('heartbeat.skip', {
          reason: 'ack',
          parsedReason: parsed.reason,
        })
        return
      }

      // CHAT_YES (or unparsed fallback)
      const text = parsed.content || result.text
      if (!text.trim()) {
        console.log(`heartbeat: skipped (empty content) (${durationMs}ms)`)
        await eventLog.append('heartbeat.skip', { reason: 'empty' })
        return
      }

      // 4. Dedup
      if (dedup.isDuplicate(text, now())) {
        console.log(`heartbeat: skipped (duplicate) (${durationMs}ms)`)
        await eventLog.append('heartbeat.skip', { reason: 'duplicate' })
        return
      }

      // 5. Send notification
      let delivered = false
      try {
        const result2 = await connectorCenter.notify(text, {
          media: result.media,
          source: 'heartbeat',
        })
        delivered = result2.delivered
        if (delivered) dedup.record(text, now())
      } catch (sendErr) {
        console.warn('heartbeat: send failed:', sendErr)
      }

      console.log(`heartbeat: CHAT_YES — delivered=${delivered} (${durationMs}ms)`)

      // 6. Done event
      await eventLog.append('heartbeat.done', {
        reply: text,
        reason: parsed.reason,
        durationMs,
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

  /** Ensure the cron job and event listener exist (idempotent). */
  async function ensureJobAndListener(): Promise<void> {
    // Idempotent: find existing heartbeat job or create one
    const existing = cronEngine.list().find((j) => j.name === HEARTBEAT_JOB_NAME)
    if (existing) {
      jobId = existing.id
      await cronEngine.update(existing.id, {
        schedule: { kind: 'every', every: config.every },
        payload: config.prompt,
        enabled,
      })
    } else {
      jobId = await cronEngine.add({
        name: HEARTBEAT_JOB_NAME,
        schedule: { kind: 'every', every: config.every },
        payload: config.prompt,
        enabled,
      })
    }

    // Subscribe to cron.fire events if not already subscribed
    if (!unsubscribe) {
      unsubscribe = eventLog.subscribeType('cron.fire', (entry) => {
        handleFire(entry).catch((err) => {
          console.error('heartbeat: unhandled error:', err)
        })
      })
    }
  }

  return {
    async start() {
      // Always register job + listener (even if disabled) so setEnabled can toggle later
      await ensureJobAndListener()
    },

    stop() {
      unsubscribe?.()
      unsubscribe = null
      // Don't delete the cron job — it persists for restart recovery
    },

    async setEnabled(newEnabled: boolean) {
      enabled = newEnabled

      // Ensure infrastructure exists (handles cold enable when start() was called with disabled)
      await ensureJobAndListener()

      // Persist to config file
      await writeConfigSection('heartbeat', { ...config, enabled: newEnabled })
    },

    isEnabled() {
      return enabled
    },
  }
}

// ==================== Response Parser ====================

export type HeartbeatStatus = 'HEARTBEAT_OK' | 'CHAT_YES'

export interface ParsedHeartbeatResponse {
  status: HeartbeatStatus
  reason: string
  content: string
  /** True when the raw response couldn't be parsed into the structured format. */
  unparsed: boolean
}

/**
 * Parse a structured heartbeat response from the AI.
 *
 * Expected format:
 *   STATUS: HEARTBEAT_OK | CHAT_YES
 *   REASON: <text>
 *   CONTENT: <text>       (only for CHAT_YES)
 *
 * If the response doesn't match the expected format, treats the entire
 * raw text as a CHAT_YES message (fail-open: deliver rather than swallow).
 */
export function parseHeartbeatResponse(raw: string): ParsedHeartbeatResponse {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { status: 'HEARTBEAT_OK', reason: 'empty response', content: '', unparsed: false }
  }

  // Extract STATUS field (case-insensitive, allows leading whitespace on the line)
  const statusMatch = /^\s*STATUS:\s*(HEARTBEAT_OK|CHAT_YES)\s*$/im.exec(trimmed)
  if (!statusMatch) {
    // Fail-open: can't parse → treat as a message to deliver
    return { status: 'CHAT_YES', reason: 'unparsed response', content: trimmed, unparsed: true }
  }

  const status = statusMatch[1].toUpperCase() as HeartbeatStatus

  // Extract REASON field (everything after "REASON:" until next field or end)
  const reasonMatch = /^\s*REASON:\s*(.+?)(?=\n\s*(?:STATUS|CONTENT):|\s*$)/ims.exec(trimmed)
  const reason = reasonMatch?.[1]?.trim() ?? ''

  // Extract CONTENT field (everything after "CONTENT:" to end)
  const contentMatch = /^\s*CONTENT:\s*(.+)/ims.exec(trimmed)
  const content = contentMatch?.[1]?.trim() ?? ''

  return { status, reason, content, unparsed: false }
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
