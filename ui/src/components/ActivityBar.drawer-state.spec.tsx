// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
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
      'nav.section.beta': 'Beta',
      'nav.section.system': 'System',
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
  it('keeps the closed mobile drawer out of navigation without hiding the desktop rail', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <ActivityBar open={false} onClose={onClose} desktopStatic={false} />,
    )
    const activityBar = screen.getByTestId('activity-bar')

    expect(activityBar.getAttribute('aria-hidden')).toBe('true')
    expect(activityBar.hasAttribute('inert')).toBe(true)

    rerender(<ActivityBar open onClose={onClose} desktopStatic={false} />)
    expect(activityBar.getAttribute('aria-hidden')).toBe('false')
    expect(activityBar.hasAttribute('inert')).toBe(false)

    rerender(<ActivityBar open={false} onClose={onClose} desktopStatic />)
    expect(activityBar.getAttribute('aria-hidden')).toBe('false')
    expect(activityBar.hasAttribute('inert')).toBe(false)
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
})
