import { describe, it, expect } from 'vitest'

import { computeNextRun, nextCronFire, scheduleCatchesUp, scheduleValidationError } from './schedule-expr.js'

describe('schedule-expr', () => {
  const base = Date.UTC(2026, 0, 1, 12, 0, 0) // 2026-01-01T12:00:00Z (a Thursday)

  describe('every', () => {
    it('adds the parsed interval', () => {
      expect(computeNextRun({ kind: 'every', every: '30m' }, base)).toBe(base + 30 * 60_000)
      expect(computeNextRun({ kind: 'every', every: '2h' }, base)).toBe(base + 2 * 60 * 60_000)
    })
    it('returns null for an unparseable interval', () => {
      expect(computeNextRun({ kind: 'every', every: 'soon' }, base)).toBeNull()
    })
  })

  describe('at', () => {
    it('returns a future timestamp', () => {
      const at = new Date(base + 60_000).toISOString()
      expect(computeNextRun({ kind: 'at', at }, base)).toBe(base + 60_000)
    })
    it('returns null once the timestamp is in the past (one-shot done)', () => {
      const at = new Date(base - 60_000).toISOString()
      expect(computeNextRun({ kind: 'at', at }, base)).toBeNull()
    })
    it('returns null for a bad timestamp', () => {
      expect(computeNextRun({ kind: 'at', at: 'not-a-date' }, base)).toBeNull()
    })
  })

  describe('cron', () => {
    it('catches up missed fires unless catchUp is false', () => {
      expect(scheduleCatchesUp({ kind: 'every', every: '4h' })).toBe(true)
      expect(scheduleCatchesUp({ kind: 'cron', cron: '0 9 * * *' })).toBe(true)
      expect(scheduleCatchesUp({ kind: 'cron', cron: '0 9 * * *', catchUp: true })).toBe(true)
      expect(scheduleCatchesUp({ kind: 'cron', cron: '0 9 * * *', catchUp: false })).toBe(false)
    })
    it('finds the next matching local minute', () => {
      const next = computeNextRun({ kind: 'cron', cron: '0 9 * * *' }, base)
      expect(next).not.toBeNull()
      const d = new Date(next!)
      expect(d.getHours()).toBe(9)
      expect(d.getMinutes()).toBe(0)
    })
    it('honours step fields', () => {
      const next = nextCronFire('*/15 * * * *', base)
      expect(next).not.toBeNull()
      expect(new Date(next!).getMinutes() % 15).toBe(0)
    })
    it('keeps omitted and explicit local timezones equivalent', () => {
      expect(nextCronFire('0 9 * * *', base)).toBe(nextCronFire('0 9 * * *', base, 'local'))
    })
    it('evaluates market-clock schedules in an explicit IANA timezone', () => {
      const winter = Date.UTC(2026, 0, 2, 12, 0, 0)
      const summer = Date.UTC(2026, 6, 2, 12, 0, 0)
      expect(nextCronFire('30 8 * * 1-5', winter, 'America/New_York')).toBe(Date.UTC(2026, 0, 2, 13, 30))
      expect(nextCronFire('30 8 * * 1-5', summer, 'America/New_York')).toBe(Date.UTC(2026, 6, 2, 12, 30))
    })
    it('rejects a malformed expression', () => {
      expect(nextCronFire('not a cron', base)).toBeNull()
      expect(nextCronFire('0 9 * *', base)).toBeNull() // only 4 fields
      expect(nextCronFire('0 9 * * *', base, 'US/Definitely-Not-A-Zone')).toBeNull()
    })
  })
})

describe('schedule write validation', () => {
  it.each([
    [{ kind: 'every', every: '0m' }, 'invalid_interval'],
    [{ kind: 'every', every: '1d' }, 'invalid_interval'],
    [{ kind: 'every', every: '9'.repeat(400) + 'h' }, 'invalid_interval'],
    [{ kind: 'cron', cron: '0 0 * *' }, 'invalid_cron'],
    [{ kind: 'cron', cron: '0 0 31 2 *' }, 'invalid_cron'],
    [{ kind: 'cron', cron: '0 * * * *', timezone: 'Mars/Base' }, 'invalid_timezone'],
    [{ kind: 'at', at: '2026-02-30T09:00:00Z' }, 'invalid_at'],
    [{ kind: 'at', at: '2026-10-03T09:00:00' }, 'invalid_at'],
    [null, 'invalid_schedule'],
  ])('rejects %j without changing reader behavior', (value, error) => {
    expect(scheduleValidationError(value)).toBe(error)
  })
  it.each([
    { kind: 'every', every: '5m30s' },
    { kind: 'cron', cron: '0 * * * *', timezone: 'America/Los_Angeles', catchUp: false },
    { kind: 'cron', cron: '30 8 * * 1-5', timezone: 'local' },
    { kind: 'cron', cron: '0 0 29 2 *' },
    { kind: 'at', at: '2020-01-01T09:00:00-07:00' },
  ])('accepts %j, including absolute times already past', (value) => {
    expect(scheduleValidationError(value)).toBeNull()
  })
})
