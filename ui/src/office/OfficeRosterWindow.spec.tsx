// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { OfficeRosterWindow } from './OfficeRosterWindow'

afterEach(cleanup)

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

describe('OfficeRosterWindow', () => {
  it('lists every employee and opens the selected Agent file', async () => {
    const employees = Array.from({ length: 6 }, (_, index) => ({
      resumeId: `resume-${index}`,
      agent: index === 5 ? 'claude' : 'codex',
      name: index === 5 ? 'c1' : `x${index + 1}`,
      title: `Research session ${index + 1}`,
      awake: index < 2,
      mood: index < 2
        ? 'working' as const
        : index === 2
          ? 'failed' as const
          : index === 3
            ? 'waiting' as const
            : 'idle' as const,
      bubble: null,
      lastSeq: 1,
      lastInteractionAt: 1,
      drawers: [],
    }))
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const { container } = render(
      <OfficeRosterWindow
        group={{
          workspace: { id: 'chat-1', tag: 'chat', harness: 'chat' },
          lastInteractionAt: 1,
          sleeping: false,
          employees,
        }}
        roomName="Semis and supply chain"
        focusResumeId="resume-5"
        onSelect={onSelect}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('6 team members')).toBeTruthy()
    expect(screen.getByText('Arrows choose · PgUp/PgDn page · Home/End jump · Enter inspect').getAttribute('data-input'))
      .toBe('keyboard')
    expect(screen.getByText('Choose a teammate to inspect their Agent file.').getAttribute('data-input')).toBe('touch')
    expect(screen.getAllByRole('button')).toHaveLength(7)
    const coworkerImages = screen.getByTestId('office-roster-window')
      .querySelectorAll<HTMLImageElement>('.oa-office-coworker img')
    expect(coworkerImages).toHaveLength(6)
    expect(coworkerImages[0]?.getAttribute('src')).toContain('/office/coworkers/codex-')
    expect(coworkerImages[5]?.getAttribute('src')).toContain('/office/coworkers/claude-')
    expect(Array.from(coworkerImages).some((image) => image.src.includes('alice-maid'))).toBe(false)
    const codexCast = Array.from(
      screen.getByTestId('office-roster-window').querySelectorAll<HTMLElement>('.oa-office-coworker'),
    ).slice(0, 5).map((coworker) => coworker.dataset.agent)
    expect(new Set(codexCast).size).toBe(3)
    expect(screen.getByRole('button', { name: 'Close' }).querySelector('.oa-office-window__close-mark'))
      .toBeTruthy()
    expect(container.querySelector('.oa-office-window__header > div > img')?.getAttribute('src'))
      .toBe('/office/hud/roster-badge-v2.png')
    expect(container.querySelector('.oa-office-window__title-room')?.textContent)
      .toBe('Semis and supply chain')
    expect(container.querySelector('.oa-office-window__title-kind')?.textContent).toBe('Team roster')
    expect(container.querySelector('.oa-office-window__title-count')?.textContent).toBe('06/06')
    expect(container.querySelector('.oa-office-window__title-count')?.getAttribute('aria-label'))
      .toBe('Member 6 of 6')
    expect(container.querySelector('.oa-office-roster__cursor')?.getAttribute('src'))
      .toBe('/office/hud/journal-cursor-v1.png')
    expect(container.textContent).not.toContain('▶')
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getAllByText('working')).toHaveLength(2)
    expect(screen.queryByText('idle')).toBeNull()
    expect(screen.getByText('failed')).toBeTruthy()
    expect(screen.getByText('waiting')).toBeTruthy()
    expect(screen.getAllByText('asleep')).toHaveLength(2)
    expect(container.querySelectorAll('.oa-office-roster__status[data-power="awake"]')).toHaveLength(2)
    expect(container.querySelectorAll('.oa-office-roster__status[data-power="asleep"]')).toHaveLength(4)
    expect(container.querySelectorAll('.oa-office-roster__identity > .oa-office-roster__status')).toHaveLength(6)
    expect(container.querySelector('.oa-office-roster__meta')?.textContent).toBe('Research session 1')
    expect(container.querySelectorAll('.oa-office-roster li button[data-awake="false"]')).toHaveLength(4)
    const focusedMember = screen.getByRole('button', { name: /Claude.*c1.*Research session 6/i })
    expect(document.activeElement).toBe(focusedMember)
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(focusedMember)
    const memberButtons = employees.map((employee) => screen.getByRole('button', {
      name: new RegExp(`${employee.name}.*${employee.title}`, 'i'),
    }))
    memberButtons.forEach((button, index) => {
      button.scrollIntoView = vi.fn()
      const row = Math.floor(index / 2)
      const column = index % 2
      vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
        x: column * 220,
        y: row * 80,
        left: column * 220,
        right: column * 220 + 200,
        top: row * 80,
        bottom: row * 80 + 64,
        width: 200,
        height: 64,
        toJSON: () => ({}),
      })
    })
    const roster = screen.getByRole('list', { name: 'Team roster' })
    Object.defineProperty(roster, 'clientHeight', { configurable: true, value: 150 })
    expect(roster.getAttribute('aria-keyshortcuts'))
      .toBe('ArrowLeft ArrowRight ArrowUp ArrowDown PageUp PageDown Home End Enter Space')
    await userEvent.keyboard('{Home}{ArrowRight}{ArrowDown}')
    expect(document.activeElement).toBe(memberButtons[3])
    expect(container.querySelector('.oa-office-window__title-count')?.textContent).toBe('04/06')
    expect(container.querySelector('.oa-office-window__title-count')?.getAttribute('aria-label'))
      .toBe('Member 4 of 6')
    expect(memberButtons[3]?.tabIndex).toBe(0)
    expect(memberButtons[5]?.tabIndex).toBe(-1)
    await userEvent.keyboard('{Home}{PageDown}')
    expect(document.activeElement).toBe(memberButtons[4])
    expect(container.querySelector('.oa-office-window__title-count')?.textContent).toBe('05/06')
    expect(memberButtons[4]?.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
    await userEvent.keyboard('{PageUp}')
    expect(document.activeElement).toBe(memberButtons[0])
    await userEvent.keyboard('{End}')
    expect(document.activeElement).toBe(memberButtons[5])
    expect(container.querySelector('.oa-office-window__title-count')?.textContent).toBe('06/06')
    fireEvent.keyDown(memberButtons[5]!, { key: 'Enter' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ resumeId: 'resume-5' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    onSelect.mockClear()
    fireEvent.keyDown(memberButtons[5]!, { key: ' ' })
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ resumeId: 'resume-5' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    onSelect.mockClear()
    await userEvent.click(focusedMember)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ resumeId: 'resume-5' }))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
