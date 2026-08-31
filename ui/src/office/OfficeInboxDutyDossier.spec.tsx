// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import {
  inboxUnreadDutyRegistration,
  type OfficeInboxDutyCandidate,
} from './duty-registry'
import { OfficeInboxDutyDossier } from './OfficeInboxDutyDossier'

const NOW = Date.UTC(2026, 7, 31, 12)

function duty(): OfficeInboxDutyCandidate {
  const candidate = inboxUnreadDutyRegistration([{
    title: 'NVDA weekly evidence brief',
    excerpt: 'Durable delivery for the semiconductor duty desk.',
    entry: {
      id: 'inbox-42',
      ts: NOW - 3_600_000,
      workspaceId: 'ws-semis',
      workspaceLabel: 'Semis desk',
      docs: [
        { path: 'reports/alpha/nvda-weekly-evidence.md', revision: 'sha256:abcdef123456' },
        { path: 'reports/alpha/risk-register.csv', revision: 'rev-risk-123456' },
        { path: 'reports/alpha/position-notes.txt' },
        { path: 'reports/alpha/source-map.json', revision: 'rev-map-123456' },
        { path: 'reports/alpha/appendix.pdf' },
        { path: 'reports/alpha/raw-observations.parquet' },
      ],
    },
  }], 'ready').candidates[0] as OfficeInboxDutyCandidate

  return { ...candidate, count: 3 }
}

function routineDuty(input: {
  nextDueAtMs?: number | null
  olderUnreadCount?: number
  priority?: 'urgent' | 'high' | 'medium' | 'low' | 'none'
} = {}): OfficeInboxDutyCandidate {
  const candidate = duty()
  const olderUnreadCount = input.olderUnreadCount ?? 2
  return {
    ...candidate,
    delivery: {
      ...candidate.delivery,
      declaredIssue: {
        workspaceId: 'ws-semis',
        issueId: 'weekly-semis-review',
        title: 'Weekly semiconductor evidence routine',
        priority: input.priority ?? 'high',
        nextDueAtMs: input.nextDueAtMs === undefined ? NOW + 7_200_000 : input.nextDueAtMs,
        unreadSiblingCount: olderUnreadCount,
        olderUnreadCount,
      },
    },
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('OfficeInboxDutyDossier', () => {
  it('shows the captured delivery facts and bounded document manifest exactly', async () => {
    const current = duty()
    const onOpenInbox = vi.fn()
    const onConfirm = vi.fn().mockResolvedValue('acknowledged')
    const onConfirmed = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={4}
        sourceStatus="ready"
        onOpenInbox={onOpenInbox}
        onConfirm={onConfirm}
        onConfirmed={onConfirmed}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'NVDA weekly evidence brief' })
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Step 2 · Confirm' }))
    expect(dialog.textContent).toContain('4 Inbox item(s) await review')
    expect(dialog.textContent).toContain('Durable delivery for the semiconductor duty desk.')
    expect(screen.queryByRole('region', { name: 'Routine report details' })).toBeNull()

    const facts = dialog.querySelector('.oa-office-cadence__facts')
    expect(facts?.textContent).toContain('WorkspaceSemis desk')
    expect(facts?.textContent).toContain('Received1h ago')
    expect(facts?.textContent).toContain('Documents6')

    expect(screen.getByTitle('reports/alpha/nvda-weekly-evidence.md').textContent)
      .toBe('nvda-weekly-evidence.md')
    expect(screen.getByText('sha256:a')).toBeTruthy()
    expect(screen.getByTitle('reports/alpha/risk-register.csv').textContent)
      .toBe('risk-register.csv')
    expect(screen.getByTitle('reports/alpha/position-notes.txt').textContent)
      .toBe('position-notes.txt')
    expect(screen.getByTitle('reports/alpha/source-map.json').textContent)
      .toBe('source-map.json')
    expect(screen.queryByText('appendix.pdf')).toBeNull()
    expect(screen.queryByText('raw-observations.parquet')).toBeNull()
    expect(screen.getByText('+2 more document(s)')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Open again' }))
    expect(onOpenInbox).toHaveBeenCalledWith(current)
    expect(onConfirm).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Stamp reviewed' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onConfirmed).toHaveBeenCalledTimes(1)
  })

  it('shows exact Scheduled Issue routine facts without broadening the Inbox receipt', () => {
    const current = routineDuty()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={4}
        sourceStatus="ready"
        onOpenInbox={vi.fn()}
        onConfirm={vi.fn()}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const routine = screen.getByRole('region', { name: 'Routine report details' })
    expect(routine.textContent).toContain('Routine report')
    expect(routine.textContent).toContain('Scheduled IssueWeekly semiconductor evidence routine')
    expect(routine.textContent).toContain('PriorityHigh')
    expect(routine.textContent).toContain('Next scheduled runin 2h')
    expect(routine.textContent).toContain('2 earlier unread report versions still await review.')
    expect(screen.getByText(
      'This stamp marks only this exact Inbox item read. It never clears the rest of the queue.',
    )).toBeTruthy()
  })

  it('omits the older-version warning at zero and localizes an unscheduled routine', async () => {
    await i18n.changeLanguage('zh')
    const current = routineDuty({
      nextDueAtMs: null,
      olderUnreadCount: 0,
      priority: 'urgent',
    })

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={1}
        sourceStatus="ready"
        onOpenInbox={vi.fn()}
        onConfirm={vi.fn()}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const routine = screen.getByRole('region', { name: '例行报告详情' })
    expect(routine.textContent).toContain('优先级紧急')
    expect(routine.textContent).toContain('下次计划运行尚未安排下次运行')
    expect(routine.textContent).not.toContain('更早的未读报告版本')
  })

  it('keeps the receipt disabled when the Inbox source is unavailable', async () => {
    const current = duty()
    const onOpenInbox = vi.fn()
    const onConfirm = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={null}
        sourceStatus="error"
        onOpenInbox={onOpenInbox}
        onConfirm={onConfirm}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('status').textContent).toBe(
      'Inbox status is unavailable. This duty cannot be stamped yet.',
    )
    const stamp = screen.getByRole('button', { name: 'Stamp reviewed' })
    expect(stamp.hasAttribute('disabled')).toBe(true)
    await userEvent.click(stamp)
    expect(onConfirm).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Open again' }))
    expect(onOpenInbox).toHaveBeenCalledWith(current)
  })

  it('retains the exact delivery after a receipt mutation fails and allows retry', async () => {
    const current = duty()
    const onConfirm = vi.fn()
      .mockRejectedValueOnce(new Error('temporary write failure'))
      .mockResolvedValueOnce('acknowledged')
    const onConfirmed = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={3}
        sourceStatus="ready"
        onOpenInbox={vi.fn()}
        onConfirm={onConfirm}
        onConfirmed={onConfirmed}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Stamp reviewed' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The receipt could not be saved. This delivery remains in your shift.',
    )
    expect(screen.getByRole('dialog', { name: 'NVDA weekly evidence brief' })).toBeTruthy()
    expect(screen.getByTitle('reports/alpha/nvda-weekly-evidence.md')).toBeTruthy()
    expect(onConfirmed).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Stamp reviewed' }).hasAttribute('disabled'))
      .toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Stamp reviewed' }))
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(2))
    expect(onConfirmed).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a resolved receipt as a continuation instead of confirming it again', async () => {
    const current = duty()
    const onConfirm = vi.fn()
    const onContinue = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={null}
        currentBacklogCount={1}
        sourceStatus="ready"
        onOpenInbox={vi.fn()}
        onConfirm={onConfirm}
        onConfirmed={vi.fn()}
        onContinue={onContinue}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('status').textContent).toBe(
      'This exact Inbox item is already marked read. Continue to the next duty.',
    )
    expect(screen.queryByRole('button', { name: 'Stamp reviewed' })).toBeNull()
    expect(screen.queryByText(/marks only this exact Inbox item read/i)).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Return to next duty' }))
    expect(onContinue).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('continues without a reviewed receipt when the server resolves during stamping', async () => {
    const current = duty()
    const onConfirmed = vi.fn()
    const onContinue = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={3}
        sourceStatus="ready"
        onOpenInbox={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue('already-resolved')}
        onConfirmed={onConfirmed}
        onContinue={onContinue}
        onClose={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Stamp reviewed' }))

    await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(1))
    expect(onConfirmed).not.toHaveBeenCalled()
  })

  it('keeps Later separate from Escape and the window close control', async () => {
    const onClose = vi.fn()
    const onLater = vi.fn()
    const onConfirm = vi.fn()
    const onConfirmed = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={duty()}
        latestDuty={duty()}
        currentBacklogCount={3}
        sourceStatus="ready"
        onOpenInbox={vi.fn()}
        onConfirm={onConfirm}
        onConfirmed={onConfirmed}
        onContinue={vi.fn()}
        onLater={onLater}
        onClose={onClose}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(onLater).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onConfirmed).not.toHaveBeenCalled()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onLater).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onLater).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onConfirmed).not.toHaveBeenCalled()
  })

  it('traps Tab focus between the first and last available controls', async () => {
    render(
      <OfficeInboxDutyDossier
        duty={duty()}
        latestDuty={duty()}
        currentBacklogCount={3}
        sourceStatus="ready"
        onOpenInbox={vi.fn()}
        onConfirm={vi.fn()}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const close = screen.getByRole('button', { name: 'Close' })
    const stamp = screen.getByRole('button', { name: 'Stamp reviewed' })
    close.focus()
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(stamp)
    await userEvent.tab()
    expect(document.activeElement).toBe(close)
  })
})
