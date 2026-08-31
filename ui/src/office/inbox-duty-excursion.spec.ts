// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  clearOfficeInboxDutyExcursion,
  markOfficeInboxDutyPresented,
  readOfficeInboxDutyExcursion,
  rememberOfficeInboxDutyExcursion,
} from './inbox-duty-excursion'

beforeEach(() => window.sessionStorage.clear())
afterEach(() => window.sessionStorage.clear())

describe('Office Inbox duty excursion', () => {
  it('round-trips one exact captured delivery and its return phase', () => {
    const excursion = {
      throughSeq: 42,
      count: 1 as const,
      workspaceId: 'chat-1',
      inboxEntryId: 'inbox-42',
      documentCount: 2,
      phase: 'away' as const,
    }
    rememberOfficeInboxDutyExcursion(excursion)
    expect(readOfficeInboxDutyExcursion()).toEqual(excursion)

    expect(markOfficeInboxDutyPresented({
      workspaceId: excursion.workspaceId,
      inboxEntryId: excursion.inboxEntryId,
    })).toBe(true)
    expect(readOfficeInboxDutyExcursion()?.phase).toBe('presented')

    rememberOfficeInboxDutyExcursion({ ...excursion, phase: 'returned' })
    expect(readOfficeInboxDutyExcursion()?.phase).toBe('returned')
    clearOfficeInboxDutyExcursion()
    expect(readOfficeInboxDutyExcursion()).toBeNull()
  })

  it('does not accept a different or background-defaulted Inbox entry', () => {
    rememberOfficeInboxDutyExcursion({
      throughSeq: 42,
      count: 1,
      workspaceId: 'chat-1',
      inboxEntryId: 'inbox-a',
      documentCount: 1,
      phase: 'away',
    })

    expect(markOfficeInboxDutyPresented({
      workspaceId: 'chat-1',
      inboxEntryId: 'inbox-b',
    })).toBe(false)
    expect(readOfficeInboxDutyExcursion()?.phase).toBe('away')
  })

  it.each([
    { throughSeq: 0 },
    { count: 2 },
    { workspaceId: '' },
    { inboxEntryId: '' },
    { documentCount: 0 },
    { phase: 'reviewed' },
  ])('fails closed for an invalid captured delivery: %o', (override) => {
    window.sessionStorage.setItem('openalice:office-inbox-duty-excursion:v1', JSON.stringify({
      throughSeq: 42,
      count: 1,
      workspaceId: 'chat-1',
      inboxEntryId: 'inbox-42',
      documentCount: 1,
      phase: 'away',
      ...override,
    }))
    expect(readOfficeInboxDutyExcursion()).toBeNull()
  })
})
