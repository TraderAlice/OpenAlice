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
    render(
      <OfficeRosterWindow
        group={{
          workspace: { id: 'chat-1', tag: 'chat', harness: 'chat' },
          lastInteractionAt: 1,
          sleeping: false,
          employees,
        }}
        roomName="Semis and supply chain"
        onSelect={onSelect}
        onClose={onClose}
      />,
    )

    expect(screen.getByText('6 team members')).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(7)
    const coworkerImages = screen.getByTestId('office-roster-window')
      .querySelectorAll<HTMLImageElement>('.oa-office-coworker img')
    expect(coworkerImages).toHaveLength(6)
    expect(coworkerImages[0]?.getAttribute('src')).toBe('/office/coworkers/codex-v1.webp')
    expect(coworkerImages[5]?.getAttribute('src')).toBe('/office/coworkers/claude-v1.webp')
    expect(Array.from(coworkerImages).some((image) => image.src.includes('alice-maid'))).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: /Research session 6.*c1/i }))
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ resumeId: 'resume-5' }))
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
