// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SimulatorState } from '../../api/simulator'
import { ActionPanel } from './ActionPanel'
import { EventLog } from './EventLog'
import { MarkPrices } from './MarkPrices'
import { PendingOrders } from './PendingOrders'
import { Positions } from './Positions'

afterEach(cleanup)

const sampleState: SimulatorState = {
  cash: '100000',
  markPrices: [{ nativeKey: 'CRYPTO:BTC', price: '65000' }],
  positions: [
    {
      nativeKey: 'CRYPTO:BTC',
      symbol: 'BTC',
      secType: 'CRYPTO',
      side: 'long',
      quantity: '1.5',
      avgCost: '60000',
    },
  ],
  pendingOrders: [
    {
      orderId: 'ord-1',
      nativeKey: 'CRYPTO:BTC',
      symbol: 'BTC',
      action: 'BUY',
      orderType: 'LMT',
      totalQuantity: '0.5',
      lmtPrice: '64000',
    },
  ],
}

describe('Simulator panels forms and table semantics', () => {
  it('uses native form submission and explicit aria-labels in ActionPanel', () => {
    const run = vi.fn(async () => undefined)
    render(<ActionPanel utaId="sim-1" state={sampleState} run={run} loading={false} />)

    const exactInput = screen.getByLabelText('Exact mark price')
    fireEvent.change(exactInput, { target: { value: '66000' } })
    fireEvent.submit(exactInput.closest('form')!)
    expect(run).toHaveBeenCalledWith('Set CRYPTO:BTC = 66000', expect.any(Function))

    // Non-submit tick buttons must carry type="button" so clicking them does not submit the form
    expect((screen.getByRole('button', { name: '+1%' }) as HTMLButtonElement).type).toBe('button')
    expect((screen.getByRole('button', { name: 'Set' }) as HTMLButtonElement).type).toBe('submit')
  })

  it('guards inline Enter against IME composition and uses native form + table semantics in MarkPrices', () => {
    const run = vi.fn(async () => undefined)
    render(<MarkPrices utaId="sim-1" state={sampleState} run={run} loading={false} />)

    const headers = screen.getAllByRole('columnheader')
    for (const th of headers) {
      expect(th.getAttribute('scope')).toBe('col')
    }

    const inlinePrice = screen.getByLabelText('Mark price for CRYPTO:BTC') as HTMLInputElement
    expect(inlinePrice.className).toContain('tabular-nums')
    fireEvent.change(inlinePrice, { target: { value: '67000' } })

    fireEvent.keyDown(inlinePrice, { key: 'Enter', isComposing: true })
    expect(run).not.toHaveBeenCalled()

    fireEvent.keyDown(inlinePrice, { key: 'Enter', keyCode: 229 })
    expect(run).not.toHaveBeenCalled()

    fireEvent.keyDown(inlinePrice, { key: 'Enter', isComposing: false, keyCode: 13 })
    expect(run).toHaveBeenCalledWith('Set CRYPTO:BTC = 67000', expect.any(Function))

    const addSymbol = screen.getByLabelText('New mark symbol')
    const addPrice = screen.getByLabelText('New mark price')
    fireEvent.change(addSymbol, { target: { value: 'ETH' } })
    fireEvent.change(addPrice, { target: { value: '3500' } })
    fireEvent.submit(addPrice.closest('form')!)
    expect(run).toHaveBeenCalledWith('Add ETH = 3500', expect.any(Function))
  })

  it('renders scrollable regions, column scopes, and tabular numerals in Positions and PendingOrders', () => {
    const run = vi.fn(async () => undefined)
    render(
      <>
        <Positions state={sampleState} />
        <PendingOrders utaId="sim-1" state={sampleState} run={run} loading={false} />
      </>,
    )

    const positionsRegion = screen.getByRole('region', { name: 'Positions' })
    expect(positionsRegion.className).toContain('overflow-x-auto')
    expect(positionsRegion.tabIndex).toBe(0)

    const ordersRegion = screen.getByRole('region', { name: 'Pending orders' })
    expect(ordersRegion.className).toContain('overflow-x-auto')
    expect(ordersRegion.tabIndex).toBe(0)

    for (const th of screen.getAllByRole('columnheader')) {
      expect(th.getAttribute('scope')).toBe('col')
    }

    expect(screen.getByText('1.5').className).toContain('tabular-nums')
    expect(screen.getByText('60000').className).toContain('tabular-nums')
    expect(screen.getByText('+7500.00').className).toContain('tabular-nums')
    expect(screen.getByText('0.5').className).toContain('tabular-nums')
    expect(screen.getByText('64000').className).toContain('tabular-nums')
    expect(screen.getByText('+1000.00').className).toContain('tabular-nums')
  })

  it('formats EventLog timestamps with 24-hour Intl.DateTimeFormat and tabular numerals', () => {
    const ts = new Date(2026, 6, 16, 14, 5, 9).getTime()
    render(
      <EventLog
        events={[{ id: 1, ts, label: 'Set CRYPTO:BTC = 65000', status: 'ok' }]}
      />,
    )

    const expected = new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(ts))

    const timeCell = screen.getByText(expected)
    expect(timeCell.className).toContain('tabular-nums')
  })
})
