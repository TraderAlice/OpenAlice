// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  clearOfficeInboxDutyExcursion,
  isActiveOfficeInboxDutyReviewTarget,
  markOfficeInboxDutyPresented,
  readOfficeInboxDutyExcursion,
  rememberOfficeInboxDutyExcursion,
} from './inbox-duty-excursion'
import { inboxUnreadDutyRegistration, type OfficeInboxDutyCandidate } from './duty-registry'

function duty(id = 'inbox-42'): OfficeInboxDutyCandidate {
  return inboxUnreadDutyRegistration([{
    title: 'NVDA weekly evidence brief',
    entry: {
      id,
      ts: 42,
      workspaceId: 'chat-1',
      workspaceLabel: 'Semis desk',
      docs: [{ path: 'reports/nvda.md', revision: 'rev-a' }],
    },
  }], 'ready').candidates[0] as OfficeInboxDutyCandidate
}

function routineDuty(id = 'inbox-42'): OfficeInboxDutyCandidate {
  const candidate = duty(id)
  return {
    ...candidate,
    delivery: {
      ...candidate.delivery,
      entry: {
        ...candidate.delivery.entry,
        origin: {
          kind: 'headless',
          runId: 'run-weekly-review',
          issueWorkspaceId: 'issue-home',
          issueId: 'weekly-review',
        },
      },
      declaredIssue: {
        workspaceId: 'issue-home',
        issueId: 'weekly-review',
        title: 'Weekly review',
        priority: 'high',
        nextDueAtMs: null,
        unreadSiblingCount: 0,
        olderUnreadCount: 0,
      },
    },
  }
}

beforeEach(() => window.sessionStorage.clear())
afterEach(() => window.sessionStorage.clear())

describe('Office Inbox duty excursion', () => {
  it('round-trips one exact captured delivery and its return phase', () => {
    const excursion = { duty: duty(), purpose: 'review' as const, phase: 'away' as const }
    rememberOfficeInboxDutyExcursion(excursion)
    expect(readOfficeInboxDutyExcursion()).toEqual(excursion)

    expect(markOfficeInboxDutyPresented({
      workspaceId: 'chat-1',
      inboxEntryId: 'inbox-42',
    })).toBe(true)
    expect(readOfficeInboxDutyExcursion()?.phase).toBe('presented')

    rememberOfficeInboxDutyExcursion({ ...excursion, phase: 'returned' })
    expect(readOfficeInboxDutyExcursion()?.phase).toBe('returned')
    clearOfficeInboxDutyExcursion()
    expect(readOfficeInboxDutyExcursion()).toBeNull()
  })

  it('does not accept a different or background-defaulted Inbox entry', () => {
    rememberOfficeInboxDutyExcursion({ duty: duty('inbox-a'), purpose: 'review', phase: 'away' })

    expect(markOfficeInboxDutyPresented({
      workspaceId: 'chat-1',
      inboxEntryId: 'inbox-b',
    })).toBe(false)
    expect(readOfficeInboxDutyExcursion()?.phase).toBe('away')
  })

  it.each(['away', 'presented', 'returned'] as const)(
    'reserves only the exact review target while the %s checkpoint exists',
    (phase) => {
      rememberOfficeInboxDutyExcursion({ duty: duty('inbox-a'), purpose: 'review', phase })

      expect(isActiveOfficeInboxDutyReviewTarget({
        workspaceId: 'chat-1',
        inboxEntryId: 'inbox-a',
      })).toBe(true)
      expect(isActiveOfficeInboxDutyReviewTarget({
        workspaceId: 'chat-1',
        inboxEntryId: 'inbox-b',
      })).toBe(false)
      expect(isActiveOfficeInboxDutyReviewTarget({
        workspaceId: 'other-workspace',
        inboxEntryId: 'inbox-a',
      })).toBe(false)

      clearOfficeInboxDutyExcursion()
      expect(isActiveOfficeInboxDutyReviewTarget({
        workspaceId: 'chat-1',
        inboxEntryId: 'inbox-a',
      })).toBe(false)
    },
  )

  it.each([
    (value: Record<string, unknown>) => ({ ...value, purpose: 'unknown' }),
    (value: Record<string, unknown>) => ({ ...value, phase: 'reviewed' }),
    (value: Record<string, unknown>) => {
      const { purpose: _purpose, ...withoutPurpose } = value
      return withoutPurpose
    },
    (value: Record<string, unknown>) => ({
      ...value,
      duty: {
        ...routineDuty(),
        delivery: {
          ...routineDuty().delivery,
          declaredIssue: {
            ...routineDuty().delivery.declaredIssue,
            workspaceId: '  ',
          },
        },
      },
    }),
    (value: Record<string, unknown>) => ({
      ...value,
      duty: {
        ...routineDuty(),
        delivery: {
          ...routineDuty().delivery,
          declaredIssue: {
            ...routineDuty().delivery.declaredIssue,
            issueId: '',
          },
        },
      },
    }),
    (value: Record<string, unknown>) => ({ ...value, duty: { ...(value.duty as object), count: 0 } }),
    (value: Record<string, unknown>) => ({
      ...value,
      duty: {
        ...routineDuty(),
        delivery: {
          ...routineDuty().delivery,
          declaredIssue: {
            ...routineDuty().delivery.declaredIssue,
            title: { unexpected: true },
          },
        },
      },
    }),
    (value: Record<string, unknown>) => ({
      ...value,
      duty: {
        ...routineDuty(),
        delivery: {
          ...routineDuty().delivery,
          declaredIssue: {
            ...routineDuty().delivery.declaredIssue,
            priority: 'critical',
          },
        },
      },
    }),
    (value: Record<string, unknown>) => ({
      ...value,
      duty: {
        ...routineDuty(),
        delivery: {
          ...routineDuty().delivery,
          declaredIssue: {
            ...routineDuty().delivery.declaredIssue,
            olderUnreadCount: -1,
          },
        },
      },
    }),
    (value: Record<string, unknown>) => ({
      ...value,
      duty: {
        ...routineDuty(),
        delivery: {
          ...routineDuty().delivery,
          entry: {
            ...routineDuty().delivery.entry,
            origin: {
              ...routineDuty().delivery.entry.origin,
              issueWorkspaceId: 'different-home',
            },
          },
        },
      },
    }),
    (value: Record<string, unknown>) => ({
      ...value,
      duty: {
        ...(value.duty as object),
        delivery: {
          ...(value.duty as OfficeInboxDutyCandidate).delivery,
          excerpt: { unexpected: true },
        },
      },
    }),
    (value: Record<string, unknown>) => ({
      ...value,
      duty: {
        ...(value.duty as object),
        delivery: {
          ...(value.duty as OfficeInboxDutyCandidate).delivery,
          entry: {
            ...(value.duty as OfficeInboxDutyCandidate).delivery.entry,
            workspaceLabel: { unexpected: true },
          },
        },
      },
    }),
    (value: Record<string, unknown>) => ({
      ...value,
      duty: {
        ...(value.duty as object),
        destination: { ...(value.duty as OfficeInboxDutyCandidate).destination, inboxEntryId: 'other' },
      },
    }),
    (value: Record<string, unknown>) => ({
      ...value,
      duty: {
        ...(value.duty as object),
        delivery: {
          ...(value.duty as OfficeInboxDutyCandidate).delivery,
          entry: { ...(value.duty as OfficeInboxDutyCandidate).delivery.entry, workspaceId: '' },
        },
      },
    }),
  ])('fails closed for an invalid captured delivery', (mutate) => {
    const value = mutate({ duty: duty(), purpose: 'review', phase: 'away' })
    window.sessionStorage.setItem('openalice:office-inbox-duty-excursion:v3', JSON.stringify(value))
    expect(readOfficeInboxDutyExcursion()).toBeNull()
  })

  it('ignores the retired v2 checkpoint instead of migrating it', () => {
    window.sessionStorage.setItem('openalice:office-inbox-duty-excursion:v2', JSON.stringify({
      duty: duty(),
      phase: 'presented',
    }))

    expect(readOfficeInboxDutyExcursion()).toBeNull()
  })
})
