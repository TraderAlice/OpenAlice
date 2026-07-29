// @vitest-environment jsdom

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import { DEMO_UTA_CRYPTO, DEMO_UTA_PAPER } from '../fixtures/trading'
import { tradingHandlers } from './trading'

const server = setupServer(...tradingHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

async function marketClock(utaId: string): Promise<{
  isOpen: boolean
  nextOpen?: string
  nextClose?: string
}> {
  const response = await fetch(`${baseUrl}/api/trading/uta/${utaId}/market-clock`)
  expect(response.status).toBe(200)
  return response.json()
}

describe('demo trading market clock', () => {
  it('models crypto accounts as always open without an exchange-session schedule', async () => {
    await expect(marketClock(DEMO_UTA_CRYPTO)).resolves.toEqual({ isOpen: true })
  })

  it('keeps scheduled market hours for securities accounts', async () => {
    const clock = await marketClock(DEMO_UTA_PAPER)

    expect(clock.isOpen).toBe(false)
    expect(clock.nextOpen).toBeTypeOf('string')
    expect(clock.nextClose).toBeTypeOf('string')
  })
})

describe('demo trading handlers', () => {
  it.each([
    ['place-order', 'placeOrder', 'demo-placeOrder-order'],
    ['close-position', 'closePosition', 'demo-closePosition-order'],
  ])('simulates a successful %s push without persistence', async (route, action, orderId) => {
    const response = await fetch(`${baseUrl}/api/trading/uta/demo-paper/wallet/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Demo trading intent' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      hash: `demo-${action}-commit`,
      message: 'Demo trading intent',
      operationCount: 1,
      submitted: [{ action, success: true, orderId, status: 'Simulated' }],
      rejected: [],
      simulated: true,
    })
  })

  it('echoes the requested order id for a simulated cancellation', async () => {
    const response = await fetch(`${baseUrl}/api/trading/uta/demo-paper/wallet/cancel-order`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ orderId: 'broker-order-42', message: 'Cancel stale order' }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      hash: 'demo-cancelOrder-commit',
      message: 'Cancel stale order',
      operationCount: 1,
      submitted: [{
        action: 'cancelOrder',
        success: true,
        orderId: 'broker-order-42',
        status: 'Simulated',
      }],
      rejected: [],
      simulated: true,
    })
  })
})
