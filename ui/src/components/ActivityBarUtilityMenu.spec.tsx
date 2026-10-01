import aliceWave from '../../../default/stickers/alice-color/wave.png'
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ActivityBarUtilityMenu } from './ActivityBarUtilityMenu'

const mocks = vi.hoisted(() => ({
  theme: 'auto',
  setTheme: vi.fn(),
  guidance: { availableCount: 0, needsAttentionCount: 0 } as { availableCount: number; needsAttentionCount: number; setupCount?: number },
}))

vi.mock('../hooks/useUpdateLifecycle', () => ({ useUpdateLifecycle: () => ({ guidance: mocks.guidance }) }))

vi.mock('../theme/store', () => ({
  useThemeStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
    theme: mocks.theme,
    setTheme: mocks.setTheme,
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { mode?: string }) => ({
      'nav.applicationMenu': 'Alice’s Settings: Open application menu',
      'nav.yourAlice': 'Alice’s Settings',
      'nav.appearanceMenu': `Appearance: ${params?.mode}`,
      'nav.item.settings': 'Settings',
      'nav.item.connectors': 'Connectors',
      'nav.showCompanion': 'Show pet',
      'nav.hideCompanion': 'Hide pet',
      'nav.connectorNeedsAttention': '1 connector needs attention',
      'nav.updatesAvailable': `${(params as { count?: number })?.count} updates available`,
      'nav.updatesNeedAttention': `${(params as { count?: number })?.count} updates need attention`,
      'settings.group.appearance': 'Appearance',
      'theme.mode.auto': 'Auto',
      'theme.mode.day': 'Day',
      'theme.mode.night': 'Night',
    })[key] ?? key,
  }),
}))

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'openAlice')
  mocks.theme = 'auto'
  mocks.guidance = { availableCount: 0, needsAttentionCount: 0 }
  vi.clearAllMocks()
})

describe('ActivityBarUtilityMenu', () => {
  it('carries the update count from the avatar into Settings', async () => {
    mocks.guidance = { availableCount: 1, needsAttentionCount: 0 }
    render(<ActivityBarUtilityMenu compactRail denseRail={false} onOpenSettings={vi.fn()} onOpenConnectors={vi.fn()} />)
    expect(screen.getByRole('status', { name: '1 updates available' })).toBeTruthy()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Alice’s Settings: Open application menu' }))
    expect(screen.getByRole('menuitem', { name: /Settings.*updates available/ })).toBeTruthy()
  })
  it('keeps update and connector warnings readable when both are present', () => {
    mocks.guidance = { availableCount: 1, needsAttentionCount: 1 }
    render(<ActivityBarUtilityMenu compactRail denseRail={false} onOpenSettings={vi.fn()} onOpenConnectors={vi.fn()} connectorWarnings={1} />)
    expect(screen.getByRole('status', { name: '1 updates need attention; 1 connector needs attention' })).toBeTruthy()
  })
  it('recovers a hidden companion from Alice Settings and then offers Hide pet', async () => {
    let visible = false
    const toggle = vi.fn(async () => { visible = !visible; return visible })
    Object.defineProperty(window, 'openAlice', { configurable: true, value: { companion: {
      getVisible: async () => visible, toggle, onVisibility: () => () => {},
    } } })
    const user = userEvent.setup()
    render(<ActivityBarUtilityMenu compactRail={false} denseRail={false}
      onOpenSettings={vi.fn()} onOpenConnectors={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Alice’s Settings: Open application menu' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Show pet' }))
    expect(toggle).toHaveBeenCalledOnce()
    await user.click(screen.getByRole('button', { name: 'Alice’s Settings: Open application menu' }))
    expect(await screen.findByRole('menuitem', { name: 'Hide pet' })).toBeTruthy()
  })
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

    await user.click(screen.getByRole('button', { name: 'Alice’s Settings: Open application menu' }))
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toBeTruthy()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Settings', 'Connectors', 'AppearanceAuto'])
    expect(screen.getByRole('menuitem', { name: 'Appearance: Auto' })).toBeTruthy()
    expect(screen.queryByRole('menuitemradio', { name: 'Auto' })).toBeNull()
    await user.click(screen.getByRole('menuitem', { name: 'Settings' }))
    expect(onOpenSettings).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Alice’s Settings: Open application menu' }))
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
    const trigger = screen.getByRole('button', { name: 'Alice’s Settings: Open application menu' })
    expect(trigger.querySelector('img')?.getAttribute('src')).toBe(aliceWave)
    expect(trigger.querySelector('img')?.parentElement?.classList.contains('rounded-full')).toBe(true)
    expect(trigger.textContent).toBe(compactRail ? '1' : 'Alice’s Settings1')
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

it('uses the blue avatar breadcrumb for setup failures without claiming an available update', async () => {
  mocks.guidance = { availableCount: 0, needsAttentionCount: 0, setupCount: 1 }
  const { rerender } = render(<ActivityBarUtilityMenu compactRail denseRail={false} onOpenSettings={vi.fn()} onOpenConnectors={vi.fn()} />)
  expect(screen.getByRole('status', { name: 'projectSetup.title' }).className).toContain('bg-info/12')
  await userEvent.setup().click(screen.getByRole('button', { name: 'Alice’s Settings: Open application menu' }))
  expect(screen.getByRole('menuitem', { name: /Settings.*projectSetup.title/ })).toBeTruthy()
  expect(screen.queryByLabelText('1 updates available')).toBeNull()
  mocks.guidance.setupCount = 0
  rerender(<ActivityBarUtilityMenu compactRail denseRail={false} onOpenSettings={vi.fn()} onOpenConnectors={vi.fn()} />)
  expect(screen.queryByRole('status', { name: 'projectSetup.title' })).toBeNull()
})
