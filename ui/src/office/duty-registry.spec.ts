import { describe, expect, it } from 'vitest'

import type {
  IssueAutomationHealthState,
  IssueListItem,
  IssueSnapshot,
} from '../api/issues'
import {
  coreOfficeDutyRegistrations,
  officeScheduledIssueFingerprint,
  projectOfficeDutyQueue,
  resolveOfficeDutyTarget,
  scheduledIssueHealthDutyRegistration,
  type OfficeDutyCandidate,
  type OfficeDutyRegistration,
} from './duty-registry'
import type { OfficeProductActivityState } from './useOfficeProductActivity'

const NOW = Date.UTC(2026, 7, 31, 12)

function activity(overrides: Partial<OfficeProductActivityState> = {}): OfficeProductActivityState {
  return {
    agent: null,
    inbox: null,
    news: null,
    attention: { agent: false, inbox: false, news: false },
    pending: { agent: 0, inbox: 0, news: 0 },
    freshKind: null,
    ...overrides,
  }
}

function scheduledIssue(
  state: IssueAutomationHealthState,
  overrides: Partial<IssueListItem> = {},
): IssueListItem {
  return {
    id: 'review-risk',
    title: 'Review liquidity risk',
    status: 'todo',
    priority: 'high',
    assignee: '@new-each-run',
    when: { kind: 'every', every: '1h' },
    lastFiredAtMs: NOW - 60_000,
    nextDueAtMs: NOW + 60_000,
    automationHealth: { state, message: `Health ${state}`, latestTaskId: 'run-a' },
    ...overrides,
  }
}

function snapshot(...issues: IssueListItem[]): IssueSnapshot {
  return {
    workspaces: [{ wsId: 'ws-a', tag: 'alpha', status: 'ok', issues }],
  }
}

describe('Office duty registry', () => {
  it.each(['blocked', 'failed', 'interrupted'] as const)(
    'projects Scheduled Issue health state %s',
    (state) => {
      const registration = scheduledIssueHealthDutyRegistration(NOW, snapshot(scheduledIssue(state)), 'ready')
      expect(registration.candidates).toHaveLength(1)
      expect(registration.candidates[0]).toMatchObject({
        kind: 'cadence',
        destination: { workspaceId: 'ws-a', issueId: 'review-risk', targetId: 'operations' },
      })
    },
  )

  it.each(['inactive', 'not_started', 'due', 'running', 'healthy'] as const)(
    'keeps normal Scheduled Issue health state %s out of the duty queue',
    (state) => {
      expect(scheduledIssueHealthDutyRegistration(
        NOW,
        snapshot(scheduledIssue(state)),
        'ready',
      ).candidates).toEqual([])
    },
  )

  it('requires both a schedule and health projection', () => {
    const noSchedule = scheduledIssue('failed', { when: undefined })
    const noHealth = scheduledIssue('failed', { automationHealth: undefined })
    expect(scheduledIssueHealthDutyRegistration(NOW, snapshot(noSchedule, noHealth), 'ready').candidates)
      .toEqual([])
  })

  it('orders exceptions by health, priority, due, title, workspace, then id', () => {
    const rows: IssueSnapshot = {
      workspaces: [
        {
          wsId: 'ws-b',
          tag: 'beta',
          status: 'ok',
          issues: [scheduledIssue('interrupted', { id: 'i', title: 'A', priority: 'urgent' })],
        },
        {
          wsId: 'ws-a',
          tag: 'alpha',
          status: 'ok',
          issues: [
            scheduledIssue('failed', { id: 'f', title: 'B', priority: 'urgent' }),
            scheduledIssue('blocked', { id: 'b-low', title: 'C', priority: 'low' }),
            scheduledIssue('blocked', { id: 'b-high', title: 'D', priority: 'high' }),
          ],
        },
      ],
    }
    expect(scheduledIssueHealthDutyRegistration(NOW, rows, 'ready').candidates.map((duty) => (
      duty.kind === 'cadence' ? duty.destination.issueId : 'unexpected'
    )))
      .toEqual(['b-high', 'b-low', 'f', 'i'])
  })

  it('normalizes overdue due markers so one reviewed exception does not revive on every poll', () => {
    const first = scheduledIssue('blocked', {
      nextDueAtMs: NOW,
      automationHealth: {
        state: 'blocked',
        message: 'Assigned Session does not exist. Choose an active Session or @new-each-run.',
      },
    }) as IssueListItem & { when: NonNullable<IssueListItem['when']> }
    const second = { ...first, nextDueAtMs: NOW + 15_000 }
    expect(officeScheduledIssueFingerprint(NOW + 30_000, 'ws-a', first))
      .toBe(officeScheduledIssueFingerprint(NOW + 30_000, 'ws-a', second))
  })

  it('reopens a reviewed future exception once when it becomes due', () => {
    const issue = scheduledIssue('failed', {
      nextDueAtMs: NOW + 60_000,
    }) as IssueListItem & { when: NonNullable<IssueListItem['when']> }
    expect(officeScheduledIssueFingerprint(NOW, 'ws-a', issue))
      .not.toBe(officeScheduledIssueFingerprint(NOW + 60_000, 'ws-a', issue))
  })

  it('changes fingerprint for a blocked reason but not presentation-only title and priority edits', () => {
    const missing = scheduledIssue('blocked', {
      automationHealth: {
        state: 'blocked',
        message: 'Assigned Session does not exist. Choose an active Session or @new-each-run.',
      },
    }) as IssueListItem & { when: NonNullable<IssueListItem['when']> }
    const retired = {
      ...missing,
      automationHealth: {
        state: 'blocked' as const,
        message: 'Assigned Session is retired. Reassign the Issue before its next run.',
      },
    }
    const renamed = { ...missing, title: 'New display copy', priority: 'low' as const }
    expect(officeScheduledIssueFingerprint(NOW, 'ws-a', missing))
      .not.toBe(officeScheduledIssueFingerprint(NOW, 'ws-a', retired))
    expect(officeScheduledIssueFingerprint(NOW, 'ws-a', missing))
      .toBe(officeScheduledIssueFingerprint(NOW, 'ws-a', renamed))
  })

  it('keeps unknown blocker wording inside the evidence identity', () => {
    const first = scheduledIssue('blocked', {
      automationHealth: { state: 'blocked', message: 'Custom blocker A.' },
    }) as IssueListItem & { when: NonNullable<IssueListItem['when']> }
    const second = {
      ...first,
      automationHealth: { state: 'blocked' as const, message: 'Custom blocker B.' },
    }
    expect(officeScheduledIssueFingerprint(NOW, 'ws-a', first))
      .not.toBe(officeScheduledIssueFingerprint(NOW, 'ws-a', second))
  })

  it('fences lower-priority duties behind a loading or degraded higher source', () => {
    const agentActivity = activity({
      agent: { seq: 2, occurredAt: NOW },
      attention: { agent: true, inbox: false, news: false },
      pending: { agent: 1, inbox: 0, news: 0 },
    })
    const loadingInbox = coreOfficeDutyRegistrations({
      now: NOW,
      activity: agentActivity,
      activityStatus: 'loading',
      issues: snapshot(),
      issueStatus: 'ready',
    })
    expect(projectOfficeDutyQueue(loadingInbox)).toEqual({ candidates: [], status: 'loading' })

    const degradedCadence = coreOfficeDutyRegistrations({
      now: NOW,
      activity: agentActivity,
      activityStatus: 'ready',
      issues: snapshot(),
      issueStatus: 'error',
    })
    expect(projectOfficeDutyQueue(degradedCadence)).toEqual({ candidates: [], status: 'error' })
  })

  it('keeps Inbox > Cadence > Agent > News and can accept a normalized future provider', () => {
    const allActivity = activity({
      agent: { seq: 3, occurredAt: NOW },
      inbox: { seq: 4, occurredAt: NOW },
      news: { seq: 2, occurredAt: NOW },
      attention: { agent: true, inbox: true, news: true },
      pending: { agent: 1, inbox: 1, news: 1 },
    })
    const registrations = coreOfficeDutyRegistrations({
      now: NOW,
      activity: allActivity,
      activityStatus: 'ready',
      issues: snapshot(scheduledIssue('blocked')),
      issueStatus: 'ready',
    })
    expect(projectOfficeDutyQueue(registrations).candidates[0]?.kind).toBe('inbox')
    expect(projectOfficeDutyQueue(registrations, (duty) => duty.kind !== 'inbox').candidates[0]?.kind)
      .toBe('cadence')

    const futureProvider: OfficeDutyRegistration = {
      id: 'future-domain',
      order: 50,
      status: 'loading',
      candidates: [],
    }
    expect(projectOfficeDutyQueue([futureProvider, ...registrations])).toEqual({
      candidates: [],
      status: 'loading',
    })
  })

  it('preserves one exact documented Inbox subject through the duty destination', () => {
    const inboxActivity = activity({
      inbox: {
        seq: 8,
        occurredAt: NOW,
        detail: 'NVDA weekly evidence brief',
        subject: {
          kind: 'inbox-entry',
          workspaceId: 'chat-1',
          inboxEntryId: 'inbox-8',
          documentCount: 1,
        },
      },
      attention: { agent: false, inbox: true, news: false },
      pending: { agent: 0, inbox: 1, news: 0 },
    })

    const candidate = coreOfficeDutyRegistrations({
      now: NOW,
      activity: inboxActivity,
      activityStatus: 'ready',
      issues: snapshot(),
      issueStatus: 'ready',
    }).find((registration) => registration.id === 'inbox-arrival')!.candidates[0]!

    expect(candidate).toMatchObject({
      kind: 'inbox',
      count: 1,
      destination: {
        kind: 'journal',
        channel: 'inbox',
        targetId: 'inbox-service',
        subject: {
          kind: 'inbox-entry',
          workspaceId: 'chat-1',
          inboxEntryId: 'inbox-8',
          documentCount: 1,
        },
      },
      receipt: { kind: 'event-watermark', family: 'inbox', throughSeq: 8 },
    })
  })

  it('deduplicates logical candidates first-win and resolves exact Agent subjects spatially', () => {
    const agentActivity = activity({
      agent: {
        seq: 3,
        occurredAt: NOW,
        subject: { kind: 'session', workspaceId: 'ws-a', resumeId: 'resume-a' },
      },
      attention: { agent: true, inbox: false, news: false },
      pending: { agent: 2, inbox: 0, news: 0 },
    })
    const agent = coreOfficeDutyRegistrations({
      now: NOW,
      activity: agentActivity,
      activityStatus: 'ready',
      issues: snapshot(),
      issueStatus: 'ready',
    }).find((item) => item.id === 'agent-review')!.candidates[0]!
    const duplicateRegistration: OfficeDutyRegistration = {
      id: 'duplicates',
      order: 1,
      status: 'ready',
      candidates: [agent, { ...agent, count: 99 } as OfficeDutyCandidate],
    }
    expect(projectOfficeDutyQueue([duplicateRegistration]).candidates).toHaveLength(1)
    expect(resolveOfficeDutyTarget(agent, (id) => id === 'employee:ws-a:resume-a')).toMatchObject({
      targetId: 'employee:ws-a:resume-a',
      fallbackTargetId: 'operations',
    })
  })
})
