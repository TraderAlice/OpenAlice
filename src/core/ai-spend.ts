/**
 * Daily AI-spend ceiling (reserve → call → settle).
 *
 * Ported from nomad-escape-plan's lib/ai-spend.ts. OpenAlice has no database
 * ("all persisted state lives as files"), so the `app_settings` key/value table
 * of the original is a single JSON file of the same shape:
 * `data/ai-spend/app_settings.json` → `{ [key]: string }`. Absent file = defaults,
 * so no migration is needed.
 *
 * Keys (identical to the other apps in the fleet):
 *   ai_daily_spend_ceiling_cents  default "2000" ($20/day)
 *   ai_spend_mode                 default "block" ("block" | "alert")
 *   ai_spend_state                JSON {day, reservedCents, spentCents, hitAt}
 *   ai_spend_alerts               JSON {day, approaching?, over?} — once-per-day alert latch
 *
 * What it guards: every paid call Alice itself makes in-process — the credential
 * key probes (`workspaces/agent-probe.ts`) — and every headless workspace run
 * (cron / API dispatch) since those spawn a CLI that bills the injected API key.
 * Interactive PTY sessions are the user typing into a native CLI; they are not
 * (and cannot be) metered here.
 *
 * Alice is one process, so reads-modify-writes are serialised with an in-process
 * mutex instead of the original's compare-and-swap. The day rolls over at
 * midnight America/New_York. A storage error fails CLOSED in block mode.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { dataPath } from './paths.js'

export const AI_SPEND_CEILING_KEY = 'ai_daily_spend_ceiling_cents'
export const AI_SPEND_MODE_KEY = 'ai_spend_mode'
export const AI_SPEND_STATE_KEY = 'ai_spend_state'
export const AI_SPEND_ALERT_KEY = 'ai_spend_alerts'
/** $20/day. */
export const DEFAULT_CEILING_CENTS = 2000
export const APPROACH_FRACTION = 0.8
export const SPEND_CEILING_REASON = 'AI spend ceiling reached'
/**
 * Headless CLI runs can't report their own cost, so each run is charged this
 * flat estimate (cents) against the ceiling. Override with
 * OPENALICE_HEADLESS_RUN_CENTS.
 */
export const DEFAULT_HEADLESS_RUN_CENTS = 50

export type SpendMode = 'alert' | 'block'
export type SpendAlertLevel = 'none' | 'approaching' | 'over'

export interface AiSpendDayState {
  day: string
  reservedCents: number
  spentCents: number
  /** First time the ceiling was hit today (ISO), or null. */
  hitAt: string | null
}

/** Thrown when block mode refuses a call. Message always starts with "AI spend ceiling reached". */
export class AiSpendCeilingError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'AiSpendCeilingError'
  }
}

// ==================== Pure helpers ====================

const emptyState = (day: string): AiSpendDayState => ({ day, reservedCents: 0, spentCents: 0, hitAt: null })

/** The New York day an instant belongs to (yyyy-mm-dd). */
export function aiSpendDay(now: Date): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
}

export function parseAiSpendState(raw: string | null | undefined, day: string): AiSpendDayState {
  if (!raw) return emptyState(day)
  try {
    const p = JSON.parse(raw) as Partial<AiSpendDayState> | null
    if (!p || typeof p !== 'object' || p.day !== day) return emptyState(day)
    const n = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Number(v)) : 0)
    return { day, reservedCents: n(p.reservedCents), spentCents: n(p.spentCents), hitAt: typeof p.hitAt === 'string' ? p.hitAt : null }
  } catch {
    return emptyState(day)
  }
}

export function dollars(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2)
}

/** Unset / junk → the $20 default. 0 is a valid ceiling (blocks everything). */
export function parseCeilingCents(raw: unknown): number {
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_CEILING_CENTS
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_CEILING_CENTS
}

/** Default is "block" (the fleet-wide safety posture); only an explicit "alert" disables the hard stop. */
export function parseSpendMode(raw: unknown): SpendMode {
  return String(raw ?? '').trim().toLowerCase() === 'alert' ? 'alert' : 'block'
}

export function spendAlertLevel(ceilingCents: number, spentCents: number): SpendAlertLevel {
  if (ceilingCents <= 0) return spentCents > 0 ? 'over' : 'none'
  if (spentCents >= ceilingCents) return 'over'
  if (spentCents >= ceilingCents * APPROACH_FRACTION) return 'approaching'
  return 'none'
}

export type SpendVerdict = { allowed: true } | { allowed: false; reason: string }

export function decideAiSpend(i: { ceilingCents: number; usedCents: number; reservedCents: number; estimateCents: number }): SpendVerdict {
  const spent = Math.max(0, i.usedCents) + Math.max(0, i.reservedCents)
  if (spent + Math.max(0, i.estimateCents) <= i.ceilingCents) return { allowed: true }
  return {
    allowed: false,
    reason: `${SPEND_CEILING_REASON}: $${dollars(spent)} of $${dollars(i.ceilingCents)} used today. Calls resume at midnight New York time, or raise the ceiling in Settings → AI spend.`,
  }
}

// ---- Cost estimation (heuristic reservation; real cost is settled from provider usage) ----

interface PriceTier { inPerMTok: number; outPerMTok: number }
const OPUS: PriceTier = { inPerMTok: 15, outPerMTok: 75 }
const SONNET: PriceTier = { inPerMTok: 3, outPerMTok: 15 }
const HAIKU: PriceTier = { inPerMTok: 1, outPerMTok: 5 }

/** Unknown models price as Sonnet — the safe middle tier, never the cheapest. */
export function priceTierFor(model: string): PriceTier {
  if (/opus|fable/i.test(model)) return OPUS
  if (/haiku|mini|nano/i.test(model)) return HAIKU
  return SONNET
}

/** Whole cents (rounded up) for the given token counts at a model's price. */
export function costCents(model: string, tokensIn: number, tokensOut: number): number {
  const p = priceTierFor(model)
  const usd = (Math.max(0, tokensIn) * p.inPerMTok + Math.max(0, tokensOut) * p.outPerMTok) / 1_000_000
  return Math.max(0, Math.ceil(usd * 100))
}

/** Reservation estimate before a call: worst-case output (`maxTokens`) + ~4 chars/token of prompt. */
export function estimateReserveCents(model: string, maxTokens: number, promptChars: number): number {
  return costCents(model, Math.max(1, Math.ceil(promptChars / 4)), Math.max(0, maxTokens))
}

// ==================== Storage (app_settings.json) ====================

const settingsFile = () => dataPath('ai-spend', 'app_settings.json')

/** Serialises every read-modify-write in this process. */
let chain: Promise<unknown> = Promise.resolve()
function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn)
  chain = run.catch(() => undefined)
  return run
}

async function readSettings(): Promise<Record<string, string>> {
  try {
    const parsed = JSON.parse(await readFile(settingsFile(), 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) if (typeof v === 'string') out[k] = v
    return out
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return {}
    throw err // unreadable/corrupt file → caller decides (block mode fails closed)
  }
}

async function writeSettings(s: Record<string, string>): Promise<void> {
  const file = settingsFile()
  await mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(s, null, 2), 'utf8')
  await rename(tmp, file)
}

// ==================== Alerts ====================

/**
 * Alert at 80% / 100%, once each per day. Delivery: console.warn always; email
 * through Resend's HTTP API when RESEND_API_KEY + AI_SPEND_ALERT_EMAIL_TO are set
 * (AI_SPEND_ALERT_EMAIL_FROM optional). Never throws, never blocks work.
 * Called with the settings lock already released (it does network I/O).
 */
async function sendSpendAlert(level: SpendAlertLevel, ceilingCents: number, spentCents: number): Promise<void> {
  if (level === 'none') return
  const head = level === 'over'
    ? `AI spend reached today's $${dollars(ceilingCents)} ceiling`
    : `AI spend is at 80% of today's $${dollars(ceilingCents)} ceiling`
  const body = `${head}: $${dollars(spentCents)} used so far today (OpenAlice).`
  console.warn(`[ai-spend] ${body}`)
  const key = process.env['RESEND_API_KEY']
  const to = (process.env['AI_SPEND_ALERT_EMAIL_TO'] ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (!key || to.length === 0) return
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env['AI_SPEND_ALERT_EMAIL_FROM'] ?? 'OpenAlice <onboarding@resend.dev>',
        to,
        subject: head,
        html: `<p>${body}</p><p>${level === 'over' ? 'Mode "block" refuses new AI calls until midnight New York time or until the ceiling is raised.' : 'Nothing is stopped yet.'} Adjust it in Settings → AI spend.</p>`,
      }),
      signal: AbortSignal.timeout(8_000),
    })
  } catch (e) {
    console.error('[ai-spend] alert email failed:', e instanceof Error ? e.message : String(e))
  }
}

/** Latch an alert for today inside an already-locked settings object; returns true if it should be sent now. */
function latchAlert(s: Record<string, string>, level: SpendAlertLevel, day: string): boolean {
  if (level === 'none') return false
  let sent: { day?: string; approaching?: boolean; over?: boolean } = {}
  try { sent = JSON.parse(s[AI_SPEND_ALERT_KEY] ?? '{}') ?? {} } catch { sent = {} }
  if (sent.day !== day) sent = { day }
  if (sent[level]) return false
  sent[level] = true
  s[AI_SPEND_ALERT_KEY] = JSON.stringify(sent)
  return true
}

// ==================== Reserve / settle ====================

export type Reservation = { ok: true; reservedCents: number } | { ok: false; reason: string }

/**
 * Admit one paid call: check the ceiling and reserve `estimateCents`.
 * Never throws. In block mode a storage error fails closed (refuses).
 */
export async function reserveAiSpend(estimateCents: number, now: Date = new Date()): Promise<Reservation> {
  const day = aiSpendDay(now)
  const estimate = Math.max(0, Math.ceil(estimateCents))
  let alert: { level: SpendAlertLevel; ceiling: number; spent: number } | null = null
  let result: Reservation
  try {
    result = await locked(async () => {
      const s = await readSettings()
      const ceiling = parseCeilingCents(s[AI_SPEND_CEILING_KEY])
      const mode = parseSpendMode(s[AI_SPEND_MODE_KEY])
      const state = parseAiSpendState(s[AI_SPEND_STATE_KEY], day)
      const verdict = decideAiSpend({ ceilingCents: ceiling, usedCents: state.spentCents, reservedCents: state.reservedCents, estimateCents: estimate })
      if (!verdict.allowed && mode === 'block') {
        const next = { ...state, hitAt: state.hitAt ?? now.toISOString() }
        s[AI_SPEND_STATE_KEY] = JSON.stringify(next)
        const crossed = latchAlert(s, 'over', day)
        await writeSettings(s).catch(() => undefined)
        if (crossed) alert = { level: 'over', ceiling, spent: state.spentCents + state.reservedCents }
        return { ok: false, reason: verdict.reason } as Reservation
      }
      const projected = state.spentCents + state.reservedCents + estimate
      const next: AiSpendDayState = {
        ...state,
        reservedCents: state.reservedCents + estimate,
        hitAt: !verdict.allowed ? (state.hitAt ?? now.toISOString()) : state.hitAt,
      }
      s[AI_SPEND_STATE_KEY] = JSON.stringify(next)
      const level = spendAlertLevel(ceiling, projected)
      if (latchAlert(s, level, day)) alert = { level, ceiling, spent: projected }
      await writeSettings(s)
      return { ok: true, reservedCents: estimate } as Reservation
    })
  } catch (e) {
    // Settings unreadable/unwritable. Fail closed unless alert mode was explicitly chosen (can't know → closed).
    return { ok: false, reason: `${SPEND_CEILING_REASON}: the spend check could not run (${e instanceof Error ? e.message : String(e)}), so the call waits.` }
  }
  const a = alert as { level: SpendAlertLevel; ceiling: number; spent: number } | null
  if (a) void sendSpendAlert(a.level, a.ceiling, a.spent)
  return result
}

/**
 * Give a reservation back, crediting the REAL cost to today's spend. Never throws;
 * a failure leaves the reservation counted until midnight (stricter, never looser).
 */
export async function settleAiSpend(reservedCents: number, actualCents: number, now: Date = new Date()): Promise<void> {
  const reserved = Math.max(0, reservedCents)
  const actual = Math.max(0, actualCents)
  if (reserved <= 0 && actual <= 0) return
  const day = aiSpendDay(now)
  let alert: { level: SpendAlertLevel; ceiling: number; spent: number } | null = null
  try {
    await locked(async () => {
      const s = await readSettings()
      const ceiling = parseCeilingCents(s[AI_SPEND_CEILING_KEY])
      const state = parseAiSpendState(s[AI_SPEND_STATE_KEY], day)
      const next: AiSpendDayState = {
        ...state,
        reservedCents: Math.max(0, state.reservedCents - reserved),
        spentCents: state.spentCents + actual,
      }
      const total = next.spentCents + next.reservedCents
      if (total >= ceiling && !next.hitAt) next.hitAt = now.toISOString()
      s[AI_SPEND_STATE_KEY] = JSON.stringify(next)
      const level = spendAlertLevel(ceiling, total)
      if (latchAlert(s, level, day)) alert = { level, ceiling, spent: total }
      await writeSettings(s)
    })
  } catch (e) {
    console.error('[ai-spend] settling a reservation failed:', e instanceof Error ? e.message : String(e))
  }
  const a = alert as { level: SpendAlertLevel; ceiling: number; spent: number } | null
  if (a) void sendSpendAlert(a.level, a.ceiling, a.spent)
}

/**
 * The gate every paid call goes through: reserve → run → settle.
 * `fn` returns its result; `actualCents(result)` reports the real cost (defaults
 * to the estimate). If `fn` throws, the reservation is released at the estimate
 * (a failed call may still have been billed — never under-count).
 * Throws AiSpendCeilingError when block mode refuses.
 */
export async function withAiSpend<T>(
  estimateCents: number,
  fn: () => Promise<T>,
  actualCents?: (result: T) => number,
): Promise<T> {
  const r = await reserveAiSpend(estimateCents)
  if (!r.ok) throw new AiSpendCeilingError(r.reason)
  try {
    const out = await fn()
    await settleAiSpend(r.reservedCents, actualCents ? actualCents(out) : r.reservedCents)
    return out
  } catch (err) {
    await settleAiSpend(r.reservedCents, r.reservedCents)
    throw err
  }
}

/** Cheap pre-flight (no reservation): is block mode currently refusing? Throws AiSpendCeilingError if so. */
export async function assertAiSpendAllowed(): Promise<void> {
  const st = await readAiSpendStatus()
  if (st.mode === 'block' && st.spentCents + st.reservedCents >= st.ceilingCents) {
    throw new AiSpendCeilingError(
      `${SPEND_CEILING_REASON}: $${dollars(st.spentCents + st.reservedCents)} of $${dollars(st.ceilingCents)} used today. Calls resume at midnight New York time, or raise the ceiling in Settings → AI spend.`,
    )
  }
}

export function headlessRunCents(): number {
  const n = Number(process.env['OPENALICE_HEADLESS_RUN_CENTS'])
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_HEADLESS_RUN_CENTS
}

// ==================== Status + settings (admin UI) ====================

export interface AiSpendStatus {
  day: string
  ceilingCents: number
  mode: SpendMode
  spentCents: number
  reservedCents: number
  hitAt: string | null
  level: SpendAlertLevel
}

export async function readAiSpendStatus(now: Date = new Date()): Promise<AiSpendStatus> {
  const day = aiSpendDay(now)
  let s: Record<string, string> = {}
  try { s = await readSettings() } catch { /* corrupt → defaults shown */ }
  const ceilingCents = parseCeilingCents(s[AI_SPEND_CEILING_KEY])
  const state = parseAiSpendState(s[AI_SPEND_STATE_KEY], day)
  return {
    day,
    ceilingCents,
    mode: parseSpendMode(s[AI_SPEND_MODE_KEY]),
    spentCents: state.spentCents,
    reservedCents: state.reservedCents,
    hitAt: state.hitAt,
    level: spendAlertLevel(ceilingCents, state.spentCents + state.reservedCents),
  }
}

/** Persist the editable settings. Validates; throws on bad input. */
export async function writeAiSpendSettings(input: { ceilingCents?: unknown; mode?: unknown }): Promise<void> {
  await locked(async () => {
    const s = await readSettings().catch(() => ({} as Record<string, string>))
    if (input.ceilingCents !== undefined) {
      const n = Number(input.ceilingCents)
      if (!Number.isFinite(n) || n < 0 || n > 100_000_00) throw new Error('ceilingCents must be a number between 0 and 10000000')
      s[AI_SPEND_CEILING_KEY] = String(Math.round(n))
    }
    if (input.mode !== undefined) {
      if (input.mode !== 'block' && input.mode !== 'alert') throw new Error('mode must be "block" or "alert"')
      s[AI_SPEND_MODE_KEY] = input.mode
    }
    await writeSettings(s)
  })
}
