import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

describe('UTADetailPage positions table', () => {
  it('identifies each close action by its contract', () => {
    const aapl = position('AAPL')
    const nvda = position('NVDA')
    const onCloseClick = vi.fn()

    render(
      <PositionsSection
        positions={[aapl, nvda]}
        onCloseClick={onCloseClick}
      />,
    )

    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close AAPL position' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Close NVDA position' }))

    expect(onCloseClick).toHaveBeenCalledWith(nvda)
  })
})
