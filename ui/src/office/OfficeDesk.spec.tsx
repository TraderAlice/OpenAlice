// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { OfficeFloorEmployee } from '../api/office'
import { i18n } from '../i18n'
import { OfficeDesk } from './OfficeDesk'

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
  it('keeps the floor quiet until the coworker is nearby or selected', () => {
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

    expect(screen.getByRole('button').style.zIndex).toBe('107')
    expect(screen.queryByText('research')).toBeNull()
    expect(container.querySelector('.oa-office-coworker')?.getAttribute('data-agent')).toBe('claude')
    expect(container.querySelector('.oa-office-coworker')?.getAttribute('data-reduced-motion')).toBe('true')
    expect(container.querySelector<HTMLImageElement>('.oa-office-coworker img')?.src)
      .toContain('/office/coworkers/claude-v1.webp')

    rerender(<OfficeDesk {...props} nearby />)
    expect(screen.getByText('research')).toBeTruthy()
  })
})
