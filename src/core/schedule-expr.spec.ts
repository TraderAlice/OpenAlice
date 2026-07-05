import { describe, it, expect } from 'vitest'

import { computeNextRun, nextCronFire } from './schedule-expr.js'

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
    it('rejects a malformed expression', () => {
      expect(nextCronFire('not a cron', base)).toBeNull()
      expect(nextCronFire('0 9 * *', base)).toBeNull() // only 4 fields
    })
  })
})
