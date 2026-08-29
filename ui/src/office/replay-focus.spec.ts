import { describe, expect, it } from 'vitest'

import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'
import { officeReplayFocusForEvent } from './replay-focus'

function event(
  type: AgentRuntimeEvent['type'],
  payload: AgentRuntimeEvent['payload'],
): AgentRuntimeEvent {
  return { seq: 42, ts: 1, type, payload }
}

describe('Office replay focus', () => {
  it('targets an exact coworker before the roster and Workspace fallbacks', () => {
    expect(officeReplayFocusForEvent(event('runtime.stopped', {
      workspaceId: 'prediction-1',
      resumeId: 'resume-scout',
    }), 'Scout', 'all')).toEqual({
      seq: 42,
      workspaceId: 'prediction-1',
      targetIds: [
        'employee:prediction-1:resume-scout',
        'roster:prediction-1',
        'sign:prediction-1',
      ],
      label: 'Scout',
      channel: 'all',
    })
  })

  it('routes product activity to its physical service landmark', () => {
    expect(officeReplayFocusForEvent(event('inbox.received', {}), 'Inbox', 'inbox').targetIds)
      .toEqual(['inbox-service'])
    expect(officeReplayFocusForEvent(event('news.ingested', {}), 'Wire', 'news').targetIds)
      .toEqual(['news-service'])
  })

  it('keeps the source journal channel with the floor target', () => {
    expect(officeReplayFocusForEvent(event('news.ingested', {}), 'Wire', 'news'))
      .toMatchObject({ seq: 42, channel: 'news', targetIds: ['news-service'] })
  })
})
