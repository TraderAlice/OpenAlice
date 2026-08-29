// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { OfficeFloorEmployee } from '../api/office'
import { i18n } from '../i18n'
import { OfficeDesk } from './OfficeDesk'
import { officeCoworkerSpriteForAgent } from './coworker-sprites'

const employee: OfficeFloorEmployee = {
  resumeId: 'resume-claude',
  agent: 'claude',
  name: 'c1',
  title: 'Open issue scan',
  mood: 'working',
  bubble: { kind: 'tool', name: 'research' },
  lastSeq: 1,
  lastInteractionAt: 1,
  drawers: [],
}

afterEach(cleanup)

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('OfficeDesk', () => {
  it('keeps a powered-down generated workstation visible in a vacant slot', () => {
    const { container } = render(
      <OfficeDesk
        employee={null}
        roomName="Auto Quant"
        selected={false}
        depth={107}
        reducedMotion={false}
        onSelect={() => undefined}
      />,
    )

    const desk = screen.getByRole('button', { name: 'Empty desk in Auto Quant office' })
    expect(desk.hasAttribute('disabled')).toBe(true)
    expect(desk.dataset.occupied).toBe('false')
    expect(container.querySelector<HTMLImageElement>('.oa-office-topdown-station__asset')?.src)
      .toContain('/office/furniture/vacant-workstation-v2.png')
    expect(container.querySelector('.oa-office-coworker')).toBeNull()
  })

  it('leaves live work copy to the shared interaction prompt', () => {
    const props = {
      employee,
      roomName: 'Chat',
      selected: false,
      nearby: false,
      depth: 107,
      reducedMotion: true,
      onSelect: () => undefined,
    }
    const { container, rerender } = render(<OfficeDesk {...props} />)
    const coworker = officeCoworkerSpriteForAgent(employee.agent, employee.resumeId)

    expect(screen.getByRole('button').style.zIndex).toBe('107')
    expect(screen.queryByText('Researching…')).toBeNull()
    expect(container.querySelector('.oa-office-coworker')?.getAttribute('data-agent')).toBe(coworker.id)
    expect(container.querySelector('.oa-office-coworker')?.getAttribute('data-pose')).toBe('desk')
    expect(container.querySelector('.oa-office-coworker')?.getAttribute('data-reduced-motion')).toBe('true')
    expect(container.querySelector<HTMLImageElement>('.oa-office-topdown-station__asset')?.src)
      .toContain('/office/furniture/workstation-v2.png')
    expect(container.querySelector<HTMLImageElement>('.oa-office-coworker img')?.src)
      .toContain(coworker.deskSrc)
    expect(container.querySelector<HTMLImageElement>('.oa-office-coworker__frame--work')?.src)
      .toContain(coworker.deskWorkSrc)
    expect(container.querySelector('.oa-office-nameplate')?.textContent).toContain('c1')
    expect(container.querySelector('.oa-office-nameplate')?.textContent).not.toContain('Open issue scan')
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Open issue scan')

    rerender(<OfficeDesk {...props} nearby />)
    expect(screen.queryByText('Researching…')).toBeNull()
  })

  it.each([
    ['waiting', '/office/coworkers/waiting-emote-v1.png'],
    ['failed', '/office/coworkers/failed-emote-v1.png'],
  ] as const)('keeps the generated %s emote while interaction copy moves to the prompt', (mood, src) => {
    const stateEmployee = { ...employee, mood, bubble: { kind: 'tool' as const, name: 'research' } }
    const props = {
      employee: stateEmployee,
      roomName: 'Chat',
      selected: false,
      nearby: false,
      depth: 107,
      reducedMotion: true,
      onSelect: () => undefined,
    }
    const { rerender } = render(<OfficeDesk {...props} />)

    const emote = screen.getByTestId(`office-emote-${mood}`)
    expect(emote.dataset.reducedMotion).toBe('true')
    expect(emote.querySelector('img')?.getAttribute('src')).toBe(src)

    rerender(<OfficeDesk {...props} nearby />)
    expect(screen.getByTestId(`office-emote-${mood}`)).toBeTruthy()
    expect(screen.queryByText('Researching…')).toBeNull()
  })
})
