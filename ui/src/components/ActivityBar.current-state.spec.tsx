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
  mocks.selectedSidebar = 'settings'
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

    mocks.selectedSidebar = 'chat'
    rerender(<ActivityBar open onClose={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Ask Alice' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('button', { name: 'Settings' }).getAttribute('aria-current')).toBeNull()
    expect(document.querySelectorAll('nav [aria-current="page"]')).toHaveLength(1)
  })
})
