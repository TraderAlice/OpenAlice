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
