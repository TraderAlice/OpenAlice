// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { MobileRailMenuButton } from './MobileRailMenuButton'

beforeEach(async () => {
  await i18n.changeLanguage('zh')
})

afterEach(cleanup)

describe('MobileRailMenuButton', () => {
  it('uses the active locale for the mobile navigation action', () => {
    const onOpen = vi.fn()
    const { rerender } = render(
      <MobileRailMenuButton open={false} controlsId="activity-bar" onOpen={onOpen} />,
    )

    const button = screen.getByRole('button', { name: '展开活动栏' })
    expect(button.className).toContain('h-10')
    expect(button.className).toContain('w-10')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBe('activity-bar')
    expect(button.getAttribute('aria-haspopup')).toBe('dialog')

    fireEvent.click(button)

    expect(onOpen).toHaveBeenCalledOnce()

    rerender(<MobileRailMenuButton open controlsId="activity-bar" onOpen={onOpen} />)
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })
})
