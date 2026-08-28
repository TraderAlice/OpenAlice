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
    expect(container.querySelector<HTMLImageElement>('.oa-office-inspect__portrait .oa-office-coworker img')?.src)
      .toContain('/office/coworkers/codex-v1.webp')
    expect(screen.getByRole('button', { name: 'Close' }).querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/window-close-v1.png')
    expect(screen.getByRole('button', { name: 'Open session' }).querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/session-portal-v1.png')
    expect(screen.getByRole('button', { name: 'desk-note.md' }).querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/drawer-record-v1.png')
    expect(container.querySelector('svg')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Open session' }))
    expect(onOpen).toHaveBeenCalledOnce()
    await userEvent.click(screen.getByRole('button', { name: 'desk-note.md' }))
    expect(onOpenDrawer).toHaveBeenCalledWith(employee.drawers[0])
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
