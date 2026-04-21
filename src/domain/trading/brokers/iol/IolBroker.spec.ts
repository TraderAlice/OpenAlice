import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import { BrokerError } from '../types.js'
import { IolBroker } from './IolBroker.js'
import { IolApiClient } from './iol-client.js'
import { decodeNativeKey, encodeNativeKey, makeContract, mapCurrency, mapIolOrderStatus } from './iol-contracts.js'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

function makeOrder(action = 'BUY', orderType = 'LMT'): Order {
  const order = new Order()
  order.action = action
  order.orderType = orderType
  order.totalQuantity = new Decimal(10)
  order.lmtPrice = 125.5
  order.tif = 'DAY'
  return order
}

describe('IolApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('authenticates with password grant and sends bearer token on requests', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        token_type: 'bearer',
        expires_in: 3600,
      }))
      .mockResolvedValueOnce(jsonResponse({ cuentas: [], totalEnPesos: 0 }))

    const client = new IolApiClient('user', 'pass', 'https://iol.test')
    const account = await client.getEstadoCuenta()

    expect(account).toEqual({ cuentas: [], totalEnPesos: 0 })
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://iol.test/token', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    }))
    expect(String(fetchMock.mock.calls[0][1].body)).toBe('username=user&password=pass&grant_type=password')
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://iol.test/api/v2/estadocuenta', expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer access-1' }),
    }))
  })

  it('refreshes tokens before expiry and reuses the refreshed bearer', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        token_type: 'bearer',
        expires_in: 1,
      }))
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'access-2',
        refresh_token: 'refresh-2',
        token_type: 'bearer',
        expires_in: 3600,
      }))
      .mockResolvedValueOnce(jsonResponse({ cuentas: [] }))

    const client = new IolApiClient('user', 'pass', 'https://iol.test')
    await client.authenticate()
    await client.getEstadoCuenta()

    expect(String(fetchMock.mock.calls[1][1].body)).toBe('refresh_token=refresh-1&grant_type=refresh_token')
    expect(fetchMock.mock.calls[2][1].headers.Authorization).toBe('Bearer access-2')
  })

  it('classifies token failures as auth errors', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad credentials', { status: 401 }))
    const client = new IolApiClient('bad', 'bad', 'https://iol.test')

    await expect(client.authenticate()).rejects.toMatchObject({
      code: 'AUTH',
      message: expect.stringContaining('/token failed (401)'),
    })
  })

  it('builds typed endpoint paths and JSON order bodies', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        token_type: 'bearer',
        expires_in: 3600,
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, numeroOperacion: 123 }))

    const client = new IolApiClient('user', 'pass', 'https://iol.test')
    const result = await client.comprar({
      mercado: 'bCBA',
      simbolo: 'GGAL',
      cantidad: 5,
      precio: 100,
      tipo: 'precioLimite',
      plazo: 't2',
      validez: '2026-04-21T20:00:00',
    })

    expect(result.numeroOperacion).toBe(123)
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://iol.test/api/v2/operar/Comprar', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        mercado: 'bCBA',
        simbolo: 'GGAL',
        cantidad: 5,
        precio: 100,
        tipo: 'precioLimite',
        plazo: 't2',
        validez: '2026-04-21T20:00:00',
      }),
    }))
  })
})

describe('IolBroker', () => {
  it('resolves credentials from env vars during init', async () => {
    vi.stubEnv('IOL_USERNAME', 'env-user')
    vi.stubEnv('IOL_PASSWORD', 'env-pass')
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      token_type: 'bearer',
      expires_in: 3600,
    }))
    vi.stubGlobal('fetch', fetchMock)

    const broker = new IolBroker({ id: 'iol-test', username: '', password: '', market: 'bCBA', sandbox: true })
    await broker.init()

    expect(String(fetchMock.mock.calls[0][1].body)).toBe('username=env-user&password=env-pass&grant_type=password')
  })

  it('throws a config error when credentials are missing', async () => {
    const broker = new IolBroker({ id: 'iol-test', username: '', password: '', market: 'bCBA', sandbox: true })
    await expect(broker.init()).rejects.toMatchObject({ code: 'CONFIG' })
  })

  it('maps limit buy orders to IOL Comprar payloads', async () => {
    const comprar = vi.fn().mockResolvedValue({ ok: true, numeroOperacion: 99 })
    const broker = new IolBroker({ id: 'iol-test', username: 'u', password: 'p', market: 'bCBA', sandbox: false })
    ;(broker as unknown as { client: unknown }).client = { comprar, vender: vi.fn() }

    const result = await broker.placeOrder(makeContract('ggal'), makeOrder('BUY', 'LMT'))

    expect(result).toMatchObject({ success: true, orderId: '99' })
    expect(comprar).toHaveBeenCalledWith(expect.objectContaining({
      mercado: 'bCBA',
      simbolo: 'GGAL',
      cantidad: 10,
      precio: 125.5,
      tipo: 'precioLimite',
      plazo: 't2',
    }))
  })

  it('maps market sell orders to IOL Vender payloads', async () => {
    const vender = vi.fn().mockResolvedValue({ ok: true, numeroOperacion: 100 })
    const broker = new IolBroker({ id: 'iol-test', username: 'u', password: 'p', market: 'bCBA', sandbox: false })
    ;(broker as unknown as { client: unknown }).client = { comprar: vi.fn(), vender }

    const result = await broker.placeOrder(makeContract('YPFD'), makeOrder('SELL', 'MKT'))

    expect(result).toMatchObject({ success: true, orderId: '100' })
    expect(vender).toHaveBeenCalledWith(expect.objectContaining({
      mercado: 'bCBA',
      simbolo: 'YPFD',
      tipo: 'precioMercado',
    }))
    expect(vender.mock.calls[0][0]).not.toHaveProperty('precio')
  })

  it('short-circuits orders in dry-run mode without requiring an initialized client', async () => {
    const broker = new IolBroker({ id: 'iol-test', username: 'u', password: 'p', market: 'bCBA', sandbox: true })
    const result = await broker.placeOrder(makeContract('GGAL'), makeOrder('BUY', 'MKT'))

    expect(result.success).toBe(true)
    expect(result.orderId).toMatch(/^dry-run-/)
    expect(result.message).toContain('DRY-RUN')
  })

  it('returns validation errors for unsupported order inputs', async () => {
    const broker = new IolBroker({ id: 'iol-test', username: 'u', password: 'p', market: 'bCBA', sandbox: false })
    const order = makeOrder('BUY', 'STP')

    const result = await broker.placeOrder(makeContract('GGAL'), order)

    expect(result.success).toBe(false)
    expect(result.error).toContain('does not support order type')
  })

  it('validates order action before dry-run success', async () => {
    const broker = new IolBroker({ id: 'iol-test', username: 'u', password: 'p', market: 'bCBA', sandbox: true })
    const order = makeOrder('HOLD', 'MKT')

    const result = await broker.placeOrder(makeContract('GGAL'), order)

    expect(result.success).toBe(false)
    expect(result.error).toContain('Unsupported order action')
  })

  it('aggregates ARS account values from estado cuenta', async () => {
    const broker = new IolBroker({ id: 'iol-test', username: 'u', password: 'p', market: 'bCBA', sandbox: false })
    ;(broker as unknown as { client: unknown }).client = {
      getEstadoCuenta: vi.fn().mockResolvedValue({
        cuentas: [
          { moneda: 'peso_Argentino', disponible: 1000, total: 1500 },
          { moneda: 'peso_Argentino', disponible: 250, total: 300 },
          { moneda: 'dolar_Estadounidense', disponible: 10, total: 10 },
        ],
        totalEnPesos: 2000,
      }),
    }

    const account = await broker.getAccount()

    expect(account).toMatchObject({
      baseCurrency: 'ARS',
      netLiquidation: '2000',
      totalCashValue: '1250',
      buyingPower: '1250',
      unrealizedPnL: '0',
    })
  })

  it('maps portfolio activos to positions', async () => {
    const broker = new IolBroker({ id: 'iol-test', username: 'u', password: 'p', market: 'bCBA', sandbox: false })
    ;(broker as unknown as { client: unknown }).client = {
      getPortafolio: vi.fn().mockResolvedValue({
        activos: [{
          cantidad: 2,
          ultimoPrecio: 120,
          ppc: 100,
          gananciaDinero: 40,
          valorizado: 240,
          titulo: { simbolo: 'GGAL', mercado: 'bCBA', moneda: 'peso_Argentino' },
        }],
      }),
    }

    const positions = await broker.getPositions()

    expect(positions).toHaveLength(1)
    expect(positions[0]).toMatchObject({
      currency: 'ARS',
      side: 'long',
      avgCost: '100',
      marketPrice: '120',
      marketValue: '240',
      unrealizedPnL: '40',
    })
    expect(positions[0].quantity.toString()).toBe('2')
    expect(positions[0].contract.symbol).toBe('GGAL')
  })

  it('maps quotes from cotizacion responses', async () => {
    const broker = new IolBroker({ id: 'iol-test', username: 'u', password: 'p', market: 'bCBA', sandbox: false })
    ;(broker as unknown as { client: unknown }).client = {
      getCotizacion: vi.fn().mockResolvedValue({
        ultimoPrecio: 120,
        maximo: 125,
        minimo: 118,
        volumenNominal: 10000,
        puntas: { precioCompra: 119, precioVenta: 121 },
        fecha: '2026-04-21T15:30:00Z',
      }),
    }

    const quote = await broker.getQuote(makeContract('GGAL'))

    expect(quote).toMatchObject({
      last: 120,
      bid: 119,
      ask: 121,
      volume: 10000,
      high: 125,
      low: 118,
    })
    expect(quote.timestamp.toISOString()).toBe('2026-04-21T15:30:00.000Z')
  })

  it('maps IOL operations to OpenOrder records', async () => {
    const broker = new IolBroker({ id: 'iol-test', username: 'u', password: 'p', market: 'bCBA', sandbox: false })
    ;(broker as unknown as { client: unknown }).client = {
      getOperaciones: vi.fn().mockResolvedValue([{
        numero: 123,
        tipo: 'Compra',
        estado: 'terminada',
        mercado: 'bCBA',
        simbolo: 'GGAL',
        cantidad: 10,
        cantidadOperada: 10,
        precio: 100,
        precioOperado: 99.5,
        modalidad: 'precioLimite',
      }]),
    }

    const orders = await broker.getOrders([])

    expect(orders).toHaveLength(1)
    expect(orders[0].contract.symbol).toBe('GGAL')
    expect(orders[0].order.action).toBe('BUY')
    expect(orders[0].order.orderType).toBe('LMT')
    expect(orders[0].orderState.status).toBe('Filled')
    expect(orders[0].avgFillPrice).toBe(99.5)
  })

  it('wraps client errors as BrokerError for account queries', async () => {
    const broker = new IolBroker({ id: 'iol-test', username: 'u', password: 'p', market: 'bCBA', sandbox: false })
    ;(broker as unknown as { client: unknown }).client = {
      getEstadoCuenta: vi.fn().mockRejectedValue(new Error('fetch failed')),
    }

    await expect(broker.getAccount()).rejects.toBeInstanceOf(BrokerError)
    await expect(broker.getAccount()).rejects.toMatchObject({ code: 'NETWORK' })
  })
})

describe('IOL contract helpers', () => {
  it('encodes and decodes native keys', () => {
    expect(encodeNativeKey('bCBA', 'ggal')).toBe('GGAL')
    expect(encodeNativeKey('nYSE', 'ko')).toBe('nYSE:KO')
    expect(decodeNativeKey('GGAL')).toEqual({ market: 'bCBA', symbol: 'GGAL' })
    expect(decodeNativeKey('nASDAQ:AAPL')).toEqual({ market: 'nASDAQ', symbol: 'AAPL' })
  })

  it('maps market hints and currencies', () => {
    const contract = makeContract('ypfd', 'nYSE')
    expect(contract).toMatchObject({
      symbol: 'YPFD',
      secType: 'STK',
      exchange: 'NYSE',
      currency: 'USD',
    })
    expect(mapCurrency('peso_Argentino')).toBe('ARS')
    expect(mapCurrency('dolar_Estadounidense')).toBe('USD')
  })

  it('maps IOL order statuses to IBKR-style statuses', () => {
    expect(mapIolOrderStatus('terminada')).toBe('Filled')
    expect(mapIolOrderStatus('pendiente')).toBe('Submitted')
    expect(mapIolOrderStatus('cancelada')).toBe('Cancelled')
    expect(mapIolOrderStatus('rechazada')).toBe('Inactive')
  })

  it('uses exchange hints when generating native keys', () => {
    const broker = new IolBroker({ id: 'iol-test', username: 'u', password: 'p', market: 'bCBA', sandbox: true })
    const contract = new Contract()
    contract.symbol = 'AAPL'
    contract.exchange = 'NASDAQ'

    expect(broker.getNativeKey(contract)).toBe('nASDAQ:AAPL')
    expect(broker.resolveNativeKey('nYSE:KO')).toMatchObject({
      symbol: 'KO',
      exchange: 'NYSE',
      currency: 'USD',
    })
  })
})
