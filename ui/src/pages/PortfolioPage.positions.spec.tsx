// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { PositionWithAccount } from './PortfolioPage'
import { PositionsTable } from './PortfolioPage'

const positions: PositionWithAccount[] = [
  {
    contract: {
      aliceId: 'alpaca-paper|AAPL',
      symbol: 'AAPL',
      secType: 'STK',
      currency: 'USD',
    },
    currency: 'USD',
    side: 'long',
    quantity: '72',
    avgCost: '285.85',
    marketPrice: '341.49',
    marketValue: '24587.28',
    unrealizedPnL: '4005.73',
    realizedPnL: '0',
    accountLabel: 'alpaca-paper',
    accountProvider: 'alpaca',
  },
  {
    contract: {
      aliceId: 'ibkr|SAP',
      symbol: 'SAP',
      secType: 'STK',
      currency: 'EUR',
    },
    currency: 'EUR',
    side: 'short',
    quantity: '4',
    avgCost: '250',
    marketPrice: '240',
    marketValue: '960',
    unrealizedPnL: '-40',
    realizedPnL: '0',
    accountLabel: 'ibkr-paper',
    accountProvider: 'ibkr',
  },
]

afterEach(cleanup)

describe('Portfolio positions responsive presentation', () => {
  it('keeps identity, market value, and PnL together in mobile summaries', () => {
    render(
      <PositionsTable
        positions={positions}
        fxRates={[{
          currency: 'EUR',
          rate: 1.15,
          source: 'live',
          updatedAt: '2026-07-29T00:00:00.000Z',
        }]}
      />,
    )

    const mobile = screen.getByTestId('portfolio-positions-mobile')
    const desktop = screen.getByTestId('portfolio-positions-desktop')
    expect(mobile.classList.contains('md:hidden')).toBe(true)
    expect(desktop.classList.contains('hidden')).toBe(true)
    expect(desktop.classList.contains('md:block')).toBe(true)

    const appleSummary = within(mobile).getByLabelText(
      'AAPL in alpaca-paper, market value $24,587.28, PnL +19.46%, +$4,005.73. Expand for position details.',
    )
    expect(appleSummary.textContent).toContain('AAPL')
    expect(appleSummary.textContent).toContain('alpaca-paper · USD')
    expect(appleSummary.textContent).toContain('$24,587.28')
    expect(appleSummary.textContent).toContain('+19.46%')
    expect(appleSummary.textContent).toContain('+$4,005.73')
  })

  it('reveals secondary position metrics without hiding the mobile summary', () => {
    render(
      <PositionsTable
        positions={positions}
        fxRates={[{
          currency: 'EUR',
          rate: 1.15,
          source: 'live',
          updatedAt: '2026-07-29T00:00:00.000Z',
        }]}
      />,
    )

    const mobile = screen.getByTestId('portfolio-positions-mobile')
    const sapSummary = within(mobile).getByLabelText(
      'SAP in ibkr-paper, market value €960.00, PnL -4.00%, -€40.00. Expand for position details.',
    )
    const details = sapSummary.closest('details')
    expect(details?.open).toBe(false)

    fireEvent.click(sapSummary)

    expect(details?.open).toBe(true)
    expect(within(details as HTMLElement).getByText('Quantity')).toBeTruthy()
    expect(within(details as HTMLElement).getByText('Average cost')).toBeTruthy()
    expect(within(details as HTMLElement).getByText('Current price')).toBeTruthy()
    expect(within(details as HTMLElement).getByText('USD value')).toBeTruthy()
    expect(within(details as HTMLElement).getByText('$1,104.00')).toBeTruthy()
  })

  it('preserves the dense comparison table for desktop layouts', () => {
    render(<PositionsTable positions={positions} fxRates={[]} />)

    const desktop = screen.getByTestId('portfolio-positions-desktop')
    expect(within(desktop).getByRole('columnheader', { name: 'Symbol' })).toBeTruthy()
    expect(within(desktop).getByRole('columnheader', { name: 'Mkt Value' })).toBeTruthy()
    expect(within(desktop).getByRole('columnheader', { name: 'PnL %' })).toBeTruthy()
    expect(within(desktop).getAllByRole('row')).toHaveLength(3)
  })
})
