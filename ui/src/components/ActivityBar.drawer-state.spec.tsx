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
    selectedSidebar: 'issue',
    setSidebar: mocks.setSidebar,
    openOrFocus: mocks.openOrFocus,
  }),
}))

vi.mock('../live/inbox-read', () => ({
  useUnreadInboxCount: () => 0,
}))

vi.mock('../tabs/types', () => ({ getFocusedTab: () => ({ spec: { kind: 'issue' } }) }))
vi.mock('./workspace/ChatWorkspaceSection', () => ({
  ChatWorkspaceSection: ({ mode }: { mode: string }) => <button className="min-h-10 md:min-h-8">{mode} Harness</button>,
}))

vi.mock('../live/trading-push', () => ({
  usePendingPushCount: () => 0,
}))

vi.mock('../live/connector-health', () => ({
  useConnectorWarningCount: () => 0,
}))

vi.mock('../live/activity-bar-collapse', () => ({
  useActivityBarCollapse: (selector: (state: Record<string, unknown>) => unknown) => selector({
    collapsedSections: { beta: true },
    setCollapsed: mocks.setCollapsed,
    railCollapsed: false,
    setRailCollapsed: mocks.setRailCollapsed,
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'nav.quickStart': 'Quick Start',
      'nav.item.issue': 'Issues',
      'nav.item.automation': 'Automation',
      'nav.section.beta': 'Beta',
      'nav.section.system': 'System',
      'nav.primaryNavigation': 'Primary navigation',
    })[key] ?? key,
  }),
}))

vi.mock('./ActivityBarUtilityMenu', () => ({
  ActivityBarUtilityMenu: () => <button type="button">Project menu</button>,
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

    const primaryAction = screen.getByRole('button', { name: 'Quick Start' })
    const predictionAction = screen.getByRole('button', { name: 'prediction Harness' })

    expect(primaryAction.className).toContain('min-h-10')
    expect(primaryAction.className).toContain('md:min-h-8')
    expect(predictionAction.className).toContain('min-h-10')
    expect(predictionAction.className).toContain('md:min-h-8')
    expect(screen.queryByRole('button', { name: 'Beta' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'nav.about' })).toBeNull()
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
    const currentDestination = screen.getByRole('button', { name: 'Issues' })
    const focusableActions = Array.from(
      drawer.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
    ).filter((element) => element.tabIndex >= 0 && element.getAttribute('aria-hidden') !== 'true')
    const firstAction = focusableActions[0]!
    const firstDestination = focusableActions[1]!
    const lastAction = focusableActions.at(-1)!
    const backdrop = document.querySelector<HTMLElement>('[data-slot="sheet-overlay"]')

    expect(drawer.getAttribute('aria-modal')).toBe('true')
    expect(firstAction.getAttribute('aria-label')).toBe('common.closePanel')
    expect(firstDestination.textContent).toContain('Quick Start')
    expect(lastAction.textContent).toContain('Project menu')
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
