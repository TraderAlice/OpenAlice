// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { useWorkspace } from '../tabs/store'
import { getFocusedTab } from '../tabs/types'
import { PortfolioSidebar } from './PortfolioSidebar'

const mocks = vi.hoisted(() => ({
  pendingPush: 0,
}))

vi.mock('../hooks/useTradingConfig', () => ({
  useTradingConfig: () => ({
    utas: [
      {
        id: 'uta-1',
        label: 'Paper',
        presetId: 'alpaca-paper',
        enabled: true,
        guards: [],
        presetConfig: {},
        readOnly: false,
        asVendor: false,
      },
    ],
    loading: false,
  }),
}))

vi.mock('../live/trading-mode', () => ({
  ensureTradingModePolling: vi.fn(),
  useTradingMode: (selector: (state: {
    status: { mode: 'live' }
    loading: boolean
  }) => unknown) => selector({
    status: { mode: 'live' },
    loading: false,
  }),
}))

vi.mock('../live/trading-push', () => ({
  usePendingPushCount: () => mocks.pendingPush,
}))

beforeEach(async () => {
  mocks.pendingPush = 0
  window.localStorage.clear()
  await i18n.changeLanguage('en')
  useWorkspace.setState({
    tabs: {},
    tree: { kind: 'leaf', group: { id: 'g1', tabIds: [], activeTabId: null } },
    focusedGroupId: 'g1',
    selectedSidebar: null,
  })
})

afterEach(cleanup)

describe('PortfolioSidebar', () => {
  it('puts Trading as Git above the portfolio account list', () => {
    render(<PortfolioSidebar />)
    const rows = screen.getAllByRole('button')
    expect(rows[0]?.textContent).toContain('Trading as Git')
    expect(screen.getByRole('button', { name: 'All Accounts' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Paper' })).toBeTruthy()
  })

  it('opens Trading as Git from the first navigator row', () => {
    render(<PortfolioSidebar />)
    fireEvent.click(screen.getByRole('button', { name: 'Trading as Git' }))
    expect(getFocusedTab(useWorkspace.getState())?.spec).toEqual({
      kind: 'trading-as-git',
      params: {},
    })
  })

  it('shows a pending-push count on the Trading as Git row', () => {
    mocks.pendingPush = 3
    render(<PortfolioSidebar />)
    expect(screen.getByLabelText('3 pending to push')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Trading as Git/ }).textContent).toContain('3')
  })
})
