// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ActivityBar } from './ActivityBar'

const mocks = vi.hoisted(() => ({
  selectedSidebar: 'settings',
  setSidebar: vi.fn(),
  openOrFocus: vi.fn(),
  setCollapsed: vi.fn(),
  setRailCollapsed: vi.fn(),
  connectorWarnings: 0,
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: Record<string, unknown>) => unknown) => selector({
    selectedSidebar: mocks.selectedSidebar,
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

vi.mock('../live/connector-health', () => ({
  useConnectorWarningCount: () => mocks.connectorWarnings,
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
      'nav.item.connectors': 'Connectors',
      'nav.connectorNeedsAttention': '1 connector needs attention',
      'nav.section.beta': 'Beta',
      'nav.section.system': 'System',
      'nav.expandRail': 'Expand navigation',
      'nav.collapseRail': 'Collapse navigation',
    })[key] ?? key,
  }),
}))

vi.mock('./ThemeToggle', () => ({
  ThemeToggle: () => null,
}))

beforeEach(() => {
    mocks.selectedSidebar = 'settings'
    mocks.connectorWarnings = 0
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

describe('ActivityBar current destination', () => {
  it('exposes the visually active product area as the current page', () => {
    const { rerender } = render(<ActivityBar open onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Ask Alice' }).getAttribute('aria-current')).toBeNull()
    expect(document.querySelectorAll('nav [aria-current="page"]')).toHaveLength(1)
    expect(screen.getByTestId('activity-bar').getAttribute('data-rail-layout')).toBe('full')

    mocks.selectedSidebar = 'chat'
    rerender(<ActivityBar open onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Ask Alice' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Ask Alice' }).getAttribute('aria-label')).toBe('Ask Alice')
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-current')).toBeNull()
    expect(document.querySelectorAll('nav [aria-current="page"]')).toHaveLength(1)
    expect(screen.getByTestId('activity-bar').getAttribute('data-rail-layout')).toBe('compact')
    expect(screen.getByTestId('activity-bar').className).toContain('md:w-[50px]')
  })

  it('shows configured connector degradation on the Connector activity item', () => {
    mocks.connectorWarnings = 1
    render(<ActivityBar open onClose={vi.fn()} />)

    expect(screen.getByLabelText('1 connector needs attention').textContent).toBe('1')
  })

  it('turns the compact brand position into the workbench rail expansion action', async () => {
    const user = userEvent.setup()
    mocks.selectedSidebar = 'chat'
    render(<ActivityBar open onClose={vi.fn()} railMode="full" />)

    const rail = screen.getByTestId('activity-bar')
    const expand = screen.getByRole('button', { name: 'Expand navigation' })
    expect(rail.getAttribute('data-rail-layout')).toBe('compact')
    expect(expand.querySelector('img')?.getAttribute('src')).toBe('/alice.ico')

    await user.click(expand)

    expect(mocks.setRailCollapsed).toHaveBeenCalledWith(false)
    expect(rail.getAttribute('data-rail-layout')).toBe('full')
    expect(screen.getByRole('button', { name: 'Collapse navigation' })).toBeTruthy()
  })
})
