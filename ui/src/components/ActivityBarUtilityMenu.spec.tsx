// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ActivityBarUtilityMenu } from './ActivityBarUtilityMenu'

const mocks = vi.hoisted(() => ({
  theme: 'auto',
  setTheme: vi.fn(),
}))

vi.mock('../theme/store', () => ({
  useThemeStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    theme: mocks.theme,
    setTheme: mocks.setTheme,
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { mode?: string }) => ({
      'nav.applicationMenu': 'Open settings menu',
      'nav.appearanceMenu': `Appearance: ${params?.mode}`,
      'nav.item.settings': 'Settings',
      'settings.category.appearance': 'Appearance',
      'theme.mode.auto': 'Auto',
      'theme.mode.day': 'Day',
      'theme.mode.night': 'Night',
    })[key] ?? key,
  }),
}))

afterEach(() => {
  cleanup()
  mocks.theme = 'auto'
  vi.clearAllMocks()
})

describe('ActivityBarUtilityMenu', () => {
  it('keeps theme choices in an Appearance submenu', async () => {
    const user = userEvent.setup()
    const onOpenSettings = vi.fn()
    render(
      <ActivityBarUtilityMenu
        compactRail={false}
        denseRail={false}
        active={false}
        onOpenSettings={onOpenSettings}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Open settings menu' }))
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Appearance: Auto' })).toBeTruthy()
    expect(screen.queryByRole('menuitemradio', { name: 'Auto' })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Open settings menu' }))
    screen.getByRole('menuitem', { name: 'Appearance: Auto' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('menuitemradio', { name: 'Auto' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: 'Day' })).toBeTruthy()
    await user.click(screen.getByRole('menuitemradio', { name: 'Night' }))
    expect(mocks.setTheme).toHaveBeenCalledWith('night')

  })
})
