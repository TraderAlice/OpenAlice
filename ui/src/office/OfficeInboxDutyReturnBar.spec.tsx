// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  readOfficeInboxDutyExcursion,
  rememberOfficeInboxDutyExcursion,
} from './inbox-duty-excursion'
import { inboxUnreadDutyRegistration, type OfficeInboxDutyCandidate } from './duty-registry'
import { OfficeInboxDutyReturnBar } from './OfficeInboxDutyReturnBar'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'office.excursionEyebrow') {
        return `Office duty ${values?.position}/${values?.total}`
      }
      if (key === 'office.excursionInbox') return 'Inbox review'
      if (key === 'office.routineReport') return 'Routine report'
      if (key === 'office.excursionReturn') return 'Return to Office'
      if (key === 'office.excursionAriaLabel') {
        return `Office shift ${values?.position} of ${values?.total}: ${values?.type}, ${values?.title}`
      }
      return key
    },
  }),
}))

function duty(id = 'inbox-42'): OfficeInboxDutyCandidate {
  return inboxUnreadDutyRegistration([{
    title: 'NVDA weekly evidence brief with a deliberately long exact title',
    entry: {
      id,
      ts: 42,
      workspaceId: 'chat-1',
      workspaceLabel: 'Semis desk',
      docs: [{ path: 'reports/nvda/weekly.md', revision: 'rev-a' }],
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
          issueWorkspaceId: 'chat-1',
          issueId: 'weekly-review',
        },
      },
      declaredIssue: {
        workspaceId: 'chat-1',
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

function remember(
  phase: 'away' | 'presented' | 'returned',
  capturedDuty: OfficeInboxDutyCandidate = duty(),
) {
  rememberOfficeInboxDutyExcursion({
    duty: capturedDuty,
    purpose: 'review',
    phase,
    shift: { position: 2, total: 4 },
  })
}

beforeEach(() => window.sessionStorage.clear())
afterEach(() => {
  cleanup()
  window.sessionStorage.clear()
})

describe('OfficeInboxDutyReturnBar', () => {
  it('renders its fallback without an active Office checkpoint and subscribes to a later exact duty', async () => {
    const onReturn = vi.fn()
    render(
      <OfficeInboxDutyReturnBar
        surface={{
          kind: 'inbox',
          visible: true,
          workspaceId: 'chat-1',
          inboxEntryId: 'inbox-42',
        }}
        onReturn={onReturn}
        fallback={<h1>Inbox header</h1>}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Inbox header' })).toBeTruthy()

    act(() => remember('away'))

    expect(await screen.findByText('Office duty 2/4')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Inbox header' })).toBeNull()
    await waitFor(() => expect(readOfficeInboxDutyExcursion()?.phase).toBe('presented'))

    const region = screen.getByRole('region', {
      name: /Office shift 2 of 4: Inbox review, NVDA weekly evidence brief/,
    })
    expect(region.getAttribute('data-surface')).toBe('inbox')
    expect(region.getAttribute('data-duty-type')).toBe('inbox')
    const announcer = screen.getByTestId('office-excursion-announcer')
    expect(announcer.getAttribute('aria-live')).toBe('polite')
    expect(announcer.getAttribute('aria-atomic')).toBe('true')
    await waitFor(() => expect(announcer.textContent).toContain(
      'Office shift 2 of 4: Inbox review, NVDA weekly evidence brief',
    ))
    expect(screen.getByText('Inbox review')).toBeTruthy()
    expect(region.querySelector('.oa-office-excursion-return__title')?.getAttribute('title'))
      .toBe('NVDA weekly evidence brief with a deliberately long exact title')

    fireEvent.click(screen.getByRole('button', { name: 'Return to Office' }))
    expect(onReturn).toHaveBeenCalledTimes(1)
    expect(readOfficeInboxDutyExcursion()?.phase).toBe('presented')
  })

  it('neither presents nor replaces the fallback for a hidden or different Inbox entry', async () => {
    remember('away')
    const view = render(
      <OfficeInboxDutyReturnBar
        surface={{
          kind: 'inbox',
          visible: false,
          workspaceId: 'chat-1',
          inboxEntryId: 'inbox-42',
        }}
        onReturn={vi.fn()}
        fallback={<span>Ordinary header</span>}
      />,
    )

    expect(screen.getByText('Ordinary header')).toBeTruthy()
    expect(readOfficeInboxDutyExcursion()?.phase).toBe('away')

    view.rerender(
      <OfficeInboxDutyReturnBar
        surface={{
          kind: 'inbox',
          visible: true,
          workspaceId: 'chat-1',
          inboxEntryId: 'inbox-other',
        }}
        onReturn={vi.fn()}
        fallback={<span>Ordinary header</span>}
      />,
    )
    expect(screen.getByText('Ordinary header')).toBeTruthy()
    expect(readOfficeInboxDutyExcursion()?.phase).toBe('away')

    view.rerender(
      <OfficeInboxDutyReturnBar
        surface={{
          kind: 'inbox',
          visible: true,
          workspaceId: 'chat-1',
          inboxEntryId: 'inbox-42',
        }}
        onReturn={vi.fn()}
        fallback={<span>Ordinary header</span>}
      />,
    )
    await waitFor(() => expect(readOfficeInboxDutyExcursion()?.phase).toBe('presented'))
    expect(screen.getByText('Office duty 2/4')).toBeTruthy()
  })

  it('shows a routine file checkpoint only for the exact complete document path after presentation', () => {
    remember('away', routineDuty())
    const view = render(
      <OfficeInboxDutyReturnBar
        surface={{ kind: 'file', workspaceId: 'chat-1', path: 'reports/nvda/weekly.md' }}
        onReturn={vi.fn()}
        fallback={<span>File header</span>}
      />,
    )

    expect(screen.getByText('File header')).toBeTruthy()
    expect(readOfficeInboxDutyExcursion()?.phase).toBe('away')

    act(() => remember('presented', routineDuty()))
    view.rerender(
      <OfficeInboxDutyReturnBar
        surface={{ kind: 'file', workspaceId: 'chat-1', path: 'weekly.md' }}
        onReturn={vi.fn()}
        fallback={<span>File header</span>}
      />,
    )
    expect(screen.getByText('File header')).toBeTruthy()

    view.rerender(
      <OfficeInboxDutyReturnBar
        surface={{ kind: 'file', workspaceId: 'chat-1', path: 'reports/nvda/weekly.md' }}
        onReturn={vi.fn()}
      />,
    )
    expect(screen.getByText('Routine report')).toBeTruthy()
    expect(screen.getByRole('region').getAttribute('data-duty-type')).toBe('routine')

    act(() => remember('returned', routineDuty()))
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('rejects a file from another workspace even when its full path matches', () => {
    remember('presented', routineDuty())
    render(
      <OfficeInboxDutyReturnBar
        surface={{ kind: 'file', workspaceId: 'other-workspace', path: 'reports/nvda/weekly.md' }}
        onReturn={vi.fn()}
        fallback={<span>Other file</span>}
      />,
    )

    expect(screen.getByText('Other file')).toBeTruthy()
    expect(screen.queryByRole('region')).toBeNull()
  })
})
