// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SettingsCategoryList } from './SettingsCategoryList'

const mocks = vi.hoisted(() => ({
  product: 'trader' as 'trader' | 'nano' | undefined,
  focused: null as null | { kind: 'dev'; params: { tab: 'logs' | 'runs' | 'api' } }
    | { kind: 'automation'; params: { section: 'runs' | 'api' } },
  openOrFocus: vi.fn(),
  navigate: vi.fn(),
  guidance: { availableCount: 0, needsAttentionCount: 0 },
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))

vi.mock('../hooks/useUpdateLifecycle', () => ({ useUpdateLifecycle: () => ({ guidance: mocks.guidance }) }))

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
    trail,
  }: {
    label: string
    onClick: () => void
    ariaExpanded?: boolean
    trail?: ReactNode
  }) => (
    <button type="button" onClick={onClick} aria-expanded={ariaExpanded}>
      {label}{trail}
    </button>
  ),
}))

beforeEach(() => {
  window.sessionStorage.clear()
  mocks.focused = null
  mocks.openOrFocus.mockClear()
  mocks.navigate.mockClear()
  mocks.guidance = { availableCount: 0, needsAttentionCount: 0 }
})

afterEach(() => {
  cleanup()
  mocks.product = 'trader'
})

describe('SettingsCategoryList', () => {
  it('shows the update count on Overview, one level below Settings', () => {
    mocks.guidance = { availableCount: 1, needsAttentionCount: 0 }
    render(<SettingsCategoryList />)
    expect(screen.getByRole('button', { name: /settings.category.general/ }).textContent).toContain('1')
  })
  it('places Mode before Broker in Trading, outside General', () => {
    render(<SettingsCategoryList />)

    const general = screen.getByText('settings.group.general').parentElement?.parentElement
    const trading = screen.getByText('settings.group.trading').parentElement?.parentElement
    expect(general).not.toBeNull()
    expect(trading).not.toBeNull()
    expect(within(trading!).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'settings.category.agentPermissions',
      'settings.category.trading',
    ])
    expect(within(general!).queryByRole('button', { name: 'settings.category.agentPermissions' })).toBeNull()
    expect(within(general!).queryByRole('button', { name: 'settings.language.title' })).toBeNull()
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
    expect(mocks.navigate).toHaveBeenCalledWith('/settings/developer/logs')
  })

  it('automatically expands for a Developer deep link', () => {
    mocks.focused = { kind: 'dev', params: { tab: 'logs' } }
    render(<SettingsCategoryList />)

    expect(screen.getByRole('button', { name: 'settings.group.developer' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'common.logs' })).toBeTruthy()
  })

  it.each(['runs', 'api'] as const)('opens %s inside Developer and closes mobile navigation', (tab) => {
    const onSelect = vi.fn()
    render(<SettingsCategoryList onSelect={onSelect} />)
    expect(screen.queryByRole('button', { name: `automation.${tab}` })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'settings.group.developer' }))
    fireEvent.click(screen.getByRole('button', { name: `automation.${tab}` }))
    expect(mocks.navigate).toHaveBeenCalledWith(`/settings/developer/${tab}`)
    expect(onSelect).toHaveBeenCalledOnce()
  })

  it('expands Developer for a saved legacy Automation tab', () => {
    mocks.focused = { kind: 'automation', params: { section: 'runs' } }
    render(<SettingsCategoryList />)
    expect(screen.getByRole('button', { name: 'settings.group.developer' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: 'automation.runs' })).toBeTruthy()
  })
})

it('places Machines directly after Overview and opens its dedicated tab', () => {
  render(<SettingsCategoryList />)
  const names = screen.getAllByRole('button').map(button => button.textContent)
  expect(names.indexOf('settings.machines.title')).toBe(names.indexOf('settings.category.general') + 1)
  fireEvent.click(screen.getByRole('button', { name: 'settings.machines.title' }))
  expect(mocks.navigate).toHaveBeenCalledWith('/settings/machines')
})
