import { describe, expect, it } from 'vitest'

import type { SessionRecord } from './api'
import {
  sessionActivityLabelKey,
  sessionPresentationPhase,
} from './session-activity-ui'

function session(input: Partial<SessionRecord>): SessionRecord {
  return {
    id: 'rec-1',
    resumeId: 'resume-1',
    wsId: 'ws-1',
    agent: 'opencode',
    name: 'o1',
    createdAt: '2026-08-09T00:00:00.000Z',
    lastActiveAt: '2026-08-09T00:00:00.000Z',
    state: 'running',
    pid: 42,
    startedAt: 1,
    title: null,
    ...input,
  }
}

describe('Session activity presentation', () => {
  it('does not present a waiting live TUI as working', () => {
    const phase = sessionPresentationPhase(session({
      activity: { phase: 'waiting', observedAt: 10 },
    }))

    expect(phase).toBe('waiting')
    expect(sessionActivityLabelKey(phase)).toBe('workspace.activityReady')
  })

  it('keeps paused lifecycle authoritative and degrades old servers explicitly', () => {
    expect(sessionPresentationPhase(session({ state: 'paused' }))).toBe('paused')
    expect(sessionPresentationPhase(session({ activity: undefined }))).toBe('unavailable')
  })
})
