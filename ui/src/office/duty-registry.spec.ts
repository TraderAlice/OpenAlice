import { describe, expect, it } from 'vitest'

import type {
  IssueAutomationHealthState,
  IssueListItem,
  IssueSnapshot,
} from '../api/issues'
import {
  coreOfficeDutyRegistrations,
  officeDutyKey,
  officeScheduledIssueFingerprint,
  projectOfficeDutyQueue,
  resolveOfficeDutyTarget,
  scheduledIssueHealthDutyRegistration,
  type OfficeDutyCandidate,
  type OfficeInboxDutyEvidence,
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

function inboxDelivery(
  id: string,
  overrides: Partial<OfficeInboxDutyEvidence> = {},
): OfficeInboxDutyEvidence {
  return {
    title: `Delivery ${id}`,
    entry: {
      id,
      ts: NOW,
      workspaceId: 'chat-1',
      workspaceLabel: 'Semis desk',
      docs: [{ path: `reports/${id}.md`, revision: `rev-${id}` }],
    },
    ...overrides,
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

  it('keys frozen duties by exact evidence while ignoring presentation-only edits', () => {
    const project = (issue: IssueListItem) => scheduledIssueHealthDutyRegistration(
      NOW,
      snapshot(issue),
      'ready',
    ).candidates[0]!
    const first = project(scheduledIssue('failed', {
      automationHealth: { state: 'failed', message: 'Run failed.', latestTaskId: 'run-a' },
    }))
    const changed = project(scheduledIssue('failed', {
      automationHealth: { state: 'failed', message: 'Run failed.', latestTaskId: 'run-b' },
    }))
    const renamed = project(scheduledIssue('failed', {
      title: 'Presentation-only rename',
      priority: 'low',
      automationHealth: { state: 'failed', message: 'Run failed.', latestTaskId: 'run-a' },
    }))

    expect(first.id).toBe(changed.id)
    expect(officeDutyKey(first)).not.toBe(officeDutyKey(changed))
    expect(officeDutyKey(first)).toBe(officeDutyKey(renamed))
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

  it.each(['loading', 'error'] as const)(
    'keeps a known cadence duty visible while Inbox is %s',
    (inboxStatus) => {
      const registrations = coreOfficeDutyRegistrations({
        now: NOW,
        inboxDeliveries: [],
        inboxStatus,
        issues: snapshot(scheduledIssue('failed')),
        issueStatus: 'ready',
      })

      expect(projectOfficeDutyQueue(registrations)).toMatchObject({
        candidates: [{ kind: 'cadence', destination: { issueId: 'review-risk' } }],
        status: inboxStatus,
      })
    },
  )

  it.each(['loading', 'error'] as const)(
    'keeps a known Inbox duty visible while cadence is %s',
    (issueStatus) => {
      const registrations = coreOfficeDutyRegistrations({
        now: NOW,
        inboxDeliveries: [inboxDelivery('known-inbox')],
        inboxStatus: 'ready',
        issues: snapshot(),
        issueStatus,
      })

      expect(projectOfficeDutyQueue(registrations)).toMatchObject({
        candidates: [{ kind: 'inbox', destination: { inboxEntryId: 'known-inbox' } }],
        status: issueStatus,
      })
    },
  )

  it('orders urgent/high cadence, declared urgent/high Inbox, other cadence, then other Inbox', () => {
    const issueData = snapshot(
      scheduledIssue('failed', { id: 'urgent-cadence', priority: 'urgent' }),
      scheduledIssue('healthy', { id: 'priority-report', priority: 'high' }),
      scheduledIssue('interrupted', { id: 'other-cadence', priority: 'medium' }),
    )
    const priorityInbox = inboxDelivery('priority-inbox', {
      entry: {
        ...inboxDelivery('priority-inbox').entry,
        workspaceId: 'execution-ws',
        origin: {
          kind: 'headless',
          runId: 'run-priority',
          issueId: 'priority-report',
          issueWorkspaceId: 'ws-a',
        },
      },
    })
    const registrations = coreOfficeDutyRegistrations({
      now: NOW,
      activity: activity({
        agent: { seq: 3, occurredAt: NOW },
        news: { seq: 4, occurredAt: NOW },
        attention: { agent: true, inbox: false, news: true },
        pending: { agent: 1, inbox: 0, news: 1 },
      }),
      activityStatus: 'ready',
      inboxDeliveries: [inboxDelivery('ordinary-inbox'), priorityInbox],
      inboxStatus: 'ready',
      issues: issueData,
      issueStatus: 'ready',
    })

    expect(projectOfficeDutyQueue(registrations).candidates.map((candidate) => candidate.id)).toEqual([
      'scheduled-issue-health:ws-a:urgent-cadence',
      'inbox-unread:priority-inbox',
      'scheduled-issue-health:ws-a:other-cadence',
      'inbox-unread:ordinary-inbox',
    ])
  })

  it('keeps Agent and raw News journal activity out of the mandatory duty queue', () => {
    const ambientActivity = activity({
      agent: { seq: 8, occurredAt: NOW, eventType: 'runtime.stopped', status: 'done' },
      news: { seq: 7, occurredAt: NOW, detail: 'NVDA closes at a record high', source: 'Wire' },
      attention: { agent: true, inbox: false, news: true },
      pending: { agent: 1, inbox: 0, news: 1 },
      freshKind: 'news',
    })
    const registrations = coreOfficeDutyRegistrations({
      now: NOW,
      activity: ambientActivity,
      activityStatus: 'ready',
      inboxDeliveries: [],
      inboxStatus: 'ready',
      issues: snapshot(),
      issueStatus: 'ready',
    })

    expect(ambientActivity.agent).toMatchObject({ seq: 8, eventType: 'runtime.stopped' })
    expect(ambientActivity.news).toMatchObject({
      seq: 7,
      detail: 'NVDA closes at a record high',
      source: 'Wire',
    })
    expect(registrations.flatMap((registration) => registration.candidates))
      .not.toContainEqual(expect.objectContaining({ kind: expect.stringMatching(/^(agent|news)$/) }))
    expect(projectOfficeDutyQueue(registrations)).toEqual({ candidates: [], status: 'ready' })
  })

  it('projects durable unread Inbox evidence without a journal watermark', () => {
    const candidate = coreOfficeDutyRegistrations({
      now: NOW,
      activity: activity(),
      activityStatus: 'ready',
      inboxDeliveries: [inboxDelivery('inbox-8', { title: 'NVDA weekly evidence brief' })],
      inboxStatus: 'ready',
      issues: snapshot(),
      issueStatus: 'ready',
    }).find((registration) => registration.id === 'inbox-unread')!.candidates[0]!

    expect(candidate).toMatchObject({
      kind: 'inbox',
      count: 1,
      destination: {
        kind: 'inbox-entry',
        targetId: 'inbox-service',
        workspaceId: 'chat-1',
        inboxEntryId: 'inbox-8',
      },
      receipt: { kind: 'inbox-read', workspaceId: 'chat-1', inboxEntryId: 'inbox-8' },
      delivery: { title: 'NVDA weekly evidence brief' },
    })
  })

  it('orders documented Inbox work before messages and drains oldest first', () => {
    const candidates = coreOfficeDutyRegistrations({
      now: NOW,
      activity: activity(),
      activityStatus: 'ready',
      inboxDeliveries: [
        inboxDelivery('new-doc', { entry: { ...inboxDelivery('new-doc').entry, ts: NOW + 20 } }),
        inboxDelivery('message', { entry: { ...inboxDelivery('message').entry, ts: NOW - 20, docs: [] } }),
        inboxDelivery('old-doc', { entry: { ...inboxDelivery('old-doc').entry, ts: NOW - 10 } }),
      ],
      inboxStatus: 'ready',
      issues: snapshot(),
      issueStatus: 'ready',
    })[0]!.candidates

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      'inbox-unread:old-doc',
      'inbox-unread:new-doc',
      'inbox-unread:message',
    ])
    expect(candidates.every((candidate) => candidate.count === 3)).toBe(true)
  })

  it('surfaces the newest unread delivery first inside one exact Scheduled-Issue routine', () => {
    const issueData = snapshot(scheduledIssue('healthy', {
      id: 'asia-close',
      nextDueAtMs: NOW + 3_600_000,
    }))
    const routineDelivery = (id: string, ts: number) => inboxDelivery(id, {
      entry: {
        ...inboxDelivery(id).entry,
        ts,
        origin: {
          kind: 'headless',
          runId: `run-${id}`,
          issueId: 'asia-close',
          issueWorkspaceId: 'ws-a',
        },
      },
    })
    const candidates = coreOfficeDutyRegistrations({
      now: NOW,
      inboxDeliveries: [
        inboxDelivery('ordinary-old', { entry: { ...inboxDelivery('ordinary-old').entry, ts: NOW - 40 } }),
        routineDelivery('routine-old', NOW - 30),
        routineDelivery('routine-new', NOW + 30),
        inboxDelivery('ordinary-new', { entry: { ...inboxDelivery('ordinary-new').entry, ts: NOW + 40 } }),
      ],
      inboxStatus: 'ready',
      issues: issueData,
      issueStatus: 'ready',
    })[0]!.candidates

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      'inbox-unread:ordinary-old',
      'inbox-unread:routine-new',
      'inbox-unread:routine-old',
      'inbox-unread:ordinary-new',
    ])
  })

  it('keeps document deliveries ahead of comments while reversing each exact routine layer', () => {
    const issueData = snapshot(scheduledIssue('healthy', { id: 'layered-report' }))
    const routineDelivery = (id: string, ts: number, documented: boolean) => inboxDelivery(id, {
      entry: {
        ...inboxDelivery(id).entry,
        ts,
        docs: documented ? inboxDelivery(id).entry.docs : [],
        origin: {
          kind: 'headless',
          runId: `run-${id}`,
          issueId: 'layered-report',
          issueWorkspaceId: 'ws-a',
        },
      },
    })
    const candidates = coreOfficeDutyRegistrations({
      now: NOW,
      inboxDeliveries: [
        routineDelivery('old-comment', NOW - 40, false),
        routineDelivery('new-document', NOW + 30, true),
        routineDelivery('old-document', NOW - 30, true),
        routineDelivery('new-comment', NOW + 40, false),
      ],
      inboxStatus: 'ready',
      issues: issueData,
      issueStatus: 'ready',
    })[0]!.candidates

    expect(candidates.map((candidate) => candidate.id)).toEqual([
      'inbox-unread:new-document',
      'inbox-unread:old-document',
      'inbox-unread:new-comment',
      'inbox-unread:old-comment',
    ])
  })

  it('reports exact sibling and older-version counts only for the safely joined routine', () => {
    const nextDueAtMs = NOW + 7_200_000
    const issueData = snapshot(scheduledIssue('healthy', {
      id: 'weekly-report',
      nextDueAtMs,
    }))
    const delivery = (id: string, ts: number, issueWorkspaceId?: string) => inboxDelivery(id, {
      entry: {
        ...inboxDelivery(id).entry,
        ts,
        origin: {
          kind: 'headless',
          runId: `run-${id}`,
          issueId: 'weekly-report',
          ...(issueWorkspaceId ? { issueWorkspaceId } : {}),
        },
      },
    })
    const candidates = coreOfficeDutyRegistrations({
      now: NOW,
      inboxDeliveries: [
        delivery('old', NOW - 20, 'ws-a'),
        delivery('middle', NOW - 10, 'ws-a'),
        delivery('new', NOW, 'ws-a'),
        delivery('wrong-workspace', NOW + 10, 'ws-missing'),
      ],
      inboxStatus: 'ready',
      issues: issueData,
      issueStatus: 'ready',
    })[0]!.candidates
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))

    expect(byId.get('inbox-unread:new')).toMatchObject({
      kind: 'inbox',
      delivery: {
        declaredIssue: {
          nextDueAtMs,
          unreadSiblingCount: 2,
          olderUnreadCount: 2,
        },
      },
    })
    expect(byId.get('inbox-unread:middle')).toMatchObject({
      kind: 'inbox',
      delivery: {
        declaredIssue: {
          unreadSiblingCount: 2,
          olderUnreadCount: 1,
        },
      },
    })
    const wrongWorkspace = byId.get('inbox-unread:wrong-workspace')
    expect(wrongWorkspace?.kind).toBe('inbox')
    if (wrongWorkspace?.kind !== 'inbox') throw new Error('Expected Inbox duty')
    expect(wrongWorkspace.delivery.declaredIssue).toBeUndefined()
  })

  it('uses issueWorkspaceId to resolve an exact declared Issue across Workspace boundaries', () => {
    const issueData: IssueSnapshot = {
      workspaces: [
        {
          wsId: 'ws-a',
          tag: 'alpha',
          status: 'ok',
          issues: [scheduledIssue('healthy', { id: 'shared-report', priority: 'urgent' })],
        },
        {
          wsId: 'ws-b',
          tag: 'beta',
          status: 'ok',
          issues: [scheduledIssue('healthy', { id: 'shared-report', priority: 'low' })],
        },
      ],
    }
    const delivery = inboxDelivery('cross-workspace', {
      entry: {
        ...inboxDelivery('cross-workspace').entry,
        workspaceId: 'execution-ws',
        origin: {
          kind: 'headless',
          runId: 'run-cross',
          issueId: 'shared-report',
          issueWorkspaceId: 'ws-b',
        },
      },
    })
    const candidate = coreOfficeDutyRegistrations({
      now: NOW,
      inboxDeliveries: [delivery],
      inboxStatus: 'ready',
      issues: issueData,
      issueStatus: 'ready',
    })[0]!.candidates[0]!

    expect(candidate).toMatchObject({
      kind: 'inbox',
      delivery: {
        declaredIssue: {
          workspaceId: 'ws-b',
          issueId: 'shared-report',
          priority: 'low',
        },
      },
    })
  })

  it('does not guess a declared Issue from a globally unique issueId without issueWorkspaceId', () => {
    const issueData = snapshot(scheduledIssue('healthy', {
      id: 'unique-report',
      priority: 'urgent',
    }))
    const candidate = coreOfficeDutyRegistrations({
      now: NOW,
      inboxDeliveries: [inboxDelivery('missing-workspace-provenance', {
        entry: {
          ...inboxDelivery('missing-workspace-provenance').entry,
          origin: { kind: 'headless', runId: 'run-unscoped', issueId: 'unique-report' },
        },
      })],
      inboxStatus: 'ready',
      issues: issueData,
      issueStatus: 'ready',
    })[0]!.candidates[0]!

    expect(candidate.kind).toBe('inbox')
    if (candidate.kind !== 'inbox') throw new Error('Expected Inbox duty')
    expect(candidate.delivery.declaredIssue).toBeUndefined()
  })

  it('deduplicates logical candidates first-win and resolves an Inbox target', () => {
    const inbox = coreOfficeDutyRegistrations({
      now: NOW,
      inboxDeliveries: [inboxDelivery('dedup')],
      inboxStatus: 'ready',
      issues: snapshot(),
      issueStatus: 'ready',
    })[0]!.candidates[0]!
    const duplicateRegistration: OfficeDutyRegistration = {
      id: 'duplicates',
      order: 1,
      status: 'ready',
      candidates: [inbox, { ...inbox, count: 99 } as OfficeDutyCandidate],
    }
    expect(projectOfficeDutyQueue([duplicateRegistration]).candidates).toHaveLength(1)
    expect(resolveOfficeDutyTarget(inbox)).toMatchObject({ targetId: 'inbox-service' })
  })
})
