import { describe, it, expect } from 'vitest'
import { describeBarFreshness } from './freshness.js'
const now = new Date('2026-09-08T08:00:00Z')
describe('bar record freshness', () => {
  it('measures timestamp age with explicit offsets, without claiming latency', () => {
    expect(describeBarFreshness('2026-09-08T15:45:00+08:00', false, now)).toMatchObject({
      fetchedAt: now.toISOString(), latestRecordAt: '2026-09-08T15:45:00+08:00',
      timestampKind: 'instant', recordAgeSeconds: 900, historical: false,
    })
  })
  it('does not manufacture intraday ages from dates or timezone-less records', () => {
    for (const date of ['2026-09-07', '2026-09-08T07:00:00', '', 'invalid']) {
      expect(describeBarFreshness(date, false, now).recordAgeSeconds).toBeNull()
    }
  })
  it('does not clamp future records into an apparently current age', () => {
    expect(describeBarFreshness('2026-09-09T08:00:00Z', false, now).recordAgeSeconds).toBeNull()
  })
  it('identifies explicit historical requests independently of record age', () => {
    expect(describeBarFreshness('2025-01-01T08:00:00Z', true, now).historical).toBe(true)
  })
})

it('reports source classification as possible delay, not measured or declared latency', () => {
  const result = describeBarFreshness('2026-09-08T07:55:00Z', false, now, { earliest: '2026-09-07', capability: 'delayed' })
  expect(result.earliestRecordAt).toBe('2026-09-07')
  expect(result.earliestTimezone).toBeNull()
  expect(result.latestTimezone).toBe('Z')
  expect(result.delay).toMatchObject({ status: 'possible', basis: 'source_classification', estimatedSeconds: null })
})
it('never infers realtime from a fresh record or a realtime capability', () => {
  expect(describeBarFreshness(now.toISOString(), false, now, { capability: 'realtime' }).delay.status).toBe('unknown')
  expect(describeBarFreshness('2026-09-07', true, now, { capability: 'delayed' }).delay.basis).toBe('historical_request')
  expect(describeBarFreshness('', false, now).delay.basis).toBe('no_records')
})
