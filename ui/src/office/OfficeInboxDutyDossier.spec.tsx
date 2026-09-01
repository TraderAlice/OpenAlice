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
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
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

  it('shows routine facts and keeps the summary actions focused on reviewing the report first', () => {
    const current = routineDuty()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={4}
        sourceStatus="ready"
        followUpSourceStatus="ready"
        issueSourceStatus="ready"
        onOpenInbox={vi.fn()}
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
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
      'Review the routine report first, then decide whether it changes today’s work. Opening it or leaving it for later keeps it in patrol.',
    )).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Later' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open report' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Decide next step' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stamp reviewed' })).toBeNull()
  })

  it('carries a routine report from the decision menu without marking it reviewed', async () => {
    const current = routineDuty()
    const onCarry = vi.fn().mockResolvedValue('acknowledged')
    const onCarried = vi.fn()
    const onConfirm = vi.fn()
    const onClose = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={4}
        sourceStatus="ready"
        followUpSourceStatus="ready"
        issueSourceStatus="ready"
        onOpenInbox={vi.fn()}
        onCarry={onCarry}
        onCarried={onCarried}
        onConfirm={onConfirm}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={onClose}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Decide next step' }))

    const carry = screen.getByRole('button', { name: 'Carry to decision desk' })
    expect(document.activeElement).toBe(carry)
    expect(screen.getByRole('heading', { name: 'Step 3 · Decision' })).toBeTruthy()
    expect(screen.getByText(
      'Carry this report to the decision desk when it needs deeper work, or mark it reviewed when it changes nothing.',
    )).toBeTruthy()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Decide next step' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Step 2 · Confirm' }))
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Decide next step' }))
    await userEvent.click(screen.getByRole('button', { name: 'Carry to decision desk' }))
    await waitFor(() => expect(onCarry).toHaveBeenCalledTimes(1))
    expect(onCarried).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()

    // Successful handoff leaves lifecycle ownership to the caller.
    expect(onClose).not.toHaveBeenCalled()
  })

  it('backs out of the decision menu before Escape closes the report', async () => {
    const current = routineDuty()
    const onClose = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={4}
        sourceStatus="ready"
        followUpSourceStatus="ready"
        issueSourceStatus="ready"
        onOpenInbox={vi.fn()}
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
        onConfirm={vi.fn()}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={onClose}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Decide next step' }))
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy()

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('marks a routine report reviewed only after choosing no change', async () => {
    const current = routineDuty()
    const onCarry = vi.fn()
    const onConfirm = vi.fn().mockResolvedValue('acknowledged')
    const onConfirmed = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={4}
        sourceStatus="ready"
        followUpSourceStatus="ready"
        issueSourceStatus="ready"
        onOpenInbox={vi.fn()}
        onCarry={onCarry}
        onCarried={vi.fn()}
        onConfirm={onConfirm}
        onConfirmed={onConfirmed}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(onConfirm).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Decide next step' }))
    expect(onConfirm).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', {
      name: 'No change · Mark reviewed',
    }))

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
    expect(onConfirmed).toHaveBeenCalledTimes(1)
    expect(onCarry).not.toHaveBeenCalled()
  })

  it('keeps a failed carry in patrol and allows an idempotent retry', async () => {
    const current = routineDuty()
    const onCarry = vi.fn()
      .mockRejectedValueOnce(new Error('temporary handoff failure'))
      .mockResolvedValueOnce('acknowledged')
    const onCarried = vi.fn()
    const onConfirm = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={4}
        sourceStatus="ready"
        followUpSourceStatus="ready"
        issueSourceStatus="ready"
        onOpenInbox={vi.fn()}
        onCarry={onCarry}
        onCarried={onCarried}
        onConfirm={onConfirm}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Decide next step' }))
    await userEvent.click(screen.getByRole('button', { name: 'Carry to decision desk' }))

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The decision handoff or exact Inbox receipt did not finish. If the report is already filed, retrying will finish the receipt without creating a duplicate.',
    )
    expect(screen.getByRole('button', { name: 'Carry to decision desk' }).hasAttribute('disabled'))
      .toBe(false)
    expect(onCarried).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Carry to decision desk' }))
    await waitFor(() => expect(onCarry).toHaveBeenCalledTimes(2))
    expect(onCarried).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('finishes a saved carry idempotently and cannot switch it to no change', async () => {
    const current = routineDuty()
    const latestWithoutIssue = {
      ...current,
      delivery: { ...current.delivery, declaredIssue: undefined },
    }
    const onCarry = vi.fn().mockResolvedValue('acknowledged')
    const onCarried = vi.fn()
    const onConfirm = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={latestWithoutIssue}
        currentBacklogCount={4}
        sourceStatus="ready"
        followUpSourceStatus="ready"
        issueSourceStatus="ready"
        carrySaved
        onOpenInbox={vi.fn()}
        onCarry={onCarry}
        onCarried={onCarried}
        onConfirm={onConfirm}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('status').textContent).toContain('Already filed at the decision desk')
    expect(screen.getByRole('region', { name: 'Routine report details' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Finish filing · Mark reviewed' }))
    expect(screen.getByText(/cannot switch to “No change.”/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'No change · Mark reviewed' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Finish filing · Mark reviewed' }))
    await waitFor(() => expect(onCarry).toHaveBeenCalledTimes(1))
    expect(onCarried).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('announces a persisted carry when another tab already wrote the Inbox receipt', async () => {
    const current = routineDuty()
    const onCarried = vi.fn()
    const onContinue = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={4}
        sourceStatus="ready"
        followUpSourceStatus="ready"
        issueSourceStatus="ready"
        onOpenInbox={vi.fn()}
        onCarry={vi.fn().mockResolvedValue('already-resolved')}
        onCarried={onCarried}
        onConfirm={vi.fn()}
        onConfirmed={vi.fn()}
        onContinue={onContinue}
        onClose={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Decide next step' }))
    await userEvent.click(screen.getByRole('button', { name: 'Carry to decision desk' }))

    await waitFor(() => expect(onCarried).toHaveBeenCalledTimes(1))
    expect(onContinue).not.toHaveBeenCalled()
  })

  it('keeps changed routine evidence behind the existing latest-version gate', async () => {
    const current = routineDuty()
    const latest = {
      ...current,
      receipt: { ...current.receipt, fingerprint: 'new-report-fingerprint' },
    }
    const onOpenInbox = vi.fn()
    const onConfirm = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={latest}
        currentBacklogCount={4}
        sourceStatus="ready"
        followUpSourceStatus="ready"
        issueSourceStatus="ready"
        onOpenInbox={onOpenInbox}
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
        onConfirm={onConfirm}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Decide next step' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Carry to decision desk' })).toBeNull()
    const reviewLatest = screen.getAllByRole('button', { name: 'Review latest' })
    await userEvent.click(reviewLatest.at(-1)!)
    expect(onOpenInbox).toHaveBeenCalledWith(latest)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('retires the routine decision when the live row loses its scheduled-task join', () => {
    const current = routineDuty()
    const latest = {
      ...current,
      delivery: {
        ...current.delivery,
        declaredIssue: undefined,
      },
    }

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={latest}
        currentBacklogCount={4}
        sourceStatus="ready"
        followUpSourceStatus="ready"
        issueSourceStatus="ready"
        onOpenInbox={vi.fn()}
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
        onConfirm={vi.fn()}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Decide next step' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Carry to decision desk' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Stamp reviewed' })).toBeTruthy()
  })

  it('keeps no change available while the scheduled-task join is unavailable', async () => {
    const current = routineDuty()
    const latest = {
      ...current,
      delivery: {
        ...current.delivery,
        declaredIssue: undefined,
      },
    }
    const onCarry = vi.fn()
    const onConfirm = vi.fn().mockResolvedValue('acknowledged')

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={latest}
        currentBacklogCount={4}
        sourceStatus="ready"
        followUpSourceStatus="ready"
        issueSourceStatus="error"
        onOpenInbox={vi.fn()}
        onCarry={onCarry}
        onCarried={vi.fn()}
        onConfirm={onConfirm}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText(
      'The scheduled routine is unavailable. Carrying to the decision desk will wait; “No change” remains available.',
    )).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Decide next step' }))
    const carry = screen.getByRole('button', { name: 'Carry to decision desk' })
    const noChange = screen.getByRole('button', { name: 'No change · Mark reviewed' })
    expect(carry.hasAttribute('disabled')).toBe(true)
    expect(noChange.hasAttribute('disabled')).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Step 3 · Decision' }))
    await userEvent.click(carry)
    await userEvent.click(noChange)
    expect(onCarry).not.toHaveBeenCalled()
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('keeps no change available while the scheduled-task join is synchronizing', async () => {
    const current = routineDuty()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={4}
        sourceStatus="ready"
        followUpSourceStatus="ready"
        issueSourceStatus="loading"
        onOpenInbox={vi.fn()}
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue('acknowledged')}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText(
      'Checking the scheduled routine. Carrying to the decision desk will wait; “No change” remains available.',
    )).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Decide next step' }))
    expect(screen.getByRole('button', { name: 'Carry to decision desk' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'No change · Mark reviewed' }).hasAttribute('disabled')).toBe(false)
  })

  it('isolates a decision-desk storage failure from the no-change receipt', async () => {
    const current = routineDuty()
    const onCarry = vi.fn()
    const onConfirm = vi.fn().mockResolvedValue('acknowledged')

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={4}
        sourceStatus="ready"
        followUpSourceStatus="error"
        issueSourceStatus="ready"
        onOpenInbox={vi.fn()}
        onCarry={onCarry}
        onCarried={vi.fn()}
        onConfirm={onConfirm}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText(/Decision desk storage is unavailable/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Decide next step' }))
    const carry = screen.getByRole('button', { name: 'Carry to decision desk' })
    const noChange = screen.getByRole('button', { name: 'No change · Mark reviewed' })
    expect(carry.hasAttribute('disabled')).toBe(true)
    expect(noChange.hasAttribute('disabled')).toBe(false)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Step 3 · Decision' }))

    await userEvent.click(noChange)
    expect(onCarry).not.toHaveBeenCalled()
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  })

  it('finishes a saved carry while the live Issue projection is unavailable', async () => {
    const current = routineDuty()
    const latestWithoutIssue = {
      ...current,
      delivery: { ...current.delivery, declaredIssue: undefined },
    }
    const onCarry = vi.fn().mockResolvedValue('acknowledged')
    const onCarried = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={latestWithoutIssue}
        currentBacklogCount={4}
        sourceStatus="ready"
        followUpSourceStatus="ready"
        issueSourceStatus="error"
        carrySaved
        onOpenInbox={vi.fn()}
        onCarry={onCarry}
        onCarried={onCarried}
        onConfirm={vi.fn()}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Finish filing · Mark reviewed' }))
    const finish = screen.getByRole('button', { name: 'Finish filing · Mark reviewed' })
    expect(finish.hasAttribute('disabled')).toBe(false)
    expect(document.activeElement).toBe(finish)
    expect(screen.queryByRole('button', { name: 'No change · Mark reviewed' })).toBeNull()
    expect(screen.queryByText(
      'The scheduled routine is unavailable. Carrying to the decision desk will wait; “No change” remains available.',
    )).toBeNull()

    await userEvent.click(finish)
    await waitFor(() => expect(onCarry).toHaveBeenCalledTimes(1))
    expect(onCarried).toHaveBeenCalledTimes(1)
  })

  it('blocks both decision actions while the Inbox source is unavailable', async () => {
    const current = routineDuty()
    const onCarry = vi.fn()
    const onConfirm = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={current}
        currentBacklogCount={4}
        sourceStatus="error"
        followUpSourceStatus="ready"
        issueSourceStatus="ready"
        onOpenInbox={vi.fn()}
        onCarry={onCarry}
        onCarried={vi.fn()}
        onConfirm={onConfirm}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Decide next step' }))
    const carry = screen.getByRole('button', { name: 'Carry to decision desk' })
    const noChange = screen.getByRole('button', { name: 'No change · Mark reviewed' })
    expect(carry.hasAttribute('disabled')).toBe(true)
    expect(noChange.hasAttribute('disabled')).toBe(true)
    await userEvent.click(carry)
    await userEvent.click(noChange)
    expect(onCarry).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
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
        followUpSourceStatus="ready"
        issueSourceStatus="ready"
        onOpenInbox={vi.fn()}
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
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
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
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
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
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
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
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

  it('does not contradict an already-read routine receipt when the Issue source is unavailable', () => {
    const current = routineDuty()

    render(
      <OfficeInboxDutyDossier
        duty={current}
        latestDuty={null}
        currentBacklogCount={1}
        sourceStatus="ready"
        followUpSourceStatus="ready"
        issueSourceStatus="error"
        onOpenInbox={vi.fn()}
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
        onConfirm={vi.fn()}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText(
      'This exact Inbox item is already marked read. Continue to the next duty.',
    )).toBeTruthy()
    expect(screen.queryByText(
      'The scheduled routine is unavailable. Carrying to the decision desk will wait; “No change” remains available.',
    )).toBeNull()
    expect(screen.getByRole('button', { name: 'Return to next duty' })).toBeTruthy()
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
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
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
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
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

  it('keeps the dossier locked while Later persists and restores retry after failure', async () => {
    let rejectLater!: (reason?: unknown) => void
    const onLater = vi.fn()
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
        rejectLater = reject
      }))
      .mockResolvedValueOnce(undefined)
    const onClose = vi.fn()

    render(
      <OfficeInboxDutyDossier
        duty={duty()}
        latestDuty={duty()}
        currentBacklogCount={3}
        sourceStatus="ready"
        onOpenInbox={vi.fn()}
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue('acknowledged')}
        onConfirmed={vi.fn()}
        onContinue={vi.fn()}
        onLater={onLater}
        onClose={onClose}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Later' }))

    const dialog = screen.getByRole('dialog', { name: 'NVDA weekly evidence brief' })
    expect(dialog.getAttribute('aria-busy')).toBe('true')
    expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Later' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Open again' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Stamp reviewed' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(onLater).toHaveBeenCalledTimes(1)

    rejectLater(new Error('disk unavailable'))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(
      'The receipt could not be saved. This delivery remains in your shift.',
    ))
    expect(dialog.hasAttribute('aria-busy')).toBe(false)
    expect((screen.getByRole('button', { name: 'Close' }) as HTMLButtonElement).disabled).toBe(false)
    expect((screen.getByRole('button', { name: 'Later' }) as HTMLButtonElement).disabled).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'Later' }))
    await waitFor(() => expect(onLater).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(dialog.hasAttribute('aria-busy')).toBe(false)
  })

  it('traps Tab focus between the first and last available controls', async () => {
    render(
      <OfficeInboxDutyDossier
        duty={duty()}
        latestDuty={duty()}
        currentBacklogCount={3}
        sourceStatus="ready"
        onOpenInbox={vi.fn()}
        onCarry={vi.fn().mockResolvedValue('acknowledged')}
        onCarried={vi.fn()}
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
