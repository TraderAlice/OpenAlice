// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { OfficeShiftCloseout, type OfficeShiftCloseoutProps } from './OfficeShiftCloseout'

const translations: Record<string, string | ((values: Record<string, unknown>) => string)> = {
  'common.close': 'Close',
  'office.dutySyncing': 'Checking duties…',
  'office.dutySignalInterrupted': 'Duty signal unavailable',
  'office.shiftCloseoutClear': 'Shift clear',
  'office.shiftCloseoutReady': 'Shift reviewed',
  'office.shiftCloseoutSourcePendingHint': 'Checking the remaining duty sources before closeout.',
  'office.shiftCloseoutSourceErrorHint': 'Closeout cannot be confirmed while a duty source is unavailable.',
  'office.shiftCloseoutFinishedClear': 'No mandatory work remains in this Office Day.',
  'office.shiftCloseoutFinishedCarry': 'The frozen patrol is complete; remaining work is listed below.',
  'office.shiftCloseoutBoard': 'Shift closeout summary',
  'office.shiftCloseoutPatrolLabel': 'Patrol settled',
  'office.shiftCloseoutPatrolValue': ({ completed, total }) => `${completed}/${total}`,
  'office.shiftCloseoutJudgmentLabel': 'Judgments recorded',
  'office.shiftCloseoutJudgmentValue': ({ count }) => `${count} judgments`,
  'office.shiftCloseoutMaintainCount': ({ count }) => `${count} maintain`,
  'office.shiftCloseoutReviseCount': ({ count }) => `${count} revise`,
  'office.shiftCloseoutEvidenceUnavailableLabel': 'Evidence unavailable',
  'office.shiftCloseoutEvidenceUnavailableHint': 'Unavailable evidence is recorded separately and is not a judgment.',
  'office.shiftCloseoutOutstandingTitle': 'Still to handle',
  'office.shiftCloseoutPendingDecisions': ({ count }) => `${count} still at the decision desk`,
  'office.shiftCloseoutCadenceFollowUps': ({ count }) => `${count} scheduled Issue follow-up`,
  'office.shiftCloseoutBacklog': ({ count }) => `${count} waiting for another patrol`,
  'office.cadenceFollowUpAction': 'Follow up cadence',
  'office.startNextShiftShort': 'Start next shift',
  'office.startingNextShift': 'Starting next shift…',
  'office.startNextShiftFailed': 'Next shift did not start · Try again',
  'office.decisionDeskAction': 'Review decision desk',
  'office.shiftCloseoutFinishForNow': 'Finish for now',
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values: Record<string, unknown> = {}) => {
      const translation = translations[key]
      return typeof translation === 'function' ? translation(values) : translation ?? key
    },
  }),
}))

afterEach(cleanup)

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

function props(overrides: Partial<OfficeShiftCloseoutProps> = {}): OfficeShiftCloseoutProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    state: 'complete',
    sourceStatus: 'ready',
    total: 4,
    completed: 4,
    maintainCount: 2,
    reviseCount: 1,
    evidenceUnavailableCount: 3,
    pendingDecisionCount: 0,
    cadenceFollowUpCount: 0,
    backlogCount: 0,
    canStartNext: false,
    startNextStatus: 'idle',
    onFinish: vi.fn(),
    ...overrides,
  }
}

describe('OfficeShiftCloseout', () => {
  it('keeps unavailable evidence separate from completed judgments', () => {
    render(<OfficeShiftCloseout {...props()} />)

    const dialog = screen.getByRole('dialog', { name: 'Shift reviewed' })
    expect(within(dialog).getByText('4/4')).toBeTruthy()
    expect(within(dialog).getByText('3 judgments')).toBeTruthy()
    expect(within(dialog).getByText('2 maintain')).toBeTruthy()
    expect(within(dialog).getByText('1 revise')).toBeTruthy()
    const unavailable = dialog.querySelector<HTMLElement>(
      '[data-evidence-unavailable-count="3"]',
    )!
    expect(unavailable.textContent).toContain('Evidence unavailable')
    expect(unavailable.textContent).toContain('not a judgment')
    expect(dialog.querySelector('[data-judgment-count="3"]')).toBeTruthy()
  })

  it('makes the Decision Desk primary while keeping next shift and cadence secondary', async () => {
    const user = userEvent.setup()
    const onReviewDecisions = vi.fn()
    const onOpenCadenceFollowUp = vi.fn()
    const onStartNext = vi.fn()
    const onFinish = vi.fn()
    render(<OfficeShiftCloseout {...props({
      pendingDecisionCount: 2,
      cadenceFollowUpCount: 1,
      backlogCount: 3,
      canStartNext: true,
      onReviewDecisions,
      onOpenCadenceFollowUp,
      onStartNext,
      onFinish,
    })} />)

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('2 still at the decision desk')).toBeTruthy()
    expect(within(dialog).getByText('1 scheduled Issue follow-up')).toBeTruthy()
    expect(within(dialog).getByText('3 waiting for another patrol')).toBeTruthy()

    await user.click(within(dialog).getByRole('button', { name: 'Review decision desk' }))
    expect(onReviewDecisions).toHaveBeenCalledOnce()
    expect(onFinish).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Follow up cadence' }))
    expect(onOpenCadenceFollowUp).toHaveBeenCalledOnce()
    await user.click(within(dialog).getByRole('button', { name: 'Start next shift' }))
    expect(onStartNext).toHaveBeenCalledOnce()
  })

  it('falls back to Finish for now when no review action is available', async () => {
    const user = userEvent.setup()
    const onFinish = vi.fn()
    render(<OfficeShiftCloseout {...props({
      pendingDecisionCount: 2,
      onReviewDecisions: undefined,
      onFinish,
    })} />)

    await user.click(screen.getByRole('button', { name: 'Finish for now' }))
    expect(onFinish).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Review decision desk' })).toBeNull()
  })

  it('does not claim clear while the settlement source is loading or unavailable', () => {
    const view = render(<OfficeShiftCloseout {...props({
      state: 'clear',
      sourceStatus: 'loading',
    })} />)

    expect(screen.getByRole('dialog', { name: 'Checking duties…' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Shift clear' })).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Checking the remaining duty sources')

    view.rerender(<OfficeShiftCloseout {...props({
      state: 'clear',
      sourceStatus: 'error',
    })} />)
    expect(screen.getByRole('dialog', { name: 'Duty signal unavailable' })).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('cannot be confirmed')
  })

  it('does not claim clear when independently projected work still remains', () => {
    render(<OfficeShiftCloseout {...props({
      state: 'clear',
      backlogCount: 1,
    })} />)

    expect(screen.getByRole('dialog', { name: 'Shift reviewed' })).toBeTruthy()
    expect(screen.queryByRole('dialog', { name: 'Shift clear' })).toBeNull()
    expect(screen.getByText('1 waiting for another patrol')).toBeTruthy()
  })

  it('keeps header and footer fixed around the only scroll owner and reports next-shift progress', () => {
    render(<OfficeShiftCloseout {...props({
      canStartNext: true,
      backlogCount: 1,
      startNextStatus: 'pending',
      onStartNext: vi.fn(),
    })} />)

    const dialog = screen.getByRole('dialog')
    expect(dialog.className).toContain('grid-rows-[auto_minmax(0,1fr)_auto]')
    expect(dialog.className).toContain('overflow-hidden')
    expect(dialog.querySelector('.oa-office-shift-closeout__header')?.className).toContain('shrink-0')
    expect(dialog.querySelector('.oa-office-shift-closeout__body')?.className).toContain('overflow-y-auto')
    expect(dialog.querySelector('.oa-office-shift-closeout__footer')?.className).toContain('shrink-0')
    const pending = screen.getByRole('button', { name: 'Starting next shift…' })
    expect(pending.hasAttribute('disabled')).toBe(true)
    expect(pending.getAttribute('aria-busy')).toBe('true')
  })

  it('delegates Escape and focus restoration to the shared Dialog primitive', async () => {
    const user = userEvent.setup()

    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open closeout</button>
          <OfficeShiftCloseout
            {...props({
              open,
              onOpenChange: setOpen,
              onFinish: () => setOpen(false),
            })}
          />
        </>
      )
    }

    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open closeout' })
    await user.click(opener)
    expect(screen.getByRole('dialog')).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })
})
