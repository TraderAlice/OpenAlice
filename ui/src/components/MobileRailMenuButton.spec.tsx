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
    render(<MobileRailMenuButton onOpen={onOpen} />)

    const button = screen.getByRole('button', { name: '展开活动栏' })
    expect(button.className).toContain('h-10')
    expect(button.className).toContain('w-10')

    fireEvent.click(button)

    expect(onOpen).toHaveBeenCalledOnce()
  })
})
