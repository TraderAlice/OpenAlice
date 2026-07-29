import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../api', () => ({
  api: {
    trading: {
      orderHistory: vi.fn().mockResolvedValue({ orders: [] }),
      tradeHistory: vi.fn().mockResolvedValue({ trades: [] }),
    },
  },
}))

import { OrdersArea } from './UTADetailPage'

afterEach(cleanup)

describe('UTADetailPage order views', () => {
  it('exposes the current view and its controlled content region', () => {
    render(<OrdersArea utaId="demo-paper" openOrders={[]} />)

    expect(screen.getByRole('group', { name: 'Order views' })).toBeTruthy()

    const open = screen.getByRole('button', { name: 'Open (0)' })
    const history = screen.getByRole('button', { name: 'History' })
    expect(open.getAttribute('aria-pressed')).toBe('true')
    expect(history.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('region', { name: 'Open orders' }).id).toBe('orders-open-panel')

    fireEvent.click(history)

    expect(open.getAttribute('aria-pressed')).toBe('false')
    expect(history.getAttribute('aria-pressed')).toBe('true')
    expect(history.getAttribute('aria-controls')).toBe('orders-history-panel')
    expect(screen.getByRole('region', { name: 'Order history' }).id).toBe('orders-history-panel')
  })
})
