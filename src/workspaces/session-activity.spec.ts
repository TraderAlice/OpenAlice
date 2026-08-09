import { describe, expect, it } from 'vitest'

import {
  encodeSessionActivityOsc,
  parseSessionActivityOsc,
  projectSessionAgentActivity,
} from './session-activity.js'

describe('Session activity OSC protocol', () => {
  it('round-trips a scoped native activity frame', () => {
    const frame = encodeSessionActivityOsc('rec-1', 'working')
    const payload = frame.slice(frame.indexOf(';') + 1, -2)

    expect(frame).toBe(
      '\x1b]6973;openalice-session-activity;v=1;session=rec-1;phase=working\x1b\\',
    )
    expect(parseSessionActivityOsc(payload, 'rec-1')).toBe('working')
  })

  it('ignores malformed, cross-Session, and future-version frames', () => {
    expect(parseSessionActivityOsc(
      'openalice-session-activity;v=1;session=rec-2;phase=waiting',
      'rec-1',
    )).toBeNull()
    expect(parseSessionActivityOsc(
      'openalice-session-activity;v=2;session=rec-1;phase=waiting',
      'rec-1',
    )).toBeNull()
    expect(parseSessionActivityOsc(
      'openalice-session-activity;v=1;session=rec-1;phase=teleporting',
      'rec-1',
    )).toBeNull()
    expect(parseSessionActivityOsc(
      'openalice-session-activity;v=1;v=1;session=rec-1;phase=working',
      'rec-1',
    )).toBeNull()
  })
})

describe('public Session activity projection', () => {
  it('preserves the terminal-native snapshot verbatim', () => {
    const terminal = { phase: 'waiting' as const, observedAt: 42 }
    expect(projectSessionAgentActivity({
      terminal,
      browser: { phase: 'working', startedAt: 7 },
      lastActiveAt: '2026-08-09T00:00:00.000Z',
    })).toBe(terminal)
  })

  it.each([
    ['starting', 'starting'],
    ['idle', 'waiting'],
    ['working', 'working'],
    ['compacting', 'working'],
    ['retrying', 'working'],
    ['failed', 'failed'],
    ['stopped', 'stopped'],
  ] as const)('maps WebPi %s to %s', (browserPhase, expectedPhase) => {
    expect(projectSessionAgentActivity({
      browser: { phase: browserPhase, startedAt: 77 },
      lastActiveAt: '2026-08-09T00:00:00.000Z',
    })).toEqual({ phase: expectedPhase, observedAt: 77 })
  })

  it('marks a record without a live process stopped using a safe timestamp', () => {
    expect(projectSessionAgentActivity({
      lastActiveAt: '2026-08-09T00:00:00.000Z',
    })).toEqual({ phase: 'stopped', observedAt: Date.parse('2026-08-09T00:00:00.000Z') })
    expect(projectSessionAgentActivity({ lastActiveAt: 'not-a-date' }))
      .toEqual({ phase: 'stopped', observedAt: 0 })
  })
})
