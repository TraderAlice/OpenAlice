// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FinancialStatementsPanel } from './FinancialStatementsPanel'

const mocks = vi.hoisted(() => ({
  balance: vi.fn(),
  income: vi.fn(),
  cashflow: vi.fn(),
}))

vi.mock('../../api/market', () => ({
  marketApi: {
    equity: {
      balance: mocks.balance,
      income: mocks.income,
      cashflow: mocks.cashflow,
    },
  },
}))

const statement = {
  period_ending: '2026-06-30',
  fiscal_period: 'FY',
  revenue: 416_160_000_000,
  total_assets: 350_000_000_000,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.balance.mockResolvedValue({ results: [statement], provider: 'test' })
  mocks.income.mockResolvedValue({ results: [statement], provider: 'test' })
  mocks.cashflow.mockResolvedValue({ results: [statement], provider: 'test' })
})

afterEach(cleanup)

describe('FinancialStatementsPanel', () => {
  it('stacks the title above equal-width, touch-friendly tabs on narrow screens', async () => {
    render(<FinancialStatementsPanel symbol="AAPL" />)

    const heading = screen.getByRole('heading', { name: 'Financial Statements' })
    expect(heading.closest('header')?.className).toContain('flex-col')
    expect(heading.closest('header')?.className).toContain('sm:flex-row')

    const tablist = screen.getByRole('tablist', { name: 'Financial statement type' })
    expect(tablist.className).toContain('grid-cols-3')
    expect(tablist.className).toContain('sm:flex')

    const income = screen.getByRole('tab', { name: 'Income' })
    expect(income.className).toContain('min-h-10')
    expect(income.className).toContain('sm:min-h-0')
    expect(income.getAttribute('aria-selected')).toBe('true')
    expect(await screen.findByText('416.16B')).toBeTruthy()
  })

  it('exposes the selected statement and loads another tab on activation', async () => {
    const user = userEvent.setup()
    render(<FinancialStatementsPanel symbol="AAPL" />)

    const balance = screen.getByRole('tab', { name: 'Balance' })
    expect(balance.getAttribute('aria-selected')).toBe('false')

    await user.click(balance)

    expect(balance.getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('tab', { name: 'Income' }).getAttribute('aria-selected')).toBe('false')
    expect(mocks.balance).toHaveBeenCalledWith('AAPL')
  })
})
