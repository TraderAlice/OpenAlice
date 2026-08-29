import { describe, expect, it } from 'vitest'

import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'
import { projectOfficeProductActivity } from './useOfficeProductActivity'

describe('projectOfficeProductActivity', () => {
  it('keeps the latest Inbox and News facts independently', () => {
    const events: AgentRuntimeEvent[] = [
      {
        seq: 7,
        ts: 700,
        type: 'news.ingested',
        payload: { newsItemId: 3, title: 'Earlier headline', source: 'Wire' },
      },
      {
        seq: 9,
        ts: 900,
        type: 'inbox.received',
        payload: { inboxEntryId: 'inbox-9', summary: 'Research report', agent: 'codex' },
      },
      {
        seq: 11,
        ts: 1_100,
        type: 'news.ingested',
        payload: { newsItemId: 4, title: 'Latest headline', source: 'Market feed' },
      },
    ]

    expect(projectOfficeProductActivity(events)).toEqual({
      inbox: {
        seq: 9,
        occurredAt: 900,
        detail: 'Research report',
        source: 'codex',
        inboxEntryId: 'inbox-9',
      },
      news: {
        seq: 11,
        occurredAt: 1_100,
        detail: 'Latest headline',
        source: 'Market feed',
      },
    })
  })
})
