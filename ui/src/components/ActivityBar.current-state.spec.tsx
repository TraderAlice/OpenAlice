// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ActivityBar } from './ActivityBar'

const mocks = vi.hoisted(() => ({
  selectedSidebar: 'settings',
  setSidebar: vi.fn(),
  openOrFocus: vi.fn(),
  setCollapsed: vi.fn(),
  setRailCollapsed: vi.fn(),
  railCollapsed: false,
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
    railCollapsed: mocks.railCollapsed,
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
      'nav.collapseRail': 'Collapse activity bar',
      'nav.expandRail': 'Expand activity bar',
      'nav.section.beta': 'Beta',
      'nav.section.system': 'System',
    })[key] ?? key,
  }),
}))

vi.mock('./ThemeToggle', () => ({
  ThemeToggle: () => null,
}))

beforeEach(() => {
  mocks.selectedSidebar = 'settings'
  mocks.connectorWarnings = 0
  mocks.railCollapsed = false
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
    expect(screen.queryByRole('button', { name: 'Collapse activity bar' })).toBeNull()
    expect(screen.getByTestId('activity-bar').firstElementChild?.querySelector('img')).toBeTruthy()
  })

  it('shows configured connector degradation on the Connector activity item', () => {
    mocks.connectorWarnings = 1
    render(<ActivityBar open onClose={vi.fn()} />)

    expect(screen.getByLabelText('1 connector needs attention').textContent).toBe('1')
  })

  it('keeps the rail toggle in the header and turns that slot into expand when collapsed', () => {
    const { rerender } = render(<ActivityBar open onClose={vi.fn()} />)

    const activityBar = screen.getByTestId('activity-bar')
    const header = activityBar.firstElementChild!
    const footer = activityBar.lastElementChild!
    const collapse = screen.getByRole('button', { name: 'Collapse activity bar' })
    expect(header.contains(collapse)).toBe(true)
    expect(footer.contains(collapse)).toBe(false)

    collapse.click()
    expect(mocks.setRailCollapsed).toHaveBeenCalledWith(true)

    mocks.railCollapsed = true
    rerender(<ActivityBar open onClose={vi.fn()} />)
    const expand = screen.getByRole('button', { name: 'Expand activity bar' })
    expect(header.contains(expand)).toBe(true)
    expect(header.querySelector('img')).toBeNull()
    expect(activityBar.getAttribute('data-rail-layout')).toBe('compact')
  })
})
