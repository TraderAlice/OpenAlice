import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { OrderHistoryEntry } from '../api/types'
import { OrderHistoryTable } from './UTADetailPage'

const order: OrderHistoryEntry = {
  orderId: 'order-1',
  timestamp: '2026-07-28T04:03:00.000Z',
  contract: {
    aliceId: 'demo-paper|AAPL',
    symbol: 'AAPL',
    secType: 'STK',
    exchange: 'SMART',
    currency: 'USD',
  },
  side: 'BUY',
  orderType: 'LMT',
  quantity: '20',
  limitPrice: '188',
  status: 'filled',
  filledQty: '20',
  avgFillPrice: '187.92',
  source: 'alice',
  commitHash: 'commit-1',
  message: 'Add to the position after earnings',
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('UTADetailPage order history', () => {
  it('provides a keyboard-accessible details disclosure for each order', () => {
    render(<OrderHistoryTable orders={[order]} />)

    const details = screen.getByRole('button', { name: 'Show details for AAPL order' })
    expect(details.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(order.message)).toBeNull()

    fireEvent.click(details)

    const hide = screen.getByRole('button', { name: 'Hide details for AAPL order' })
    expect(hide.getAttribute('aria-expanded')).toBe('true')
    expect(hide.getAttribute('aria-controls')).toBe('order-history-details-0')
    expect(screen.getByText(order.message)).toBeTruthy()
  })

  it('uses a readable card layout when the available content width is narrow', async () => {
    class CompactResizeObserver {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element) {
        this.callback(
          [{ target, contentRect: { width: 540 } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        )
      }

      disconnect() {}
      unobserve() {}
    }
    vi.stubGlobal('ResizeObserver', CompactResizeObserver)

    render(<OrderHistoryTable orders={[order]} />)

    expect(await screen.findByRole('list', { name: 'Order history' })).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('Qty')).toBeTruthy()
    expect(screen.getByText('Limit')).toBeTruthy()
    expect(screen.getByText('Fill')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Show details for AAPL order' }))

    expect(screen.getByRole('button', { name: 'Hide details for AAPL order' }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(order.message)).toBeTruthy()
  })
})
