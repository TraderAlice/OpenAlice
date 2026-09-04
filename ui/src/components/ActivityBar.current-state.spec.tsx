// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ActivityBar } from './ActivityBar'

const mocks = vi.hoisted(() => ({
  selectedSidebar: 'issue',
  setSidebar: vi.fn(),
  openOrFocus: vi.fn(),
  setCollapsed: vi.fn(),
  setRailCollapsed: vi.fn(),
  railCollapsed: false as boolean | null,
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
      'nav.item.issue': 'Issues',
      'nav.item.connectors': 'Connectors',
      'nav.connectorNeedsAttention': '1 connector needs attention',
      'nav.collapseRail': 'Collapse activity bar',
      'nav.expandRail': 'Expand activity bar',
      'nav.section.beta': 'Beta',
      'nav.section.system': 'System',
    })[key] ?? key,
  }),
}))

vi.mock('./ActivityBarUtilityMenu', () => ({
  ActivityBarUtilityMenu: ({ onOpenSettings }: { onOpenSettings: () => void }) => (
    <button type="button" data-testid="activity-bar-utility" onClick={onOpenSettings}>Utilities</button>
  ),
}))

beforeEach(() => {
  mocks.selectedSidebar = 'issue'
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
  it('hosts the shell collapse action beside the brand only when expanded', () => {
    const view = render(<ActivityBar open onClose={vi.fn()} headerAction={<button>Collapse navigation</button>} />)
    expect(screen.getByTestId('activity-bar').firstElementChild?.contains(screen.getByRole('button', { name: 'Collapse navigation' }))).toBe(true)
    mocks.railCollapsed = true
    view.rerender(<ActivityBar open onClose={vi.fn()} headerAction={<button>Collapse navigation</button>} />)
    expect(screen.queryByRole('button', { name: 'Collapse navigation' })).toBeNull()
  })
  it('exposes the visually active product area as the current page', () => {
    const { rerender } = render(<ActivityBar open onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Issues' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Ask Alice' }).getAttribute('aria-current')).toBeNull()
    expect(document.querySelectorAll('nav [aria-current="page"]')).toHaveLength(1)
    expect(screen.getByTestId('activity-bar').getAttribute('data-rail-layout')).toBe('full')

    mocks.selectedSidebar = 'chat'
    rerender(<ActivityBar open onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Ask Alice' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Ask Alice' }).getAttribute('aria-label')).toBe('Ask Alice')
    expect(screen.getByRole('button', { name: 'Issues' }).getAttribute('aria-current')).toBeNull()
    expect(document.querySelectorAll('nav [aria-current="page"]')).toHaveLength(1)
    expect(screen.getByTestId('activity-bar').getAttribute('data-rail-layout')).toBe('full')
    expect(screen.queryByRole('button', { name: 'Collapse activity bar' })).toBeNull()
    expect(screen.getByTestId('activity-bar').firstElementChild?.querySelector('img')).toBeTruthy()
  })

  it('shows configured connector degradation on the Connector activity item', () => {
    mocks.connectorWarnings = 1
    render(<ActivityBar open onClose={vi.fn()} />)

    expect(screen.getByLabelText('1 connector needs attention').textContent).toBe('1')
  })

  it('opens Settings from the application utility menu', () => {
    render(<ActivityBar open onClose={vi.fn()} />)

    screen.getByTestId('activity-bar-utility').click()
    expect(mocks.setSidebar).toHaveBeenCalledWith('settings')
    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'settings',
      params: { category: 'general' },
    })
  })

  it('leaves global toggling to the top bar and keeps its brand when compact', () => {
    mocks.railCollapsed = true
    render(<ActivityBar open onClose={vi.fn()} />)
    const activityBar = screen.getByTestId('activity-bar')
    expect(activityBar.getAttribute('data-rail-layout')).toBe('compact')
    expect(activityBar.firstElementChild?.querySelector('img')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /activity bar/ })).toBeNull()
  })

  it('uses the compact breakpoint only as a default, never an expansion lock', () => {
    mocks.railCollapsed = null
    const view = render(<ActivityBar open onClose={vi.fn()} railMode="compact" />)
    expect(screen.getByTestId('activity-bar').getAttribute('data-rail-layout')).toBe('compact')
    mocks.railCollapsed = false
    mocks.selectedSidebar = 'chat'
    view.rerender(<ActivityBar open onClose={vi.fn()} railMode="compact" />)
    expect(screen.getByTestId('activity-bar').getAttribute('data-rail-layout')).toBe('narrow')
    mocks.railCollapsed = true
    view.rerender(<ActivityBar open onClose={vi.fn()} railMode="full" />)
    expect(screen.getByTestId('activity-bar').getAttribute('data-rail-layout')).toBe('compact')
  })
})
