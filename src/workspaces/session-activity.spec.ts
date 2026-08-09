import { describe, expect, it } from 'vitest'

import {
  encodeSessionActivityOsc,
  parseSessionActivityOsc,
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
