/**
 * Simulator routes spec — exercises the HTTP adapter and broker integration against a
 * real MockBroker, NOT vi.fn() stubs. Catches both the route-layer wiring
 * (params parsing, status codes) AND the underlying broker behaviour (a
 * markPrice flow through to a position update).
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createSimulatorRoutes } from '../../../services/uta/src/http/routes-simulator.js'
import { MockBroker } from '../../../services/uta/src/domain/trading/brokers/mock/MockBroker.js'
import type { UTAEngineContext } from '../../../services/uta/src/types.js'

interface FakeUTA {
  id: string
  label: string
  broker: MockBroker
}

function makeCtx(brokers: Record<string, MockBroker | object>): UTAEngineContext {
  const utas = new Map<string, FakeUTA>()
  for (const [id, b] of Object.entries(brokers)) {
    utas.set(id, { id, label: id, broker: b as MockBroker })
  }
  return {
    utaManager: {
      get: (id: string) => utas.get(id),
      resolve: () => [...utas.values()],
      listUTAs: () => [...utas.values()].map(u => ({ id: u.id, label: u.label })),
    },
  } as unknown as UTAEngineContext
}

async function req(routes: ReturnType<typeof createSimulatorRoutes>, method: 'GET' | 'POST', path: string, body?: unknown) {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await routes.request(path, init)
  const json = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, body: json }
}

// ==================== Tests ====================

describe('GET /utas', () => {
  it('lists only UTAs whose broker is a MockBroker', async () => {
    const mock = new MockBroker({ id: 'sim' })
    const fake = { /* not a MockBroker */ } as object
    const routes = createSimulatorRoutes(makeCtx({ sim: mock, real: fake }))
    const { status, body } = await req(routes, 'GET', '/utas')
    expect(status).toBe(200)
    const utas = (body as { utas: Array<{ id: string }> }).utas
    expect(utas.map(u => u.id)).toEqual(['sim'])
  })
})

describe('GET /uta/:id/state', () => {
  let mock: MockBroker
  let routes: ReturnType<typeof createSimulatorRoutes>
  beforeEach(() => {
    mock = new MockBroker({ id: 'sim', cash: 50_000 })
    routes = createSimulatorRoutes(makeCtx({ sim: mock }))
  })

  it('returns full snapshot', async () => {
    mock.setMarkPrice('BTC', 80000)
    const { status, body } = await req(routes, 'GET', '/uta/sim/state')
    expect(status).toBe(200)
    expect((body as { cash: string }).cash).toBe('50000')
    expect((body as { markPrices: Array<{ nativeKey: string; price: string }> }).markPrices)
      .toEqual([{ nativeKey: 'BTC', price: '80000' }])
  })

  it('404 for unknown UTA', async () => {
    const { status } = await req(routes, 'GET', '/uta/missing/state')
    expect(status).toBe(404)
  })

  it('400 when broker is not a simulator', async () => {
    const fake = { /* not Mock */ } as object
    const r = createSimulatorRoutes(makeCtx({ real: fake }))
    const { status } = await req(r, 'GET', '/uta/real/state')
    expect(status).toBe(400)
  })
})

describe('POST /uta/:id/mark-price', () => {
  it('sets markPrice + auto-fills触达 limit orders', async () => {
    const mock = new MockBroker({ id: 'sim', cash: 100_000 })
    const routes = createSimulatorRoutes(makeCtx({ sim: mock }))

    // Place a BUY LMT @ 79000 — sits pending until price drops
    const { Contract, Order } = await import('@traderalice/ibkr')
    const Decimal = (await import('decimal.js')).default
    const contract = new Contract()
    contract.symbol = 'BTC'
    contract.localSymbol = 'BTC'
    contract.secType = 'CRYPTO'
    contract.exchange = 'MOCK'
    contract.currency = 'USD'
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(1)
    order.lmtPrice = new Decimal(79000)
    const placed = await mock.placeOrder(contract, order)
    expect(placed.success).toBe(true)

    // Initial price 80k → order stays pending
    await req(routes, 'POST', '/uta/sim/mark-price', { nativeKey: 'BTC', price: '80000' })
    expect(mock.getSimulatorState().pendingOrders).toHaveLength(1)

    // Price drops to 79000 → fills
    const { status, body } = await req(routes, 'POST', '/uta/sim/mark-price', { nativeKey: 'BTC', price: '79000' })
    expect(status).toBe(200)
    expect((body as { filled: string[] }).filled).toEqual([placed.orderId!])
    expect(mock.getSimulatorState().pendingOrders).toHaveLength(0)
    expect(mock.getSimulatorState().positions).toHaveLength(1)
  })

  it('rejects malformed body with 400', async () => {
    const mock = new MockBroker({ id: 'sim' })
    const routes = createSimulatorRoutes(makeCtx({ sim: mock }))
    const { status } = await req(routes, 'POST', '/uta/sim/mark-price', { wrongField: 'x' })
    expect(status).toBe(400)
  })
})

describe('POST /uta/:id/external-deposit', () => {
  it('adds a wallet-source position bypassing the order pipeline', async () => {
    const mock = new MockBroker({ id: 'sim' })
    const routes = createSimulatorRoutes(makeCtx({ sim: mock }))
    mock.setMarkPrice('BTC', 80000)

    const { status } = await req(routes, 'POST', '/uta/sim/external-deposit', {
      nativeKey: 'BTC',
      quantity: '1.0093',
      contract: { symbol: 'BTC', secType: 'CRYPTO' },
    })
    expect(status).toBe(200)

    const positions = await mock.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].quantity.toString()).toBe('1.0093')
    expect(positions[0].avgCostSource).toBe('wallet')
    // avgCost = markPrice (placeholder); UTA reconcile will replace.
    expect(positions[0].avgCost).toBe('80000')
  })
})

describe('POST /uta/:id/external-trade', () => {
  it('updates position + cash; tags wallet-source', async () => {
    const mock = new MockBroker({ id: 'sim', cash: 100_000 })
    const routes = createSimulatorRoutes(makeCtx({ sim: mock }))

    const { status } = await req(routes, 'POST', '/uta/sim/external-trade', {
      nativeKey: 'BTC',
      side: 'BUY',
      quantity: '0.5',
      price: '60000',
      contract: { symbol: 'BTC', secType: 'CRYPTO' },
    })
    expect(status).toBe(200)

    const positions = await mock.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].avgCost).toBe('60000')
    expect(positions[0].avgCostSource).toBe('wallet')

    const account = await mock.getAccount()
    expect(account.totalCashValue).toBe('70000')  // 100k - 30k
  })
})

describe('POST /uta/:id/orders/:orderId/fill', () => {
  it('manually fills a pending order at default markPrice', async () => {
    const mock = new MockBroker({ id: 'sim', cash: 100_000 })
    const routes = createSimulatorRoutes(makeCtx({ sim: mock }))
    mock.setMarkPrice('BTC', 80000)

    const { Contract, Order } = await import('@traderalice/ibkr')
    const Decimal = (await import('decimal.js')).default
    const contract = new Contract()
    contract.symbol = 'BTC'
    contract.localSymbol = 'BTC'
    contract.secType = 'CRYPTO'
    contract.exchange = 'MOCK'
    contract.currency = 'USD'
    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(0.5)
    order.lmtPrice = new Decimal(70000)  // would not auto-fill at 80k
    const placed = await mock.placeOrder(contract, order)

    const { status } = await req(routes, 'POST', `/uta/sim/orders/${placed.orderId}/fill`, {})
    expect(status).toBe(200)
    expect(mock.getSimulatorState().pendingOrders).toHaveLength(0)
  })

  it('400 for unknown orderId', async () => {
    const mock = new MockBroker({ id: 'sim' })
    const routes = createSimulatorRoutes(makeCtx({ sim: mock }))
    const { status } = await req(routes, 'POST', '/uta/sim/orders/missing/fill', {})
    expect(status).toBe(400)
  })
})
