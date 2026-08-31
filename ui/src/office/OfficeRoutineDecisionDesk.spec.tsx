// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import {
  OfficeRoutineDecisionDesk,
  type OfficeRoutineDecisionItem,
} from './OfficeRoutineDecisionDesk'

const NOW = Date.UTC(2026, 8, 1, 4)

function decisionItem(
  id: string,
  title: string,
  options: {
    issueAvailable?: boolean
    reportAvailable?: boolean
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
    reportAvailable: options.reportAvailable ?? true,
    issueTitle: `${title} routine`,
    workspaceLabel: `Issue desk ${id.toUpperCase()}`,
    priority: options.priority === undefined ? 'high' : options.priority,
    issueAvailable: options.issueAvailable ?? true,
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
  it('pages exact carried reports and opens the selected Scheduled Issue', async () => {
    const first = decisionItem('a', 'Asia close review')
    const second = decisionItem('b', 'Weekly cross-asset review', { priority: 'medium' })
    const onOpenReport = vi.fn()
    const onOpenIssue = vi.fn()
    const onClose = vi.fn()
    render(
      <OfficeRoutineDecisionDesk
        items={[first, second]}
        sourceStatus="ready"
        onOpenReport={onOpenReport}
        onOpenIssue={onOpenIssue}
        onResolve={vi.fn()}
        onClose={onClose}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: /Resolve carried follow-up/ })
    const heading = screen.getByRole('heading', { name: /Resolve carried follow-up/ })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByText('Follow-up 1 / 2')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Asia close review' })).toBeTruthy()
    expect(screen.getByText('Evidence delivered for Asia close review.')).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Scheduled Issue' }).textContent)
      .toContain('Asia close review routine')
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
    expect(document.activeElement).toBe(screen.getByRole('button', {
      name: 'Decision made · Remove from desk',
    }))

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps a failed resolution on the desk and advances after a successful retry', async () => {
    const first = decisionItem('a', 'Asia close review')
    const second = decisionItem('b', 'Weekly cross-asset review')
    const onResolve = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    render(
      <OfficeRoutineDecisionDesk
        items={[first, second]}
        sourceStatus="ready"
        onOpenReport={vi.fn()}
        onOpenIssue={vi.fn()}
        onResolve={onResolve}
        onClose={vi.fn()}
      />,
    )

    await userEvent.click(screen.getByRole('button', {
      name: 'Decision made · Remove from desk',
    }))
    expect((await screen.findByRole('alert')).textContent).toContain(
      'The item could not be removed from the decision desk. Retrying is safe.',
    )
    expect(screen.getByRole('heading', { name: 'Asia close review' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', {
      name: 'Decision made · Remove from desk',
    }))
    await waitFor(() => {
      expect(onResolve).toHaveBeenNthCalledWith(2, first)
      expect(screen.getByRole('heading', { name: 'Weekly cross-asset review' })).toBeTruthy()
      expect(screen.getByRole('dialog').getAttribute('aria-busy')).toBe('false')
    })
  })

  it('fails closed for an unavailable Issue and distinguishes empty source states', () => {
    const unavailable = decisionItem('gone', 'Retired routine', {
      issueAvailable: false,
      reportAvailable: false,
      priority: null,
    })
    const view = render(
      <OfficeRoutineDecisionDesk
        items={[unavailable]}
        sourceStatus="error"
        onOpenReport={vi.fn()}
        onOpenIssue={vi.fn()}
        onResolve={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Unavailable')).toBeTruthy()
    expect(screen.getByText('Decision desk signal unavailable.')).toBeTruthy()
    expect(screen.getByText(/exact Scheduled Issue is no longer available/)).toBeTruthy()
    expect(screen.getByText(/exact Inbox report is not available/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open exact report' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Open exact Issue' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', {
      name: 'Decision made · Remove from desk',
    }).hasAttribute('disabled')).toBe(false)

    view.rerender(
      <OfficeRoutineDecisionDesk
        items={[]}
        sourceStatus="error"
        onOpenReport={vi.fn()}
        onOpenIssue={vi.fn()}
        onResolve={vi.fn()}
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
        onResolve={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    expect(screen.getByRole('status').textContent).toContain('Decision desk clear')
    expect(screen.getByRole('status').textContent).toContain(
      'No carried routine reports are waiting for a decision.',
    )
  })
})
