// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsCategoryList } from './SettingsCategoryList'

const mocks = vi.hoisted(() => ({
  product: 'trader' as 'trader' | 'nano' | undefined,
  focused: null as null | { kind: 'dev'; params: { tab: 'logs' } },
  openOrFocus: vi.fn(),
}))

vi.mock('../hooks/useAliceProject', () => ({
  useAliceProject: () => ({
    project: mocks.product ? { product: mocks.product } : null,
    loading: false,
    error: null,
    refresh: async () => undefined,
  }),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: Record<string, unknown>) => unknown) => selector({
    openOrFocus: mocks.openOrFocus,
  }),
}))

vi.mock('../tabs/types', () => ({
  getFocusedTab: () => mocks.focused ? { spec: mocks.focused } : null,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('./SidebarRow', () => ({
  SidebarRow: ({
    label,
    onClick,
    ariaExpanded,
  }: {
    label: string
    onClick: () => void
    ariaExpanded?: boolean
  }) => (
    <button type="button" onClick={onClick} aria-expanded={ariaExpanded}>
      {label}
    </button>
  ),
}))

beforeEach(() => {
  window.sessionStorage.clear()
  mocks.focused = null
  mocks.openOrFocus.mockClear()
})

afterEach(() => {
  cleanup()
  mocks.product = 'trader'
})

describe('SettingsCategoryList', () => {
  it('owns the vertical scroll region for long settings navigation', () => {
    render(<SettingsCategoryList />)

    const list = screen.getByTestId('settings-category-list')
    expect(list.className).toContain('overflow-y-auto')
    expect(list.className).toContain('overscroll-contain')
    expect(list.className).toContain('[scrollbar-gutter:stable]')
  })

  it('hides trading and market-data categories on NanoAlice', () => {
    mocks.product = 'nano'
    render(<SettingsCategoryList />)
    expect(screen.queryByText('settings.category.trading')).toBeNull()
    expect(screen.queryByText('settings.category.marketData')).toBeNull()
    expect(screen.queryByText('settings.category.newsSources')).toBeNull()
    expect(screen.getByText('settings.category.aiProvider')).toBeTruthy()
  })

  it('keeps Developer collapsed by default and opens its original pages on demand', () => {
    render(<SettingsCategoryList />)

    const developer = screen.getByRole('button', { name: 'settings.group.developer' })
    expect(developer.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('dev.frontend')).toBeNull()

    fireEvent.click(developer)
    expect(developer.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'common.logs' }))
    expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'dev', params: { tab: 'logs' } })
  })

  it('automatically expands for a Developer deep link', () => {
    mocks.focused = { kind: 'dev', params: { tab: 'logs' } }
    render(<SettingsCategoryList />)

    expect(screen.getByRole('button', { name: 'settings.group.developer' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'common.logs' })).toBeTruthy()
  })
})
