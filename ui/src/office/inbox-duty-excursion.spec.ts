// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  clearOfficeInboxDutyExcursion,
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

beforeEach(() => window.sessionStorage.clear())
afterEach(() => window.sessionStorage.clear())

describe('Office Inbox duty excursion', () => {
  it('round-trips one exact captured delivery and its return phase', () => {
    const excursion = { duty: duty(), phase: 'away' as const }
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
    rememberOfficeInboxDutyExcursion({ duty: duty('inbox-a'), phase: 'away' })

    expect(markOfficeInboxDutyPresented({
      workspaceId: 'chat-1',
      inboxEntryId: 'inbox-b',
    })).toBe(false)
    expect(readOfficeInboxDutyExcursion()?.phase).toBe('away')
  })

  it.each([
    (value: Record<string, unknown>) => ({ ...value, phase: 'reviewed' }),
    (value: Record<string, unknown>) => ({ ...value, duty: { ...(value.duty as object), count: 0 } }),
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
    const value = mutate({ duty: duty(), phase: 'away' })
    window.sessionStorage.setItem('openalice:office-inbox-duty-excursion:v2', JSON.stringify(value))
    expect(readOfficeInboxDutyExcursion()).toBeNull()
  })
})
