// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Position } from '../api/types'
import { PositionsSection } from './UTADetailPage'

function position(symbol: string): Position {
  return {
    contract: {
      aliceId: `demo-paper|${symbol}`,
      symbol,
      secType: 'STK',
      exchange: 'SMART',
      currency: 'USD',
    },
    currency: 'USD',
    side: 'long',
    quantity: '10',
    avgCost: '100',
    marketPrice: '110',
    marketValue: '1100',
    unrealizedPnL: '100',
    realizedPnL: '0',
  }
}

afterEach(cleanup)

describe('UTADetailPage responsive positions', () => {
  it('keeps the comparison table for desktop and identifies each close action', () => {
    const aapl = position('AAPL')
    const nvda = position('NVDA')
    const onCloseClick = vi.fn()

    render(
      <PositionsSection
        positions={[aapl, nvda]}
        onCloseClick={onCloseClick}
      />,
    )

    const desktop = screen.getByTestId('uta-positions-desktop')
    expect(desktop.className).toContain('hidden')
    expect(desktop.className).toContain('md:block')
    expect(within(desktop).getByRole('columnheader', { name: 'Actions' })).toBeTruthy()
    expect(within(desktop).getByRole('button', { name: 'Close AAPL position' })).toBeTruthy()

    fireEvent.click(within(desktop).getByRole('button', { name: 'Close NVDA position' }))

    expect(onCloseClick).toHaveBeenCalledWith(nvda)
  })

  it('keeps value and PnL visible in mobile summaries before revealing a safe close action', () => {
    const aapl = position('AAPL')
    const onCloseClick = vi.fn()

    render(
      <PositionsSection
        positions={[aapl]}
        onCloseClick={onCloseClick}
      />,
    )

    const mobile = screen.getByTestId('uta-positions-mobile')
    expect(mobile.className).toContain('md:hidden')
    const summary = within(mobile).getByLabelText(
      'AAPL long position, market value $1,100.00, PnL +$100.00, +10.00%. Expand for position details.',
    )
    expect(summary.textContent).toContain('AAPL')
    expect(summary.textContent).toContain('$1,100.00')
    expect(summary.textContent).toContain('+$100.00')
    expect(summary.textContent).toContain('+10.00%')

    const details = summary.closest('details')
    expect(details?.open).toBe(false)
    fireEvent.click(summary)
    expect(details?.open).toBe(true)
    expect(within(details as HTMLElement).getByText('Quantity')).toBeTruthy()
    expect(within(details as HTMLElement).getByText('Average cost')).toBeTruthy()
    expect(within(details as HTMLElement).getByText('Current price')).toBeTruthy()

    const close = within(details as HTMLElement).getByRole('button', { name: 'Close AAPL position' })
    expect(close.className).toContain('min-h-10')
    fireEvent.click(close)
    expect(onCloseClick).toHaveBeenCalledWith(aapl)
  })
})
