import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { closePosition } = vi.hoisted(() => ({
  closePosition: vi.fn(),
}))

vi.mock('../../api/trading', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/trading')>()
  return {
    ...actual,
    tradingApi: {
      ...actual.tradingApi,
      closePosition,
    },
  }
})

import { tradingApi } from '../../api/trading'
import { OrderEntryDialog } from './OrderEntryDialog'

const pushResult = {
  hash: 'demo-order',
  message: 'Order sizing test',
  operationCount: 1,
  submitted: [{ action: 'placeOrder', success: true, orderId: 'order-1', status: 'Submitted' }],
  rejected: [],
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

function setupPlaceOrder() {
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

function setupClosePosition() {
  render(
    <OrderEntryDialog
      utaId="alpaca-paper"
      mode={{ kind: 'close', aliceId: 'alpaca-paper|AAPL', quantity: '120', symbol: 'AAPL' }}
      onClose={vi.fn()}
    />,
  )
}

describe('OrderEntryDialog sizing', () => {
  it('clears Quantity when Cash Qty becomes authoritative', async () => {
    const placeOrder = setupPlaceOrder()
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
    const placeOrder = setupPlaceOrder()
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
    setupPlaceOrder()
    fireEvent.click(screen.getByRole('button', { name: '▸ Show advanced (cash qty, TIF)' }))
    fireEvent.change(screen.getByPlaceholderText('50'), { target: { value: '100' } })

    fireEvent.click(screen.getByRole('button', { name: 'Limit' }))

    expect(screen.queryByPlaceholderText('50')).toBeNull()
    expect((screen.getByRole('button', { name: 'Place Order' }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('OrderEntryDialog close-position quantity guard', () => {
  it('blocks a quantity above the current position size', () => {
    setupClosePosition()

    fireEvent.change(screen.getByLabelText('Quantity to close'), { target: { value: '200' } })
    fireEvent.change(screen.getByLabelText('Commit Message — required'), { target: { value: 'Risk limit' } })

    expect(screen.getByText('Quantity cannot exceed the current position size (120).')).toBeTruthy()
    expect(screen.getByLabelText('Quantity to close').getAttribute('aria-invalid')).toBe('true')
    expect((screen.getByRole('button', { name: 'Close Position' }) as HTMLButtonElement).disabled).toBe(true)
    expect(closePosition).not.toHaveBeenCalled()
  })

  it('submits a valid partial close with the exact decimal string', async () => {
    closePosition.mockResolvedValue({
      hash: 'commit-1',
      message: 'Risk limit',
      operationCount: 1,
      submitted: [{ action: 'closePosition', success: true, status: 'filled' }],
      rejected: [],
    })
    setupClosePosition()

    fireEvent.change(screen.getByLabelText('Quantity to close'), { target: { value: '60.25' } })
    fireEvent.change(screen.getByLabelText('Commit Message — required'), { target: { value: 'Risk limit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close Position' }))

    await waitFor(() => expect(closePosition).toHaveBeenCalledWith('alpaca-paper', {
      aliceId: 'alpaca-paper|AAPL',
      symbol: 'AAPL',
      qty: '60.25',
      message: 'Risk limit',
    }))
  })

  it('allows clearing the quantity to request a full close', async () => {
    closePosition.mockResolvedValue({
      hash: 'commit-2',
      message: 'Exit',
      operationCount: 1,
      submitted: [{ action: 'closePosition', success: true, status: 'filled' }],
      rejected: [],
    })
    setupClosePosition()

    fireEvent.change(screen.getByLabelText('Quantity to close'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Commit Message — required'), { target: { value: 'Exit' } })
    fireEvent.click(screen.getByRole('button', { name: 'Close Position' }))

    await waitFor(() => expect(closePosition).toHaveBeenCalledWith('alpaca-paper', {
      aliceId: 'alpaca-paper|AAPL',
      symbol: 'AAPL',
      message: 'Exit',
    }))
  })
})
