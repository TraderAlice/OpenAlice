// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { UTASnapshotSummary } from '../api'
import { SnapshotDetail } from './SnapshotDetail'

afterEach(cleanup)

const snapshot = {
  timestamp: '2026-08-31T20:00:00.000Z',
  health: 'healthy',
  trigger: 'manual',
  accountId: 'paper-1',
  account: {
    baseCurrency: 'USD',
    netLiquidation: '1200',
    totalCashValue: '700',
    unrealizedPnL: '40',
    realizedPnL: '15',
  },
  positions: [{
    aliceId: 'paper-1|AAPL',
    side: 'long',
    currency: 'USD',
    quantity: '10',
    avgCost: '180',
    marketPrice: '184',
    marketValue: '1840',
    unrealizedPnL: '40',
    realizedPnL: '0',
  }],
  openOrders: [],
} satisfies UTASnapshotSummary

describe('SnapshotDetail', () => {
  it('keeps currency and quantity under their matching columns', () => {
    render(<SnapshotDetail snapshot={snapshot} onClose={vi.fn()} />)

    const row = screen.getByText('AAPL').closest('tr')
    expect(row).toBeTruthy()
    const cells = within(row as HTMLElement).getAllByRole('cell')
    expect(cells[1]?.textContent).toBe('USD')
    expect(cells[2]?.textContent).toBe('10')
  })

  it('exposes the close action by name', () => {
    const onClose = vi.fn()
    render(<SnapshotDetail snapshot={snapshot} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close snapshot' }))
    expect(onClose).toHaveBeenCalledOnce()
  })
})
