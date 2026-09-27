/**
 * A-share trading-day helpers for cn-paper (session gate only).
 */

import { CN_WEEKDAY_HOLIDAYS, CN_WEEKEND_OPEN } from './cn-calendar-data.js'
import { cnTradingDayKey } from './cn-rules.js'

const holidaySet = new Set(CN_WEEKDAY_HOLIDAYS)
const weekendOpenSet = new Set(CN_WEEKEND_OPEN)

function shanghaiWeekdayShort(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
  }).formatToParts(now)
  return parts.find((p) => p.type === 'weekday')?.value ?? ''
}

/** True if Asia/Shanghai calendar day is an exchange trading day. */
export function isCnAshareTradingDay(now: Date = new Date()): boolean {
  const key = cnTradingDayKey(now)
  if (weekendOpenSet.has(key)) return true
  const weekday = shanghaiWeekdayShort(now)
  if (weekday === 'Sat' || weekday === 'Sun') return false
  if (holidaySet.has(key)) return false
  return true
}

/**
 * Regular continuous auction session on a trading day:
 * 09:30–11:30 and 13:00–15:00 Asia/Shanghai.
 */
export function isCnAshareSessionOpen(now: Date = new Date()): boolean {
  if (!isCnAshareTradingDay(now)) return false
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const hour = Number(parts.find((p) => p.type === 'hour')?.value)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false
  const mins = hour * 60 + minute
  const morning = mins >= 9 * 60 + 30 && mins < 11 * 60 + 30
  const afternoon = mins >= 13 * 60 && mins < 15 * 60
  return morning || afternoon
}
