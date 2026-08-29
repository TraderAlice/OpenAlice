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
  awake: true,
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
    expect(screen.getByTestId('office-emote-working').querySelector('img')?.getAttribute('src'))
      .toBe('/office/hud/talk-bubble-v2.png')
    expect(screen.getByTestId('office-emote-working').dataset.reducedMotion).toBe('true')
    expect(container.querySelector('.oa-office-nameplate')?.textContent).toContain('c1')
    expect(container.querySelector('.oa-office-nameplate')?.textContent).not.toContain('Open issue scan')
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('Claude')
    expect(screen.getByRole('button').getAttribute('aria-label')).not.toContain('Open issue scan')
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('awake')

    rerender(<OfficeDesk {...props} nearby />)
    expect(screen.queryByText('Researching…')).toBeNull()
  })

  it('powers down a sleeping Session desk without removing its coworker', () => {
    const sleepingEmployee = { ...employee, awake: false, mood: 'idle' as const, bubble: null }
    const { container } = render(
      <OfficeDesk
        employee={sleepingEmployee}
        roomName="Chat"
        selected={false}
        depth={107}
        reducedMotion={false}
        onSelect={() => undefined}
      />,
    )

    const desk = screen.getByRole('button')
    expect(desk.dataset.awake).toBe('false')
    expect(desk.getAttribute('aria-label')).toContain('asleep')
    expect(container.querySelector<HTMLImageElement>('.oa-office-topdown-station__asset')?.src)
      .toContain('/office/furniture/vacant-workstation-v2.png')
    expect(container.querySelector('.oa-office-coworker')).toBeTruthy()
    const sleepEmote = screen.getByTestId('office-emote-sleeping')
    expect(sleepEmote.querySelector('img')?.getAttribute('src'))
      .toBe('/office/coworkers/sleep-emote-v1.png')
    expect(sleepEmote.dataset.reducedMotion).toBeUndefined()
  })

  it('removes the sleep cue as soon as the Session wakes', () => {
    const { rerender } = render(
      <OfficeDesk
        employee={{ ...employee, awake: false, mood: 'idle', bubble: null }}
        roomName="Chat"
        selected={false}
        depth={107}
        reducedMotion
        onSelect={() => undefined}
      />,
    )

    expect(screen.getByTestId('office-emote-sleeping').dataset.reducedMotion).toBe('true')
    rerender(
      <OfficeDesk
        employee={{ ...employee, awake: true, mood: 'idle', bubble: null }}
        roomName="Chat"
        selected={false}
        depth={107}
        reducedMotion
        onSelect={() => undefined}
      />,
    )
    expect(screen.queryByTestId('office-emote-sleeping')).toBeNull()
  })

  it('shows the selected historical event state over the generic sleep cue', () => {
    const replayEmployee = { ...employee, awake: false, mood: 'review' as const, bubble: null }
    const props = {
      employee: replayEmployee,
      roomName: 'Chat',
      selected: false,
      depth: 107,
      reducedMotion: true,
      onSelect: () => undefined,
    }
    const { rerender } = render(<OfficeDesk {...props} replayFocused />)

    expect(screen.getByRole('button').dataset.replayFocus).toBe('true')
    expect(screen.getByTestId('office-emote-review').querySelector('img')?.getAttribute('src'))
      .toBe('/office/coworkers/review-emote-v1.png')
    expect(screen.queryByTestId('office-emote-sleeping')).toBeNull()

    rerender(<OfficeDesk {...props} />)
    expect(screen.getByTestId('office-emote-sleeping')).toBeTruthy()
    expect(screen.queryByTestId('office-emote-review')).toBeNull()
  })

  it.each([
    ['waiting', '/office/coworkers/waiting-emote-v1.png'],
    ['failed', '/office/coworkers/failed-emote-v1.png'],
    ['review', '/office/coworkers/review-emote-v1.png'],
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
