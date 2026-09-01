// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import {
  classifyOfficeRoutineEvidence,
  OfficeRoutineDecisionDesk,
  type OfficeRoutineDecisionItem,
} from './OfficeRoutineDecisionDesk'

const NOW = Date.UTC(2026, 8, 1, 4)

function decisionItem(
  id: string,
  title: string,
  options: {
    issueState?: OfficeRoutineDecisionItem['issueState']
    reportState?: OfficeRoutineDecisionItem['reportState']
    priority?: OfficeRoutineDecisionItem['priority']
  } = {},
): OfficeRoutineDecisionItem {
  return {
    followUp: {
      inboxEntryId: `inbox-${id}`,
      reportTs: NOW - 3_600_000,
      issueWorkspaceId: `workspace-${id}`,
      issueId: `issue-${id}`,
      createdAt: NOW - 60_000,
    },
    reportTitle: title,
    reportExcerpt: `Evidence delivered for ${title}.`,
    reportWorkspaceLabel: `Report desk ${id.toUpperCase()}`,
    reportState: options.reportState ?? 'available',
    issueTitle: `${title} routine`,
    workspaceLabel: `Issue desk ${id.toUpperCase()}`,
    priority: options.priority === undefined ? 'high' : options.priority,
    issueState: options.issueState ?? 'available',
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OfficeRoutineDecisionDesk', () => {
  it.each([
    ['ready', true, 'available'],
    ['ready', false, 'missing'],
    ['loading', true, 'unknown'],
    ['loading', false, 'unknown'],
    ['error', true, 'unknown'],
    ['error', false, 'unknown'],
  ] as const)(
    'classifies %s source evidence without confusing uncertainty with absence',
    (sourceStatus, exactEvidenceAvailable, expected) => {
      expect(classifyOfficeRoutineEvidence(sourceStatus, exactEvidenceAvailable)).toBe(expected)
    },
  )

  it('pages exact carried reports, opens evidence, and keeps focus trapped', async () => {
    const first = decisionItem('a', 'Asia close review')
    const second = decisionItem('b', 'Weekly cross-asset review', { priority: 'medium' })
    const onOpenReport = vi.fn()
    const onOpenIssue = vi.fn()
    const onDecide = vi.fn()
    const onClose = vi.fn()
    render(
      <OfficeRoutineDecisionDesk
        items={[first, second]}
        sourceStatus="ready"
        onOpenReport={onOpenReport}
        onOpenIssue={onOpenIssue}
        onDecide={onDecide}
        onClose={onClose}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: /Decide carried follow-up/ })
    const heading = screen.getByRole('heading', { name: /Decide carried follow-up/ })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByText('Follow-up 1 / 2')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Asia close review' })).toBeTruthy()
    expect(screen.getByText('Evidence delivered for Asia close review.')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Scheduled Issue' }).textContent)
      .toContain('Asia close review routine')
    expect(screen.getByRole('region', { name: 'Record your judgment' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Maintain current plan' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Adjust watch / plan' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true)

    const panel = dialog.querySelector<HTMLElement>('.oa-office-cadence__panel')!
    panel.scrollTop = 240
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(panel.scrollTop).toBe(0)
    expect(screen.getByText('Follow-up 2 / 2')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Weekly cross-asset review' })).toBeTruthy()
    expect(document.activeElement).toBe(heading)
    expect(screen.getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Open exact report' }))
    expect(onOpenReport).toHaveBeenCalledWith(second)
    await userEvent.click(screen.getByRole('button', { name: 'Open exact Issue' }))
    expect(onOpenIssue).toHaveBeenCalledWith(second)

    const close = screen.getByRole('button', { name: 'Close' })
    close.focus()
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Previous' }))

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onDecide).not.toHaveBeenCalled()
  })

  it('records an explicit maintain-plan judgment and advances to the next item', async () => {
    const first = decisionItem('a', 'Asia close review')
    const second = decisionItem('b', 'Weekly cross-asset review')
    const onDecide = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(
      <OfficeRoutineDecisionDesk
        items={[first, second]}
        sourceStatus="ready"
        onOpenReport={vi.fn()}
        onOpenIssue={vi.fn()}
        onDecide={onDecide}
        onClose={onClose}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Maintain current plan' }))
    await waitFor(() => {
      expect(onDecide).toHaveBeenCalledWith(first, { outcome: 'maintain-plan' })
      expect(screen.getByRole('heading', { name: 'Weekly cross-asset review' })).toBeTruthy()
      expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('false')
    })

    await userEvent.click(screen.getByRole('button', { name: 'Keep for later' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onDecide).toHaveBeenCalledTimes(1)
  })

  it('requires a trimmed 1–280 character note before recording a revised plan', async () => {
    const item = decisionItem('a', 'Asia close review')
    const onDecide = vi.fn().mockResolvedValue(undefined)
    render(
      <OfficeRoutineDecisionDesk
        items={[item]}
        sourceStatus="ready"
        onOpenReport={vi.fn()}
        onOpenIssue={vi.fn()}
        onDecide={onDecide}
        onClose={vi.fn()}
      />,
    )

    const revise = screen.getByRole('button', { name: 'Adjust watch / plan' })
    await userEvent.click(revise)
    const note = screen.getByRole('textbox', { name: 'What changes?' })
    const save = screen.getByRole('button', { name: 'Save revised plan' })
    expect(document.activeElement).toBe(note)
    expect(save.hasAttribute('disabled')).toBe(true)

    await userEvent.type(note, '   ')
    expect(note.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByText('3 / 280')).toBeTruthy()
    expect(save.hasAttribute('disabled')).toBe(true)

    await userEvent.clear(note)
    fireEvent.change(note, { target: { value: 'x'.repeat(281) } })
    expect(screen.getByText('281 / 280')).toBeTruthy()
    expect(save.hasAttribute('disabled')).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Back to choices' }))
    await userEvent.click(screen.getByRole('button', { name: 'Adjust watch / plan' }))
    const validNote = screen.getByRole('textbox', { name: 'What changes?' })
    await userEvent.type(validNote, '  Raise the volatility alert before the next run.  ')
    const validSave = screen.getByRole('button', { name: 'Save revised plan' })
    expect(validSave.hasAttribute('disabled')).toBe(false)
    await userEvent.click(validSave)
    await waitFor(() => {
      expect(onDecide).toHaveBeenCalledWith(item, {
        outcome: 'revise-plan',
        note: 'Raise the volatility alert before the next run.',
      })
    })
  })

  it('keeps a failed revised judgment and its note available for an exact retry', async () => {
    const first = decisionItem('a', 'Asia close review')
    const second = decisionItem('b', 'Weekly cross-asset review')
    const onDecide = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    render(
      <OfficeRoutineDecisionDesk
        items={[first, second]}
        sourceStatus="ready"
        onOpenReport={vi.fn()}
        onOpenIssue={vi.fn()}
        onDecide={onDecide}
        onClose={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Adjust watch / plan' }))
    const note = screen.getByRole('textbox', { name: 'What changes?' })
    await userEvent.type(note, 'Tighten the downside watch level.')
    await userEvent.click(screen.getByRole('button', { name: 'Save revised plan' }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The decision was not saved. This follow-up remains on the desk',
    )
    expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'What changes?' }).value)
      .toBe('Tighten the downside watch level.')
    expect(screen.getByRole('heading', { name: 'Asia close review' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Save revised plan' }))
    await waitFor(() => {
      expect(onDecide).toHaveBeenNthCalledWith(2, first, {
        outcome: 'revise-plan',
        note: 'Tighten the downside watch level.',
      })
      expect(screen.getByRole('heading', { name: 'Weekly cross-asset review' })).toBeTruthy()
      expect(screen.queryByRole('textbox', { name: 'What changes?' })).toBeNull()
    })
  })

  it('closes from a revision draft without deciding and restores focus when the draft is cancelled', async () => {
    const onClose = vi.fn()
    const onDecide = vi.fn()
    render(
      <OfficeRoutineDecisionDesk
        items={[decisionItem('a', 'Asia close review')]}
        sourceStatus="ready"
        onOpenReport={vi.fn()}
        onOpenIssue={vi.fn()}
        onDecide={onDecide}
        onClose={onClose}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Adjust watch / plan' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'What changes?' }), 'Draft')
    await userEvent.click(screen.getByRole('button', { name: 'Back to choices' }))
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Adjust watch / plan' }))
    })
    expect(screen.queryByRole('textbox', { name: 'What changes?' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Adjust watch / plan' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onDecide).not.toHaveBeenCalled()
  })

  it('fails closed to evidence-unavailable and distinguishes empty source states', async () => {
    const unavailable = decisionItem('gone', 'Retired routine', {
      issueState: 'missing',
      reportState: 'missing',
      priority: null,
    })
    const onDecide = vi.fn().mockResolvedValue(undefined)
    const view = render(
      <OfficeRoutineDecisionDesk
        items={[unavailable]}
        sourceStatus="error"
        onOpenReport={vi.fn()}
        onOpenIssue={vi.fn()}
        onDecide={onDecide}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Unavailable')).toBeTruthy()
    expect(screen.getByText('Decision desk signal unavailable.')).toBeTruthy()
    expect(screen.getByText(/exact Scheduled Issue is no longer available/)).toBeTruthy()
    expect(screen.getByText(/exact Inbox report is not available/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open exact report' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Open exact Issue' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('button', { name: 'Maintain current plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adjust watch / plan' })).toBeNull()
    expect(screen.getByText(/does not count as a judgment/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Record unavailable · Remove' }))
    expect(onDecide).toHaveBeenCalledWith(unavailable, { outcome: 'evidence-unavailable' })

    view.rerender(
      <OfficeRoutineDecisionDesk
        items={[]}
        sourceStatus="error"
        onOpenReport={vi.fn()}
        onOpenIssue={vi.fn()}
        onDecide={onDecide}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('Decision desk signal unavailable.')
    expect(screen.getByRole('status').textContent).toContain(
      'Saved follow-ups will return when the desk can refresh.',
    )

    view.rerender(
      <OfficeRoutineDecisionDesk
        items={[]}
        sourceStatus="ready"
        onOpenReport={vi.fn()}
        onOpenIssue={vi.fn()}
        onDecide={onDecide}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('Decision desk clear')
    expect(screen.getByRole('status').textContent).toContain(
      'No carried routine reports are waiting for a decision.',
    )
  })

  it('keeps loading or failed evidence distinct from confirmed missing evidence', async () => {
    const unknown = decisionItem('pending', 'Pending source verification', {
      issueState: 'unknown',
      reportState: 'available',
    })
    const onDecide = vi.fn()
    render(
      <OfficeRoutineDecisionDesk
        items={[unknown]}
        sourceStatus="ready"
        onOpenReport={vi.fn()}
        onOpenIssue={vi.fn()}
        onDecide={onDecide}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByRole('region', { name: 'Evidence check incomplete' })).toBeTruthy()
    expect(screen.getByText(/not proof that evidence is missing/)).toBeTruthy()
    expect(screen.getByText(/No judgment or unavailable-evidence receipt/)).toBeTruthy()
    expect(screen.getByText(/Scheduled Issue has not been verified/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Maintain current plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Adjust watch / plan' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Record unavailable · Remove' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open exact report' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('button', { name: 'Open exact Issue' }).hasAttribute('disabled')).toBe(true)
    expect(onDecide).not.toHaveBeenCalled()
  })
})
