/**
 * Time helpers for daily-pick.
 *
 * All dates are anchored to Asia/Taipei trading time. Taipei is UTC+8 with
 * no DST, so we can derive the calendar date by shifting the system clock
 * by +8h before formatting — no Intl/tz lib needed.
 */

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000

export function nowIso(): string {
  return new Date().toISOString()
}

/** YYYY-MM-DD in Taipei time. */
export function todayInTaipei(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + TAIPEI_OFFSET_MS)
  return shifted.toISOString().slice(0, 10)
}

/** "HH:MM" in Taipei time, 24h. */
export function hourLabelInTaipei(now: Date = new Date()): string {
  const shifted = new Date(now.getTime() + TAIPEI_OFFSET_MS)
  return shifted.toISOString().slice(11, 16)
}

/** True for Mon–Fri (in Taipei time). */
export function isWeekdayInTaipei(now: Date = new Date()): boolean {
  const shifted = new Date(now.getTime() + TAIPEI_OFFSET_MS)
  const dow = shifted.getUTCDay()
  return dow >= 1 && dow <= 5
}
