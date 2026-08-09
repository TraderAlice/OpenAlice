import { describe, expect, it } from 'vitest'

import { parseServerControl } from './protocol'

const attached = {
  type: 'attached',
  wsId: 'ws-1',
  sessionId: 'rec-1',
  name: 'o1',
  pid: 42,
  command: ['opencode'],
  replayFromSeq: 0,
  seq: 12,
  scrollbackTruncated: false,
}

describe('terminal activity protocol', () => {
  it('restores current activity from the attach handshake', () => {
    expect(parseServerControl(JSON.stringify({
      ...attached,
      activity: { phase: 'waiting', observedAt: 123 },
    }))).toMatchObject({
      type: 'attached',
      activity: { phase: 'waiting', observedAt: 123 },
    })
  })

  it('keeps an explicit unavailable fallback for older launchers', () => {
    expect(parseServerControl(JSON.stringify(attached))).toMatchObject({
      type: 'attached',
      activity: { phase: 'unavailable', observedAt: 0 },
    })
  })

  it('rejects malformed activity pushes', () => {
    expect(parseServerControl(JSON.stringify({
      type: 'activity',
      activity: { phase: 'waiting', observedAt: 'yesterday' },
    }))).toBeNull()
  })
})
