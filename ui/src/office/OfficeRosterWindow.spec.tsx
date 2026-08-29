// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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
      mood: index < 2 ? 'working' as const : 'idle' as const,
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
    expect(screen.getAllByRole('button')).toHaveLength(7)
    const coworkerImages = screen.getByTestId('office-roster-window')
      .querySelectorAll<HTMLImageElement>('.oa-office-coworker img')
    expect(coworkerImages).toHaveLength(6)
    expect(coworkerImages[0]?.getAttribute('src')).toBe('/office/coworkers/codex-portrait-v2.png')
    expect(coworkerImages[5]?.getAttribute('src')).toBe('/office/coworkers/claude-portrait-v2.png')
    expect(Array.from(coworkerImages).some((image) => image.src.includes('alice-maid'))).toBe(false)
    expect(screen.getByRole('button', { name: 'Close' }).querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/window-close-v2.png')
    expect(container.querySelector('.oa-office-window__header > div > img')?.getAttribute('src'))
      .toBe('/office/hud/roster-badge-v2.png')
    expect(container.querySelector('.oa-office-window__title-room')?.textContent)
      .toBe('Semis and supply chain')
    expect(container.querySelector('.oa-office-window__title-kind')?.textContent).toBe('Team roster')
    expect(container.querySelector('.oa-office-roster__cursor')?.getAttribute('src'))
      .toBe('/office/hud/journal-cursor-v1.png')
    expect(container.textContent).not.toContain('▶')
    expect(container.querySelector('svg')).toBeNull()
    expect(screen.getAllByText('working')).toHaveLength(2)
    expect(screen.getAllByText('idle')).toHaveLength(4)
    expect(container.querySelectorAll('.oa-office-roster__status[data-mood="idle"]')).toHaveLength(4)
    const focusedMember = screen.getByRole('button', { name: /Research session 6.*c1/i })
    expect(document.activeElement).toBe(focusedMember)
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    await userEvent.keyboard('{Tab}')
    expect(document.activeElement).toBe(focusedMember)
    const memberButtons = employees.map((employee) => screen.getByRole('button', {
      name: new RegExp(employee.title, 'i'),
    }))
    memberButtons.forEach((button, index) => {
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
    await userEvent.keyboard('{Home}{ArrowRight}{ArrowDown}')
    expect(document.activeElement).toBe(memberButtons[3])
    expect(memberButtons[3]?.tabIndex).toBe(0)
    expect(memberButtons[5]?.tabIndex).toBe(-1)
    await userEvent.keyboard('{End}')
    expect(document.activeElement).toBe(memberButtons[5])
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ resumeId: 'resume-5' }))
    onSelect.mockClear()
    await userEvent.click(focusedMember)
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ resumeId: 'resume-5' }))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
