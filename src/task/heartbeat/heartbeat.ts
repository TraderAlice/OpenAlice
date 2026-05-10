/**
 * Heartbeat — periodic AI self-check, built on top of the cron engine.
 *
 * Registers a cron job (`__heartbeat__`) that fires at a configured
 * interval. Each fire is submitted to AgentWorkRunner with two gates:
 *
 *   - **inputGate**: active-hours filter — skip without spending tokens
 *     when outside the configured window
 *   - **outputGate**: inspect AI's tool calls — if `notify_user` was
 *     invoked, deliver its `text` arg (after dedup); otherwise skip
 *     silently with reason='ack'
 *   - **onDelivered**: record dedup state on successful delivery
 *
 * Replaces the legacy STATUS regex protocol (`STATUS: HEARTBEAT_OK |
 * CHAT_YES + CONTENT: ...`) with structured tool-call signalling. The
 * runner-side gate handles dedup before the notification reaches
 * connectors, which means duplicate suppression and active-hours
 * filtering are uniform across configurations.
 *
 * Events emitted:
 *   - heartbeat.done  { reply, reason, durationMs, delivered }
 *   - heartbeat.skip  { reason, parsedReason? }
 *   - heartbeat.error { error, durationMs }
 *
 * Heartbeat-specific state stays in this module:
 *   - `HeartbeatDedup` — in-memory 24h window
 *   - `__heartbeat__` cron job lifecycle (idempotent add/update,
 *     hot-toggle via setEnabled)
 *   - active-hours config + tz-aware time-of-day check
 */

import type { AgentWorkRunner, AgentWorkResultProbe } from '../../core/agent-work.js'
import type { Listener } from '../../core/listener.js'
import type { ListenerRegistry } from '../../core/listener-registry.js'
import { SessionStore } from '../../core/session.js'
import { writeConfigSection } from '../../core/config.js'
import type { CronEngine } from '../cron/engine.js'

const HEARTBEAT_EMITS = ['heartbeat.done', 'heartbeat.skip', 'heartbeat.error'] as const
type HeartbeatEmits = typeof HEARTBEAT_EMITS

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
  prompt: `You're Alice in the heartbeat monitoring loop. The system pings you periodically so you can check on what's happening — markets, watchlists, pending items, anything trade-relevant the user might want surfaced.

If something is genuinely worth flagging — a notable move, a finished analysis, an answer to a question they've been waiting on — call the \`notify_user\` tool with a concise message in the user's language.

If there's nothing worth surfacing, simply respond briefly with what you observed (or with nothing at all). Don't call \`notify_user\` out of politeness; reserve it for genuinely useful pushes — the user gets pinged whenever it fires.

In short:
- silence = nothing pushed
- \`notify_user("...")\` = a push lands in the user's inbox`,
  activeHours: null,
}

// ==================== Types ====================

export interface HeartbeatOpts {
  config: HeartbeatConfig
  agentWorkRunner: AgentWorkRunner
  cronEngine: CronEngine
  /** Registry to auto-register the heartbeat listener with. */
  registry: ListenerRegistry
  /** Optional: inject a session for testing. */
  session?: SessionStore
  /** Inject clock for testing. */
  now?: () => number
}

export interface Heartbeat {
  start(): Promise<void>
  stop(): void
  /** Update heartbeat config (interval, prompt, etc.) and sync with cron job. */
  updateConfig(newConfig: HeartbeatConfig): Promise<void>
  /** Hot-toggle heartbeat on/off (persists to config + updates cron job). */
  setEnabled(enabled: boolean): Promise<void>
  /** Current enabled state. */
  isEnabled(): boolean
  /** Expose the raw listener for direct testing. */
  readonly listener: Listener<'cron.fire', HeartbeatEmits>
}

// ==================== Factory ====================

export function createHeartbeat(opts: HeartbeatOpts): Heartbeat {
  let { config } = opts
  const { agentWorkRunner, cronEngine, registry } = opts
  const session = opts.session ?? new SessionStore('heartbeat')
  const now = opts.now ?? Date.now

  let jobId: string | null = null
  let processing = false
  let enabled = config.enabled
  let registered = false

  const dedup = new HeartbeatDedup()

  const listener: Listener<'cron.fire', HeartbeatEmits> = {
    name: 'heartbeat',
    subscribes: 'cron.fire',
    emits: HEARTBEAT_EMITS,
    async handle(entry, ctx) {
      const payload = entry.payload

      // Filter to our own cron job
      if (payload.jobName !== HEARTBEAT_JOB_NAME) return

      // Serial — preserve today's behaviour. Concurrent heartbeats would
      // be ambiguous wrt dedup state.
      if (processing) return

      processing = true
      const startMs = now()
      console.log(`heartbeat: firing at ${new Date(startMs).toISOString()}`)
      try {
        const result = await agentWorkRunner.run(
          {
            prompt: payload.payload,
            session,
            preamble:
              'You are operating in the heartbeat monitoring context (session: heartbeat). The following is the recent heartbeat conversation history.',
            metadata: { source: 'heartbeat' },

            // ---- inputGate: active-hours guard ----
            inputGate: () =>
              isWithinActiveHours(config.activeHours, now())
                ? null
                : {
                    reason: 'outside-active-hours',
                    payload: { reason: 'outside-active-hours' },
                  },

            // ---- outputGate: notify_user inspection + dedup ----
            outputGate: (probe: AgentWorkResultProbe) => {
              const call = probe.toolCalls.find((c) => c.name === 'notify_user')
              if (!call) {
                return {
                  kind: 'skip',
                  reason: 'ack',
                  payload: { reason: 'ack' },
                }
              }
              const text = ((call.input ?? {}) as { text?: string }).text ?? ''
              if (!text.trim()) {
                return {
                  kind: 'skip',
                  reason: 'empty',
                  payload: { reason: 'empty' },
                }
              }
              if (dedup.isDuplicate(text, now())) {
                return {
                  kind: 'skip',
                  reason: 'duplicate',
                  payload: { reason: 'duplicate', parsedReason: text.slice(0, 80) },
                }
              }
              return { kind: 'deliver', text, media: probe.media }
            },

            // ---- onDelivered: record dedup state ----
            onDelivered: (text) => dedup.record(text, now()),

            emitNames: {
              done: 'heartbeat.done',
              skip: 'heartbeat.skip',
              error: 'heartbeat.error',
            },
            buildDonePayload: (_req, _result, durationMs, delivered) => {
              // Look up what we actually delivered (the text the AI passed
              // through notify_user). The runner already invoked notify with
              // the gate's chosen text; for the done payload we re-derive it
              // from the dedup state — `dedup.lastText` is what we just sent.
              const reply = dedup.lastText ?? ''
              return {
                reply,
                reason: 'notify_user',
                durationMs,
                delivered,
              }
            },
            buildErrorPayload: (_req, err, durationMs) => ({
              error: err.message,
              durationMs,
            }),
          },
          ctx.emit as never,
        )

        const durationMs = now() - startMs
        console.log(
          `heartbeat: ${result.outcome}` +
            (result.skipReason ? ` reason=${result.skipReason}` : '') +
            ` (${durationMs}ms)`,
        )
      } finally {
        processing = false
      }
    },
  }

  /** Ensure the cron job exists and listener is registered (idempotent). */
  async function ensureJobAndListener(): Promise<void> {
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

    if (!registered) {
      registry.register(listener)
      registered = true
    }
  }

  return {
    listener,
    async start() {
      // Always register job + listener (even if disabled) so setEnabled can toggle later
      await ensureJobAndListener()
    },

    stop() {
      // Unregister the listener so a subsequent start() re-registers cleanly.
      // Don't delete the cron job — it persists for restart recovery.
      if (registered) {
        registry.unregister(listener.name)
        registered = false
      }
    },

    async updateConfig(newConfig: HeartbeatConfig) {
      config = { ...newConfig }
      enabled = config.enabled
      await ensureJobAndListener()
    },

    async setEnabled(newEnabled: boolean) {
      enabled = newEnabled
      config.enabled = newEnabled

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
 *
 * In-memory only — restart loses dedup state. Acceptable trade-off:
 * heartbeat fires every ~30m by default, so a restart-window
 * collision is rare and the cost (one duplicate notification) is low.
 */
export class HeartbeatDedup {
  /** Public for the heartbeat factory's `buildDonePayload` to read the
   *  most-recently-delivered text without an extra signal channel. */
  public lastText: string | null = null
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
