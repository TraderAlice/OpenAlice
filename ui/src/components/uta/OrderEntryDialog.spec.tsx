import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { tradingApi } from '../../api/trading'
import { OrderEntryDialog } from './OrderEntryDialog'

const pushResult = {
  hash: 'demo-order',
  message: 'Order sizing test',
  operationCount: 1,
  submitted: [{ action: 'placeOrder', success: true, orderId: 'order-1', status: 'Submitted' }],
  rejected: [],
}

function setup() {
  const placeOrder = vi.spyOn(tradingApi, 'placeOrder').mockResolvedValue(pushResult)
  render(
    <OrderEntryDialog
      utaId="demo-paper"
      mode={{ kind: 'place' }}
      onClose={vi.fn()}
    />,
  )

  fireEvent.change(screen.getByPlaceholderText('okx-test|BTC/USDT'), {
    target: { value: 'demo-paper|AAPL' },
  })
  fireEvent.change(screen.getByPlaceholderText('Why are you placing this order?'), {
    target: { value: 'Order sizing test' },
  })

  return placeOrder
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('OrderEntryDialog sizing', () => {
  it('clears Quantity when Cash Qty becomes authoritative', async () => {
    const placeOrder = setup()
    const quantity = screen.getByPlaceholderText('0.001') as HTMLInputElement
    fireEvent.change(quantity, { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: '▸ Show advanced (cash qty, TIF)' }))
    const cashQty = screen.getByPlaceholderText('50') as HTMLInputElement
    fireEvent.change(cashQty, { target: { value: '100' } })

    expect(quantity.value).toBe('')
    expect(cashQty.value).toBe('100')

    fireEvent.click(screen.getByRole('button', { name: 'Place Order' }))
    await waitFor(() => expect(placeOrder).toHaveBeenCalledWith('demo-paper', expect.objectContaining({
      aliceId: 'demo-paper|AAPL',
      cashQty: '100',
    })))
    expect(placeOrder.mock.calls[0]?.[1]).not.toHaveProperty('totalQuantity')
  })

  it('clears Cash Qty when Quantity becomes authoritative', async () => {
    const placeOrder = setup()
    fireEvent.click(screen.getByRole('button', { name: '▸ Show advanced (cash qty, TIF)' }))
    const cashQty = screen.getByPlaceholderText('50') as HTMLInputElement
    fireEvent.change(cashQty, { target: { value: '100' } })
    const quantity = screen.getByPlaceholderText('0.001') as HTMLInputElement
    fireEvent.change(quantity, { target: { value: '2' } })

    expect(cashQty.value).toBe('')
    expect(quantity.value).toBe('2')

    fireEvent.click(screen.getByRole('button', { name: 'Place Order' }))
    await waitFor(() => expect(placeOrder).toHaveBeenCalledWith('demo-paper', expect.objectContaining({
      aliceId: 'demo-paper|AAPL',
      totalQuantity: '2',
    })))
    expect(placeOrder.mock.calls[0]?.[1]).not.toHaveProperty('cashQty')
  })

  it('removes Cash Qty when switching to a Limit order', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: '▸ Show advanced (cash qty, TIF)' }))
    fireEvent.change(screen.getByPlaceholderText('50'), { target: { value: '100' } })

    fireEvent.click(screen.getByRole('button', { name: 'Limit' }))

    expect(screen.queryByPlaceholderText('50')).toBeNull()
    expect((screen.getByRole('button', { name: 'Place Order' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
