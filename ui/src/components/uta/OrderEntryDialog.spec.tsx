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

import { OrderEntryDialog } from './OrderEntryDialog'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function setup() {
  render(
    <OrderEntryDialog
      utaId="alpaca-paper"
      mode={{ kind: 'close', aliceId: 'alpaca-paper|AAPL', quantity: '120', symbol: 'AAPL' }}
      onClose={vi.fn()}
    />,
  )
}

describe('OrderEntryDialog close-position quantity guard', () => {
  it('blocks a quantity above the current position size', () => {
    setup()

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
    setup()

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
    setup()

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
