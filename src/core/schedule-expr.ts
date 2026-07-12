/**
 * Schedule expression evaluation — pure, no I/O, no clock of its own (every
 * function takes an explicit `afterMs`). Shared by the workspace schedule
 * scanner and (until it is retired) the legacy cron engine.
 *
 * Three schedule kinds:
 *   - at:    one-shot ISO timestamp ("2025-03-01T09:00:00Z")
 *   - every: interval ("2h", "30m", "5m30s")
 *   - cron:  5-field expression ("0 9 * * 1-5" — minute hour dom month dow)
 *            evaluated in machine-local time by default, or in an explicit
 *            IANA timezone (for example `America/New_York`).
 */

import { CronExpressionParser } from 'cron-parser'

import { parseDuration } from './duration.js'

/** `local` is a product-level sentinel, not an IANA timezone. It deliberately
 * means "the machine running OpenAlice" so local-life reminders retain their
 * intent when a user runs Alice somewhere else. Market-clock schedules should
 * name their real IANA zone instead (for example `America/New_York`) so DST is
 * part of the schedule rather than an undocumented UTC offset. */
export const LOCAL_SCHEDULE_TIMEZONE = 'local' as const

export type Schedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; every: string }
  | { kind: 'cron'; cron: string; timezone?: string }

/** True for OpenAlice's `local` sentinel or a timezone understood by Intl.
 * Kept next to evaluation so file validation and the scanner cannot disagree. */
export function isValidScheduleTimezone(timezone: string): boolean {
  if (timezone === LOCAL_SCHEDULE_TIMEZONE) return true
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format()
    return true
  } catch {
    return false
  }
}

/** Resolve the product-level timezone to the concrete IANA timezone expected
 * by cron-parser. Omitted remains local for backwards compatibility with every
 * existing Issue file written before timezone was explicit. */
export function resolveScheduleTimezone(timezone?: string): string {
  if (timezone && timezone !== LOCAL_SCHEDULE_TIMEZONE) return timezone
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

/** The next fire time strictly after `afterMs`, or null if none / unparseable. */
export function computeNextRun(schedule: Schedule, afterMs: number): number | null {
  switch (schedule.kind) {
    case 'at': {
      const t = new Date(schedule.at).getTime()
      return Number.isNaN(t) ? null : t > afterMs ? t : null
    }
    case 'every': {
      const ms = parseDuration(schedule.every)
      return ms ? afterMs + ms : null
    }
    case 'cron':
      return nextCronFire(schedule.cron, afterMs, schedule.timezone)
  }
}

/**
 * Parse OpenAlice's deliberately narrow 5-field cron contract (minute hour dom
 * month dow). cron-parser supplies calendar/DST correctness; the field-count
 * guard prevents its optional seconds field and aliases from silently widening
 * the Issue file format.
 * Returns the next fire time after `afterMs`, or null if unparseable.
 */
export function nextCronFire(expr: string, afterMs: number, timezone?: string): number | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  if (timezone && !isValidScheduleTimezone(timezone)) return null
  try {
    const parsed = CronExpressionParser.parse(expr, {
      currentDate: new Date(afterMs),
      tz: resolveScheduleTimezone(timezone),
    })
    return parsed.next().getTime()
  } catch {
    return null
  }
}
