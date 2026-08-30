// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { OfficeFloorEmployee } from '../api/office'
import { i18n } from '../i18n'
import { OfficeInspectRail } from './OfficeInspectRail'

const employee: OfficeFloorEmployee = {
  resumeId: 'demo-resume-chat',
  agent: 'codex',
  name: 'Desk mate',
  awake: true,
  mood: 'working',
  bubble: { kind: 'text', text: 'Polishing the Office floor.' },
  lastSeq: 7,
  lastInteractionAt: Date.now(),
  drawers: [{
    id: 'desk-note',
    kind: 'report',
    action: 'open-file',
    at: Date.now(),
    label: 'desk-note.md',
    path: 'docs/desk-note.md',
  }, {
    id: 'handoff-note',
    kind: 'report',
    action: 'open-file',
    at: Date.now() - 1,
    label: 'handoff.md',
    path: 'docs/handoff.md',
  }],
}

afterEach(cleanup)

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

describe('OfficeInspectRail', () => {
  it('presents the employee as an RPG dialogue with sprite and inventory actions', async () => {
    const onOpen = vi.fn()
    const onOpenDrawer = vi.fn()
    const onClose = vi.fn()
    const { container } = render(
      <OfficeInspectRail
        employee={employee}
        roomName="Chat"
        onOpen={onOpen}
        onOpenDrawer={onOpenDrawer}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('Polishing the Office floor.')).toBeTruthy()
    expect(screen.getByText('Codex Mechanic')).toBeTruthy()
    expect(screen.getByText('codex · Desk mate')).toBeTruthy()
    expect(container.textContent).not.toContain('demo-resume-chat')
    expect(container.querySelector<HTMLImageElement>('.oa-office-inspect__portrait .oa-office-coworker img')?.src)
      .toContain('/office/coworkers/codex-')
    expect(screen.getByRole('button', { name: 'Close' }).querySelector('.oa-office-window__close-mark'))
      .toBeTruthy()
    const openSession = screen.getByRole('button', { name: 'Open session' })
    expect(openSession.querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/session-portal-v2.png')
    const drawerExit = screen.getByRole('button', { name: /Open desk-note\.md, Report, .* in Workspace/ })
    const handoffExit = screen.getByRole('button', { name: /Open handoff\.md, Report, .* in Workspace/ })
    expect(drawerExit.querySelector('img')?.getAttribute('src')).toBe('/office/hud/drawer-record-v2.png')
    expect(drawerExit.querySelector('.oa-office-drawer__destination img')?.getAttribute('src'))
      .toBe('/office/hud/session-portal-v2.png')
    expect(drawerExit.querySelector('.oa-office-drawer__destination')?.textContent).toBe('Open')
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getByText('working').getAttribute('data-power')).toBe('awake')
    expect(screen.getByTestId('office-inspect').dataset.awake).toBe('true')

    expect(document.activeElement).toBe(openSession)
    await userEvent.keyboard('{Enter}')
    expect(onOpen).toHaveBeenCalledTimes(1)
    await userEvent.keyboard(' ')
    expect(onOpen).toHaveBeenCalledTimes(2)
    onOpen.mockClear()
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(drawerExit)
    await userEvent.keyboard('{Enter}')
    expect(onOpenDrawer).toHaveBeenLastCalledWith(employee.drawers[0])
    await userEvent.keyboard(' ')
    expect(onOpenDrawer).toHaveBeenCalledTimes(2)
    onOpenDrawer.mockClear()
    vi.spyOn(drawerExit, 'getBoundingClientRect').mockReturnValue({
      left: 0, right: 120, top: 0, bottom: 38,
    } as DOMRect)
    vi.spyOn(handoffExit, 'getBoundingClientRect').mockReturnValue({
      left: 128, right: 248, top: 0, bottom: 38,
    } as DOMRect)
    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(handoffExit)
    await userEvent.keyboard('{Home}')
    expect(document.activeElement).toBe(drawerExit)
    await userEvent.keyboard('{End}')
    expect(document.activeElement).toBe(handoffExit)
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    await userEvent.keyboard('{Enter}')
    expect(onClose).toHaveBeenCalledOnce()
    onClose.mockClear()
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(openSession)

    await userEvent.click(openSession)
    expect(onOpen).toHaveBeenCalledOnce()
    await userEvent.click(drawerExit)
    expect(onOpenDrawer).toHaveBeenCalledWith(employee.drawers[0])
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('gives a quiet coworker in-world dialogue instead of repeating machine facts', () => {
    const { container } = render(
      <OfficeInspectRail
        employee={{
          ...employee,
          awake: false,
          mood: 'idle',
          bubble: null,
          surface: 'headless',
          latestResult: {
            text: '## Result\n**Filed** the [finished report](/tracked/report.md).',
            at: Date.now() - 60_000,
          },
        }}
        roomName="Prediction"
        onOpen={vi.fn()}
        onOpenDrawer={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('Off duty. Ready when the floor wakes.')).toBeTruthy()
    expect(screen.getByText('Latest result')).toBeTruthy()
    expect(screen.getByText('Result Filed the finished report.')).toBeTruthy()
    expect(container.textContent).not.toContain('**')
    expect(container.textContent).not.toContain('/tracked/report.md')
    expect(container.querySelector('blockquote')?.textContent).not.toContain('idle · headless')
    expect(screen.queryByText('idle')).toBeNull()
    expect(screen.getByText('asleep').getAttribute('data-power')).toBe('asleep')
    expect(screen.getByTestId('office-inspect').dataset.awake).toBe('false')
    expect(screen.getByText('Run mode')).toBeTruthy()
    expect(screen.getByText('Background run')).toBeTruthy()
    expect(container.textContent).not.toContain('headless')
  })

  it('keeps a stopped failure actionable while preserving asleep power state', async () => {
    const onReviewActivity = vi.fn()
    render(
      <OfficeInspectRail
        employee={{ ...employee, awake: false, mood: 'failed', bubble: null, surface: 'headless' }}
        roomName="Chat"
        onOpen={vi.fn()}
        onReviewActivity={onReviewActivity}
        onOpenDrawer={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect(screen.getByText('The last run needs attention.')).toBeTruthy()
    const status = screen.getByText('failed')
    expect(status.getAttribute('data-mood')).toBe('failed')
    expect(status.getAttribute('data-power')).toBe('asleep')
    expect(screen.getByTestId('office-inspect').dataset.awake).toBe('false')
    const reviewActivity = screen.getByRole('button', { name: 'Review activity' })
    expect(reviewActivity.querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/occupancy-log-v2.png')
    expect(document.activeElement).toBe(reviewActivity)
    await userEvent.keyboard('{Enter}')
    await userEvent.keyboard(' ')
    expect(onReviewActivity).toHaveBeenCalledTimes(2)
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open session' }))
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    expect(document.activeElement).toBe(reviewActivity)
  })

  it('collapses a long Session title without moving the primary commands', async () => {
    const longTitle = 'Research question: Is NVDA in a buyable technical setup right now, and does the broader semiconductor sector support it?'
    const onClose = vi.fn()
    const { container } = render(
      <OfficeInspectRail
        employee={{ ...employee, title: longTitle, bubble: null }}
        roomName="Auto Quant"
        onOpen={vi.fn()}
        onOpenDrawer={vi.fn()}
        onClose={onClose}
      />,
    )

    const title = screen.getByText(longTitle)
    const toggle = screen.getByRole('button', { name: 'Show full title' })
    expect(screen.getByText('Assignment')).toBeTruthy()
    expect(screen.getByRole('dialog').getAttribute('aria-label')).toMatch(/^Codex/)
    expect(title.getAttribute('data-expanded')).toBeNull()
    expect(container.querySelector('.oa-office-inspect')?.lastElementChild)
      .toBe(container.querySelector('.oa-office-inspect__actions'))
    expect(screen.getByRole('button', { name: 'Close' }).querySelector('.oa-office-window__close-mark'))
      .toBeTruthy()
    screen.getByRole('button', { name: 'Close' }).focus()
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(toggle)
    await userEvent.keyboard('{Enter}')
    expect(title.dataset.expanded).toBe('true')
    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Show full title' })).toBeTruthy()
    expect(document.activeElement).toBe(toggle)
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
    await userEvent.keyboard(' ')
    expect(title.dataset.expanded).toBe('true')
    await userEvent.keyboard(' ')
    expect(title.dataset.expanded).toBeUndefined()
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open session' }))
    const profile = container.querySelector<HTMLElement>('.oa-office-inspect__profile')
    expect(profile).toBeTruthy()
    if (profile) profile.scrollTop = 80
    await userEvent.click(toggle)
    expect(title.dataset.expanded).toBe('true')
    expect(profile?.scrollTop).toBe(0)
    expect(screen.getByRole('button', { name: 'Collapse title' })).toBeTruthy()
  })

  it('uses the generated roster-return control when opened from the team list', async () => {
    const onClose = vi.fn()
    render(
      <OfficeInspectRail
        employee={employee}
        roomName="Chat"
        onOpen={vi.fn()}
        onOpenDrawer={vi.fn()}
        onClose={onClose}
        returnToRoster
      />,
    )

    const back = screen.getByRole('button', { name: 'Back to team roster' })
    expect(back.querySelector('img')?.getAttribute('src')).toBe('/office/hud/window-back-v2.png')
    expect(document.activeElement).toBe(back)
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open session' }))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
