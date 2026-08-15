// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { OfficeFloor } from './OfficeFloor'
import { officeStationComposition } from './station'

afterEach(cleanup)

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

describe('OfficeFloor', () => {
  it('renders vacant desks and a filing cabinet', async () => {
    const onOpenFiles = vi.fn()
    render(
      <OfficeFloor
        floor={{ workspace: { id: 'office-1', tag: 'chat' }, employees: [] }}
        onSelectEmployee={vi.fn()}
        onOpenEmployee={vi.fn()}
        onOpenFiles={onOpenFiles}
      />,
    )
    expect(screen.getByRole('heading', { name: /chat office/i })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /Empty desk/i }).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: /Filing cabinet/i }))
    expect(onOpenFiles).toHaveBeenCalledOnce()
  })

  it('selects an occupied desk without leaving the floor', async () => {
    const onSelectEmployee = vi.fn()
    render(
      <OfficeFloor
        floor={{
          workspace: { id: 'office-1', tag: 'chat' },
          employees: [{
            resumeId: 'resume-alice',
            agent: 'codex',
            name: 'c1',
            title: 'Desk mate',
            mood: 'working',
            surface: 'headless',
            bubble: { kind: 'tool', name: 'workspace_list' },
            lastSeq: 2,
            drawers: [],
          }],
        }}
        onSelectEmployee={onSelectEmployee}
        onOpenEmployee={vi.fn()}
        onOpenFiles={vi.fn()}
      />,
    )
    const desk = screen.getByRole('button', { name: /Desk mate @resume-alice/ })
    expect(screen.getByText('workspace_list')).toBeTruthy()
    expect(screen.getByText('c1')).toBeTruthy()
    await userEvent.click(desk)
    expect(onSelectEmployee).toHaveBeenCalledOnce()
    const occupied = screen.getByTestId('office-desk-resume-alice')
    const empty = screen.getByTestId('office-desk-empty')
    expect(occupied.clientHeight).toBe(empty.clientHeight)
    const station = officeStationComposition()
    const sprite = occupied.querySelector('[data-slot="office-sprite"]') as HTMLElement
    const deskProp = occupied.querySelector('[data-slot="office-desk-prop"]') as HTMLElement
    expect(sprite).toBeTruthy()
    expect(deskProp).toBeTruthy()
    expect(Number(sprite.style.zIndex)).toBeLessThan(Number(deskProp.style.zIndex))
    expect(sprite.style.bottom).toBe(`${station.sprite.bottomPx}px`)
    expect(Number(sprite.style.zIndex)).toBe(station.sprite.zIndex)
  })
})
