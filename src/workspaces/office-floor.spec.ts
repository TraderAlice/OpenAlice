import { describe, expect, it } from 'vitest'

import type { AgentRuntimeEvent } from './agent-runtime-log.js'
import {
  OFFICE_CONFIG,
  OFFICE_REVIEW_HOLD_MS,
  compareOfficeRooms,
  eventsThroughSeq,
  isOfficeWorkspaceSleeping,
  officeHarnessForTemplate,
  officeProjectionNow,
  projectOfficeDrawers,
  projectOfficeFloor,
  type OfficeRosterPerson,
} from './office-floor.js'

const person: OfficeRosterPerson = {
  resumeId: 'resume-alice',
  agent: 'codex',
  name: 'c1',
  title: 'Desk mate',
  sessionRecordId: 'codex-1',
  lastInteractionAt: 1_000,
}

function event(
  seq: number,
  type: AgentRuntimeEvent['type'],
  payload: AgentRuntimeEvent['payload'],
  ts = seq * 1000,
): AgentRuntimeEvent {
  return { seq, ts, type, payload }
}

const subject = {
  workspaceId: 'office-1',
  resumeId: 'resume-alice',
  agent: 'codex',
}

describe('projectOfficeFloor', () => {
  it('keeps only active roster people on the floor', () => {
    const floor = projectOfficeFloor('office-1', [
      person,
      { resumeId: 'resume-gone', agent: 'pi', name: 'p1', presence: 'archived', lastInteractionAt: 1_000 },
      { resumeId: 'resume-dead', agent: 'pi', name: 'p2', lifecycle: 'retired', lastInteractionAt: 1_000 },
    ], [])
    expect(floor.employees.map((row) => row.resumeId)).toEqual(['resume-alice'])
    expect(floor.employees[0]).toMatchObject({ mood: 'idle', bubble: null, lastSeq: 0 })
  })

  it('projects a coworker nametag without replacing the sticky name', () => {
    const floor = projectOfficeFloor('office-1', [{
      ...person,
      displayName: 'AAPL desk',
    }], [])
    expect(floor.employees[0]).toMatchObject({
      name: 'c1',
      title: 'Desk mate',
      displayName: 'AAPL desk',
    })
  })

  it('maps occupancy and turn events onto mood and bubble', () => {
    const started = projectOfficeFloor('office-1', [person], [
      event(1, 'session.born', subject),
      event(2, 'runtime.started', { ...subject, surface: 'headless' }),
    ])
    expect(started.employees[0]).toMatchObject({ mood: 'working', surface: 'headless', bubble: null })

    const tool = projectOfficeFloor('office-1', [person], [
      event(2, 'runtime.started', { ...subject, surface: 'headless' }),
      event(3, 'runtime.turn.tool', { ...subject, toolId: 't1', toolName: 'workspace_list', toolStatus: 'running' }),
    ])
    expect(tool.employees[0]).toMatchObject({
      mood: 'working',
      bubble: { kind: 'tool', name: 'workspace_list' },
    })

    const talking = projectOfficeFloor('office-1', [person], [
      event(3, 'runtime.turn.tool', { ...subject, toolId: 't1', toolName: 'workspace_list', toolStatus: 'completed' }),
      event(4, 'runtime.turn.text', { ...subject, text: 'Desk is clear.' }),
    ])
    expect(talking.employees[0]).toMatchObject({
      mood: 'talking',
      bubble: { kind: 'text', text: 'Desk is clear.' },
    })

    const rejected = projectOfficeFloor('office-1', [person], [
      event(5, 'runtime.rejected', { ...subject, reason: 'unavailable' }),
    ])
    expect(rejected.employees[0]).toMatchObject({ mood: 'waiting', bubble: { kind: 'rejected' } })

    const failed = projectOfficeFloor('office-1', [person], [
      event(6, 'runtime.spawn_failed', { ...subject, error: 'missing binary' }),
    ])
    expect(failed.employees[0]).toMatchObject({
      mood: 'failed',
      bubble: { kind: 'error', text: 'missing binary' },
    })
  })

  it('holds review after a successful stop, then returns to idle', () => {
    const doneAt = 50_000
    const fresh = projectOfficeFloor('office-1', [person], [
      event(7, 'runtime.stopped', { ...subject, status: 'done', assistantText: 'All set.' }, doneAt),
    ], doneAt + 1_000)
    expect(fresh.employees[0]).toMatchObject({
      mood: 'review',
      bubble: { kind: 'text', text: 'All set.' },
    })

    const stale = projectOfficeFloor('office-1', [person], [
      event(7, 'runtime.stopped', { ...subject, status: 'done', assistantText: 'All set.' }, doneAt),
    ], doneAt + OFFICE_REVIEW_HOLD_MS + 1)
    expect(stale.employees[0]).toMatchObject({ mood: 'idle', bubble: null })

    const paused = projectOfficeFloor('office-1', [person], [
      event(8, 'runtime.stopped', { ...subject, status: 'paused' }, doneAt),
    ], doneAt + 1)
    expect(paused.employees[0]).toMatchObject({ mood: 'idle', bubble: null })
  })

  it('ignores events from another office', () => {
    const floor = projectOfficeFloor('office-1', [person], [
      event(1, 'runtime.started', { workspaceId: 'other', resumeId: 'resume-alice', agent: 'codex' }),
    ])
    expect(floor.employees[0]?.mood).toBe('idle')
  })

  it('puts a Workspace to sleep after the configured inactivity window', () => {
    const lastInteractionAt = 10_000
    expect(isOfficeWorkspaceSleeping(
      lastInteractionAt,
      lastInteractionAt + OFFICE_CONFIG.workspaceSleepAfterMs - 1,
    )).toBe(false)
    expect(isOfficeWorkspaceSleeping(
      lastInteractionAt,
      lastInteractionAt + OFFICE_CONFIG.workspaceSleepAfterMs,
    )).toBe(true)
  })

  it('maps Workspace templates into Harness offices', () => {
    expect(officeHarnessForTemplate('chat')).toBe('chat')
    expect(officeHarnessForTemplate('auto-quant-v2')).toBe('auto-quant')
    expect(officeHarnessForTemplate('auto-prediction')).toBe('prediction')
    expect(officeHarnessForTemplate('custom')).toBe('other')
  })

  it('replays by omitting later seqs and using the as-of timestamp', () => {
    const events = [
      event(1, 'runtime.started', { ...subject, surface: 'headless' }, 10_000),
      event(2, 'runtime.turn.text', { ...subject, text: 'Working.' }, 20_000),
      event(3, 'runtime.stopped', { ...subject, status: 'done', assistantText: 'Done.' }, 30_000),
    ]
    const atTool = projectOfficeFloor('office-1', [person], eventsThroughSeq(events, 2), officeProjectionNow(events, 2, 3, 90_000))
    expect(atTool.employees[0]).toMatchObject({
      mood: 'talking',
      bubble: { kind: 'text', text: 'Working.' },
    })
    expect(officeProjectionNow(events, 3, 3, 90_000)).toBe(90_000)
    expect(officeProjectionNow(events, 2, 3, 90_000)).toBe(20_000)
  })

  it('lists this employee\'s office artifacts as drawers', () => {
    const drawers = projectOfficeDrawers('office-1', 'resume-alice', [
      {
        id: 'p1',
        action: 'created',
        at: 2,
        origin: { kind: 'session', workspaceId: 'office-1', resumeId: 'resume-alice', agent: 'codex' },
        artifact: { kind: 'report', workspaceId: 'office-1', path: 'docs/note.md' },
      },
      {
        id: 'p2',
        action: 'created',
        at: 1,
        origin: { kind: 'session', workspaceId: 'other', resumeId: 'resume-alice', agent: 'codex' },
        artifact: { kind: 'report', workspaceId: 'other', path: 'docs/other.md' },
      },
      {
        id: 'p3',
        action: 'commented',
        at: 3,
        origin: { kind: 'session', workspaceId: 'office-1', resumeId: 'resume-bob', agent: 'pi' },
        artifact: { kind: 'issue', workspaceId: 'office-1', issueId: 'iss-1' },
      },
    ])
    expect(drawers).toEqual([
      expect.objectContaining({ id: 'p1', kind: 'report', label: 'note.md', path: 'docs/note.md' }),
    ])
  })

  it('orders chat then auto-quant then prediction then other rooms', () => {
    const rooms = [
      { id: 'q', tag: 'auto-quant' },
      { id: 'p', tag: 'prediction' },
      { id: 'x', tag: 'research' },
      { id: 'c', tag: 'chat' },
    ].sort(compareOfficeRooms)
    expect(rooms.map((room) => room.tag)).toEqual(['chat', 'auto-quant', 'prediction', 'research'])
  })
})
