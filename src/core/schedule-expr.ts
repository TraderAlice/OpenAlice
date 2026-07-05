/**
 * Schedule expression evaluation — pure, no I/O, no clock of its own (every
 * function takes an explicit `afterMs`). Shared by the workspace schedule
 * scanner and (until it is retired) the legacy cron engine.
 *
 * Three schedule kinds:
 *   - at:    one-shot ISO timestamp ("2025-03-01T09:00:00Z")
 *   - every: interval ("2h", "30m", "5m30s")
 *   - cron:  5-field expression ("0 9 * * 1-5" — minute hour dom month dow)
 */

import { parseDuration } from './duration.js'

export type Schedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; every: string }
  | { kind: 'cron'; cron: string }

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
      return nextCronFire(schedule.cron, afterMs)
  }
}

/**
 * Minimal cron expression parser (minute hour dom month dow).
 * Returns the next fire time after `afterMs`, or null if unparseable.
 */
export function nextCronFire(expr: string, afterMs: number): number | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null

  const fields = parts.map(parseFieldValues)
  if (fields.some((f) => f === null)) return null

  const [minutes, hours, doms, months, dows] = fields as number[][]

  const start = new Date(afterMs)
  start.setSeconds(0, 0)
  start.setMinutes(start.getMinutes() + 1)

  const limit = afterMs + 366 * 24 * 60 * 60 * 1000
  const cursor = new Date(start)

  while (cursor.getTime() < limit) {
    if (
      months.includes(cursor.getMonth() + 1) &&
      doms.includes(cursor.getDate()) &&
      dows.includes(cursor.getDay()) &&
      hours.includes(cursor.getHours()) &&
      minutes.includes(cursor.getMinutes())
    ) {
      return cursor.getTime()
    }
    cursor.setMinutes(cursor.getMinutes() + 1)
  }

  return null
}

function parseFieldValues(field: string): number[] | null {
  const result: number[] = []

  for (const part of field.split(',')) {
    const stepMatch = /^(\*|\d+-\d+)\/(\d+)$/.exec(part)
    if (stepMatch) {
      const step = Number(stepMatch[2])
      if (step === 0) return null
      let start: number, end: number
      if (stepMatch[1] === '*') {
        start = 0
        end = 59
      } else {
        const [a, b] = stepMatch[1].split('-').map(Number)
        start = a
        end = b
      }
      for (let i = start; i <= end; i += step) result.push(i)
      continue
    }

    const rangeMatch = /^(\d+)-(\d+)$/.exec(part)
    if (rangeMatch) {
      const a = Number(rangeMatch[1])
      const b = Number(rangeMatch[2])
      for (let i = a; i <= b; i++) result.push(i)
      continue
    }

    if (part === '*') {
      for (let i = 0; i <= 59; i++) result.push(i)
      continue
    }

    const n = Number(part)
    if (Number.isNaN(n)) return null
    result.push(n)
  }

  return result.length > 0 ? result : null
}
