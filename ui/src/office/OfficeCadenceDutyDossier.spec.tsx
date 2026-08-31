// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import {
  officeScheduledIssueFingerprint,
  type OfficeCadenceDutyCandidate,
} from './duty-registry'
import { OfficeCadenceDutyDossier } from './OfficeCadenceDutyDossier'

const { issueDetailMock } = vi.hoisted(() => ({ issueDetailMock: vi.fn() }))
const NOW = Date.UTC(2026, 7, 31, 12)

vi.mock('../hooks/useIssueDetail', () => ({ useIssueDetail: issueDetailMock }))

function duty(
  latestTaskId = 'run-a',
  state: 'failed' | 'blocked' = 'failed',
): OfficeCadenceDutyCandidate {
  const health = {
    state,
    message: state === 'blocked'
      ? 'Assigned Session does not exist. Choose an active Session or @new-each-run.'
      : 'The scheduled report run failed.',
    latestTaskId,
  } as const
  const when = { kind: 'every', every: '1w' } as const
  const lastFiredAtMs = Date.UTC(2026, 7, 31, 11)
  const nextDueAtMs = Date.UTC(2026, 8, 7, 11)
  return {
    id: 'scheduled-issue-health:ws-a:weekly-review',
    registrationId: 'scheduled-issue-health',
    kind: 'cadence',
    count: 1,
    destination: {
      kind: 'issue',
      workspaceId: 'ws-a',
      issueId: 'weekly-review',
      targetId: 'operations',
    },
    receipt: {
      kind: 'evidence',
      subjectKey: '["scheduled-issue","ws-a","weekly-review"]',
      fingerprint: officeScheduledIssueFingerprint(NOW, 'ws-a', {
        id: 'weekly-review',
        assignee: '@new-each-run',
        when,
        automationHealth: health,
        lastFiredAtMs,
        nextDueAtMs,
      }),
      scope: 'session',
    },
    cadence: {
      workspaceId: 'ws-a',
      workspaceTag: 'weekly',
      issueId: 'weekly-review',
      title: 'Review the weekly report cadence',
      priority: 'high',
      assignee: '@new-each-run',
      when,
      health,
      lastFiredAtMs,
      nextDueAtMs,
    },
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  issueDetailMock.mockReturnValue({
    data: {
      issue: {
        id: 'weekly-review',
        title: 'Review the weekly report cadence',
        what: 'Read the weekly evidence.',
        status: 'todo',
        priority: 'high',
        assignee: '@new-each-run',
        when: { kind: 'every', every: '1w' },
        lastFiredAtMs: Date.UTC(2026, 7, 31, 11),
        nextDueAtMs: Date.UTC(2026, 8, 7, 11),
        automationHealth: {
          state: 'failed',
          message: 'The scheduled report run failed.',
          latestTaskId: 'run-a',
        },
      },
      runs: [{
        taskId: 'run-a',
        resumeId: 'resume-a',
        wsId: 'ws-a',
        agent: 'grok',
        prompt: 'Review report',
        status: 'failed',
        startedAt: Date.UTC(2026, 7, 31, 11),
        resumable: true,
        failure: {
          kind: 'runtime_error',
          title: 'Report run failed',
          message: 'The report generator exited before delivery.',
          retryable: true,
        },
      }],
    },
    loading: false,
    error: null,
    mutate: vi.fn(),
  })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('OfficeCadenceDutyDossier', () => {
  it('requires evidence review before exposing the explicit receipt', async () => {
    const onConfirm = vi.fn()
    const onOpenIssue = vi.fn()
    render(
      <OfficeCadenceDutyDossier
        duty={duty()}
        latestDuty={duty()}
        sourceStatus="ready"
        onOpenIssue={onOpenIssue}
        onConfirm={onConfirm}
        onReviewLatest={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    const review = screen.getByRole('button', { name: 'Review evidence' })
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Step 1 · Exception' }))
    expect(screen.queryByRole('button', { name: 'Stamp reviewed for this shift' })).toBeNull()

    await userEvent.click(review)
    const dialog = screen.getByRole('dialog', { name: 'Review the weekly report cadence' })
    const evidenceHeading = screen.getByRole('heading', { name: 'Step 2 · Evidence' })
    expect(document.activeElement).toBe(evidenceHeading)
    expect(dialog.querySelector('#office-cadence-description')).toBeTruthy()
    expect(screen.getByText('Report run failed')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Open full Issue' }))
    expect(onOpenIssue).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Stamp reviewed for this shift' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('keeps keyboard focus inside both dossier steps', async () => {
    render(
      <OfficeCadenceDutyDossier
        duty={duty()}
        latestDuty={duty()}
        sourceStatus="ready"
        onOpenIssue={vi.fn()}
        onConfirm={vi.fn()}
        onReviewLatest={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Review evidence' }))
    const close = screen.getByRole('button', { name: 'Close' })
    const stamp = screen.getByRole('button', { name: 'Stamp reviewed for this shift' })
    close.focus()
    await userEvent.tab({ shift: true })
    expect(document.activeElement).toBe(stamp)
    await userEvent.tab()
    expect(document.activeElement).toBe(close)
  })

  it('keeps a current blocker primary even when an older failed run exists', async () => {
    issueDetailMock.mockReturnValue({
      data: {
        issue: {
          id: 'weekly-review',
          title: 'Review the weekly report cadence',
          what: 'Read the weekly evidence.',
          status: 'todo',
          priority: 'high',
          assignee: '@new-each-run',
          when: { kind: 'every', every: '1w' },
          lastFiredAtMs: Date.UTC(2026, 7, 31, 11),
          nextDueAtMs: Date.UTC(2026, 8, 7, 11),
          automationHealth: {
            state: 'blocked',
            message: 'Assigned Session does not exist. Choose an active Session or @new-each-run.',
            latestTaskId: 'run-a',
          },
        },
        runs: [{
          taskId: 'run-a',
          resumeId: 'resume-a',
          wsId: 'ws-a',
          agent: 'grok',
          prompt: 'Old run',
          status: 'failed',
          startedAt: Date.UTC(2026, 7, 30, 11),
          resumable: true,
          failure: {
            kind: 'launcher_restarted',
            title: 'Launcher restarted',
            message: 'An older run was interrupted.',
            retryable: true,
          },
        }],
      },
      loading: false,
      error: null,
      mutate: vi.fn(),
    })
    const blocked = duty('run-a', 'blocked')
    render(
      <OfficeCadenceDutyDossier
        duty={blocked}
        latestDuty={blocked}
        sourceStatus="ready"
        onOpenIssue={vi.fn()}
        onConfirm={vi.fn()}
        onReviewLatest={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Review evidence' }))
    expect(screen.getByText('Schedule and owner evidence')).toBeTruthy()
    expect(screen.getAllByText('Assigned Session does not exist. Choose an active Session or New Session each run.'))
      .toHaveLength(2)
    expect(screen.queryByText('Launcher restarted')).toBeNull()
    expect(screen.getByText('No affected run')).toBeTruthy()
  })

  it('refuses to stamp captured evidence when exact Issue detail has already changed', async () => {
    issueDetailMock.mockReturnValue({
      data: {
        issue: {
          id: 'weekly-review',
          title: 'Review the weekly report cadence',
          what: 'Read the new weekly evidence.',
          status: 'todo',
          priority: 'high',
          assignee: '@new-each-run',
          when: { kind: 'every', every: '1w' },
          lastFiredAtMs: Date.UTC(2026, 7, 31, 11),
          nextDueAtMs: Date.UTC(2026, 8, 7, 11),
          automationHealth: {
            state: 'failed',
            message: 'The scheduled report run failed.',
            latestTaskId: 'run-b',
          },
        },
        runs: [],
      },
      loading: false,
      error: null,
      mutate: vi.fn(),
    })
    const captured = duty('run-a')
    render(
      <OfficeCadenceDutyDossier
        duty={captured}
        latestDuty={captured}
        sourceStatus="ready"
        onOpenIssue={vi.fn()}
        onConfirm={vi.fn()}
        onReviewLatest={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Review evidence' }))
    expect(screen.getByRole('alert').textContent).toContain('Evidence changed')
    expect(screen.getByRole('button', { name: 'Stamp reviewed for this shift' }).hasAttribute('disabled'))
      .toBe(true)
  })

  it('keeps the receipt disabled while the Issue source is stale', async () => {
    const current = duty()
    render(
      <OfficeCadenceDutyDossier
        duty={current}
        latestDuty={current}
        sourceStatus="error"
        onOpenIssue={vi.fn()}
        onConfirm={vi.fn()}
        onReviewLatest={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Review evidence' }))
    expect(screen.getByText(/shift status remains unknown/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Stamp reviewed for this shift' }).hasAttribute('disabled'))
      .toBe(true)
  })

  it('keeps Later separate from Escape and the window close control', async () => {
    const onClose = vi.fn()
    const onLater = vi.fn()
    render(
      <OfficeCadenceDutyDossier
        duty={duty()}
        latestDuty={duty()}
        sourceStatus="ready"
        onOpenIssue={vi.fn()}
        onConfirm={vi.fn()}
        onReviewLatest={vi.fn()}
        onLater={onLater}
        onClose={onClose}
      />,
    )

    await userEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(onLater).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Review evidence' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('button', { name: 'Review evidence' })).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    expect(onLater).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onLater).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onLater).toHaveBeenCalledTimes(1)
  })

  it('pins captured evidence and refuses to stamp after the live fingerprint changes', async () => {
    const onReviewLatest = vi.fn()
    const latest = duty('run-b')
    render(
      <OfficeCadenceDutyDossier
        duty={duty('run-a')}
        latestDuty={latest}
        sourceStatus="ready"
        onOpenIssue={vi.fn()}
        onConfirm={vi.fn()}
        onReviewLatest={onReviewLatest}
        onClose={vi.fn()}
      />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Review evidence' }))
    expect(screen.getByRole('alert').textContent).toContain('Evidence changed')
    expect(screen.queryByRole('button', { name: 'Stamp reviewed for this shift' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Review latest evidence' }))
    expect(onReviewLatest).toHaveBeenCalledWith(latest)
  })
})
