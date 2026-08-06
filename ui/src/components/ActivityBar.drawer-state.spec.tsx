// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ActivityBar } from './ActivityBar'

const mocks = vi.hoisted(() => ({
  setSidebar: vi.fn(),
  openOrFocus: vi.fn(),
  setCollapsed: vi.fn(),
  setRailCollapsed: vi.fn(),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: Record<string, unknown>) => unknown) => selector({
    selectedSidebar: 'settings',
    setSidebar: mocks.setSidebar,
    openOrFocus: mocks.openOrFocus,
  }),
}))

vi.mock('../live/inbox-read', () => ({
  useUnreadInboxCount: () => 0,
}))

vi.mock('../live/trading-push', () => ({
  usePendingPushCount: () => 0,
}))

vi.mock('../live/activity-bar-collapse', () => ({
  useActivityBarCollapse: (selector: (state: Record<string, unknown>) => unknown) => selector({
    collapsedSections: {},
    setCollapsed: mocks.setCollapsed,
    railCollapsed: false,
    setRailCollapsed: mocks.setRailCollapsed,
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'nav.item.chat': 'Ask Alice',
      'nav.item.settings': 'Settings',
      'nav.item.dev': 'Dev Panel',
      'nav.section.beta': 'Beta',
      'nav.section.system': 'System',
      'nav.primaryNavigation': 'Primary navigation',
    })[key] ?? key,
  }),
}))

vi.mock('./ThemeToggle', () => ({
  ThemeToggle: () => null,
}))

beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('ActivityBar mobile drawer state', () => {
  it('unmounts the closed mobile drawer without hiding the desktop rail', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <ActivityBar open={false} onClose={onClose} desktopStatic={false} />,
    )
    expect(screen.queryByTestId('activity-bar')).toBeNull()

    rerender(<ActivityBar open onClose={onClose} desktopStatic={false} />)
    const mobileActivityBar = screen.getByTestId('activity-bar')
    expect(mobileActivityBar.getAttribute('data-slot')).toBe('sheet-content')
    expect(mobileActivityBar.getAttribute('role')).toBe('dialog')
    expect(mobileActivityBar.getAttribute('aria-modal')).toBe('true')
    expect(mobileActivityBar.className).toContain('data-[side=left]:w-[280px]')

    rerender(<ActivityBar open={false} onClose={onClose} desktopStatic={false} />)
    expect(screen.queryByTestId('activity-bar')).toBeNull()

    rerender(<ActivityBar open={false} onClose={onClose} desktopStatic />)
    const activityBar = screen.getByTestId('activity-bar')
    expect(activityBar.getAttribute('aria-hidden')).toBeNull()
    expect(activityBar.hasAttribute('inert')).toBe(false)
    expect(activityBar.getAttribute('role')).toBeNull()
    expect(activityBar.getAttribute('aria-modal')).toBeNull()
    expect(activityBar.getAttribute('aria-label')).toBeNull()
    expect(activityBar.getAttribute('tabindex')).toBeNull()
  })

  it('keeps mobile drawer actions tappable without changing desktop density', () => {
    render(<ActivityBar open onClose={vi.fn()} desktopStatic={false} />)

    const primaryAction = screen.getByRole('button', { name: 'Ask Alice' })
    const sectionToggle = screen.getByRole('button', { name: 'Beta' })
    const sectionInfo = screen.getByRole('button', { name: 'nav.about' })

    expect(primaryAction.className).toContain('min-h-10')
    expect(primaryAction.className).toContain('md:min-h-[34px]')
    expect(sectionToggle.className).toContain('min-h-10')
    expect(sectionToggle.className).toContain('md:min-h-7')
    expect(sectionInfo.className).toContain('min-h-10')
    expect(sectionInfo.className).toContain('min-w-10')
    expect(sectionInfo.className).toContain('md:min-h-7')
    expect(sectionInfo.className).toContain('md:min-w-7')
  })

  it('dismisses through the shared Sheet overlay', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<ActivityBar open onClose={onClose} desktopStatic={false} />)

    const overlay = document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]')
    expect(overlay).toBeTruthy()
    await user.click(overlay!)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('contains mobile focus, closes on Escape, and restores the trigger', async () => {
    const user = userEvent.setup()
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const returnFocusRef = { current: trigger }
    const onClose = vi.fn()
    const { rerender } = render(
      <ActivityBar
        open
        onClose={onClose}
        desktopStatic={false}
        returnFocusRef={returnFocusRef}
      />,
    )

    const drawer = screen.getByRole('dialog', { name: 'Primary navigation' })
    const currentDestination = screen.getByRole('button', { name: 'Settings' })
    const firstAction = screen.getByRole('button', { name: 'Ask Alice' })
    const lastAction = screen.getByRole('button', { name: 'Dev Panel' })
    const backdrop = document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]')

    expect(drawer.getAttribute('aria-modal')).toBe('true')
    await waitFor(() => expect(document.activeElement).toBe(currentDestination))
    expect(drawer.className).toContain('motion-reduce:transition-none')
    expect(backdrop?.getAttribute('aria-hidden')).toBe('true')

    lastAction.focus()
    await user.tab()
    await waitFor(() => expect(document.activeElement).toBe(firstAction))

    firstAction.focus()
    await user.tab({ shift: true })
    await waitFor(() => expect(document.activeElement).toBe(lastAction))

    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledOnce()

    rerender(
      <ActivityBar
        open={false}
        onClose={onClose}
        desktopStatic={false}
        returnFocusRef={returnFocusRef}
      />,
    )
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    trigger.remove()
  })
})
