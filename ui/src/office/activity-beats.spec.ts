import { describe, expect, it } from 'vitest'

import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'
import {
  officeActivityBeats,
  officeActivityBeatSeq,
  officeActivityOverview,
} from './activity-beats'

function event(
  seq: number,
  type: AgentRuntimeEvent['type'],
  overrides: Partial<AgentRuntimeEvent['payload']> = {},
  ts = 1_000_000 - seq,
): AgentRuntimeEvent {
  return {
    seq,
    ts,
    type,
    payload: {
      resumeId: 'resume-a',
      taskId: 'task-a',
      workspaceId: 'office-a',
      ...overrides,
    },
  }
}

describe('officeActivityBeats', () => {
  it('folds adjacent reports from the same task into one newest-first beat', () => {
    const beats = officeActivityBeats([
      event(13, 'runtime.turn.text', { text: 'Newest' }),
      event(12, 'runtime.turn.text', { text: 'Middle' }),
      event(11, 'runtime.turn.text', { text: 'Oldest' }),
    ])

    expect(beats).toEqual([{
      event: event(13, 'runtime.turn.text', { text: 'Newest' }),
      events: [
        event(13, 'runtime.turn.text', { text: 'Newest' }),
        event(12, 'runtime.turn.text', { text: 'Middle' }),
        event(11, 'runtime.turn.text', { text: 'Oldest' }),
      ],
      count: 3,
      oldestSeq: 11,
      oldestTs: 1_000_000 - 11,
    }])
    expect(officeActivityBeatSeq(beats[0])).toBe('#0011–0013')
  })

  it('keeps lifecycle, different actors, and interleaved work as separate story beats', () => {
    const beats = officeActivityBeats([
      event(9, 'runtime.turn.text'),
      event(8, 'runtime.turn.text', { resumeId: 'resume-b' }),
      event(7, 'runtime.stopped', { status: 'done' }),
      event(6, 'runtime.turn.text'),
    ])

    expect(beats.map((beat) => ({ seq: beat.event.seq, count: beat.count }))).toEqual([
      { seq: 9, count: 1 },
      { seq: 8, count: 1 },
      { seq: 7, count: 1 },
      { seq: 6, count: 1 },
    ])
  })

  it('does not fold reports separated by a long quiet period', () => {
    const beats = officeActivityBeats([
      event(2, 'runtime.turn.text', {}, 500_000),
      event(1, 'runtime.turn.text', {}, 100_000),
    ])

    expect(beats).toHaveLength(2)
    expect(officeActivityBeatSeq(beats[0])).toBe('#0002')
  })

  it('keeps every product family visible in a bounded chronological overview', () => {
    const agent = officeActivityBeats(
      Array.from({ length: 12 }, (_, index) => event(120 - index, 'runtime.stopped')),
    )
    const inbox = officeActivityBeats(
      Array.from({ length: 5 }, (_, index) => event(80 - index, 'inbox.received')),
    )
    const news = officeActivityBeats(
      Array.from({ length: 50 }, (_, index) => event(200 - index, 'news.ingested')),
    )

    const overview = officeActivityOverview([agent, inbox, news])

    expect(overview).toHaveLength(30)
    expect(overview.every((beat, index) => index === 0 || overview[index - 1].event.seq > beat.event.seq))
      .toBe(true)
    expect(overview.filter((beat) => beat.event.type === 'runtime.stopped')).toHaveLength(8)
    expect(overview.filter((beat) => beat.event.type === 'inbox.received')).toHaveLength(5)
    expect(overview.filter((beat) => beat.event.type === 'news.ingested')).toHaveLength(17)
  })
})
