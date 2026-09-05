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
      'nav.applicationMenu': 'Your Alice: Open application menu',
      'nav.yourAlice': 'Your Alice',
      'nav.appearanceMenu': `Appearance: ${params?.mode}`,
      'nav.item.settings': 'Settings',
      'nav.item.connectors': 'Connectors',
      'nav.connectorNeedsAttention': '1 connector needs attention',
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
        onOpenSettings={onOpenSettings}
        onOpenConnectors={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Your Alice: Open application menu' }))
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Settings', 'Connectors', 'AppearanceAuto'])
    expect(screen.getByRole('menuitem', { name: 'Appearance: Auto' })).toBeTruthy()
    expect(screen.queryByRole('menuitemradio', { name: 'Auto' })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Your Alice: Open application menu' }))
    screen.getByRole('menuitem', { name: 'Appearance: Auto' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('menuitemradio', { name: 'Auto' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: 'Day' })).toBeTruthy()
    await user.click(screen.getByRole('menuitemradio', { name: 'Night' }))
    expect(mocks.setTheme).toHaveBeenCalledWith('night')

  })

  it.each([false, true])('opens Connectors with keyboard and keeps warnings discoverable (compact=%s)', async (compactRail) => {
    const user = userEvent.setup()
    const onOpenConnectors = vi.fn()
    render(<ActivityBarUtilityMenu compactRail={compactRail} denseRail={false}
      onOpenSettings={vi.fn()} onOpenConnectors={onOpenConnectors} connectorsActive connectorWarnings={1} />)
    expect(screen.getByRole('status', { name: '1 connector needs attention' })).toBeTruthy()
    const trigger = screen.getByRole('button', { name: 'Your Alice: Open application menu' })
    expect(trigger.querySelector('img')?.getAttribute('src')).toBe('/alice.ico')
    expect(trigger.querySelector('img')?.parentElement?.classList.contains('rounded-full')).toBe(true)
    expect(trigger.textContent).toBe(compactRail ? '' : 'Your Alice')
    expect(trigger.className).not.toContain('bg-sidebar-accent text-sidebar-accent-foreground')
    trigger.focus()
    await user.keyboard('{ArrowDown}')
    expect(trigger.className).toContain('bg-sidebar-accent text-sidebar-accent-foreground')
    const connectors = screen.getByRole('menuitem', { name: /Connectors/ })
    expect(connectors.getAttribute('aria-current')).toBe('page')
    connectors.focus()
    await user.keyboard('{Enter}')
    expect(onOpenConnectors).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menuitem', { name: /Connectors/ })).toBeNull()
  })
})
