import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Decimal from 'decimal.js'
import { Contract } from '@traderalice/ibkr'
import '../../contract-ext.js'

let home: string
let savedHome: string | undefined
let tokenPath: string

async function loadBrokerModule() {
  vi.resetModules()
  process.env['OPENALICE_HOME'] = home
  const [broker, sealing] = await Promise.all([
    import('./SchwabBroker.js'),
    import('@/core/sealing.js'),
  ])
  return { SchwabBroker: broker.SchwabBroker, sealing }
}

describe('SchwabBroker', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    savedHome = process.env['OPENALICE_HOME']
    home = await mkdtemp(resolve(tmpdir(), 'openalice-schwab-'))
    tokenPath = join(home, 'data', 'trading', 'schwab-test', 'schwab-token.json')
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/v1/oauth/token')) {
        return new Response(JSON.stringify({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 1800,
          token_type: 'Bearer',
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/trader/v1/accounts')) {
        return new Response(JSON.stringify([
          {
            accountNumber: '123456789',
            currentBalances: {
              cashBalance: '1000.00',
              liquidationValue: '1500.00',
              buyingPower: '2000.00',
            },
            positions: [
              {
                symbol: 'AAPL',
                longQuantity: 1,
                averagePrice: '450.00',
                marketValue: '500.00',
                currentDayProfitLoss: '50.00',
                instrument: {
                  assetType: 'EQUITY',
                  symbol: 'AAPL',
                  description: 'Apple Inc.',
                  exchange: 'NASDAQ',
                  currency: 'USD',
                },
              },
            ],
          },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected fetch: ${url} ${init?.method ?? 'GET'}`)
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(async () => {
    if (savedHome === undefined) delete process.env['OPENALICE_HOME']
    else process.env['OPENALICE_HOME'] = savedHome
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('refreshes token, seals the token file, and reads account / positions', async () => {
    const { SchwabBroker, sealing } = await loadBrokerModule()
    const broker = new SchwabBroker({
      id: 'schwab-test',
      clientId: 'cid',
      clientSecret: 'secret',
      refreshToken: 'refresh-initial',
    })

    await expect(broker.init()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalled()

    const account = await broker.getAccount()
    expect(account.baseCurrency).toBe('USD')
    expect(account.netLiquidation).toBe('1500')
    expect(account.totalCashValue).toBe('1000')
    expect(account.unrealizedPnL).toBe('50')

    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].contract.symbol).toBe('AAPL')
    expect(positions[0].contract.secType).toBe('STK')
    expect(positions[0].quantity.toString()).toBe('1')

    const persisted = JSON.parse(await readFile(tokenPath, 'utf-8'))
    expect(sealing.isSealedEnvelope(persisted)).toBe(true)
    expect(JSON.stringify(persisted)).not.toContain('access-1')
    expect(JSON.stringify(persisted)).not.toContain('refresh-1')
    if (process.platform !== 'win32') {
      expect((await stat(tokenPath)).mode & 0o777).toBe(0o600)
    }
  })

  it('loads a pre-sealed token file without calling the refresh endpoint', async () => {
    const { SchwabBroker, sealing } = await loadBrokerModule()
    await mkdir(resolve(tokenPath, '..'), { recursive: true })
    await writeFile(tokenPath, JSON.stringify(await sealing.seal({
      access_token: 'cached-access',
      refresh_token: 'cached-refresh',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    }), null, 2) + '\n')

    const broker = new SchwabBroker({
      id: 'schwab-test',
      clientId: 'cid',
      clientSecret: 'secret',
      tokenPath: './schwab-token.json',
    })

    await expect(broker.init()).resolves.toBeUndefined()
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/v1/oauth/token'))).toBe(false)
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/trader/v1/accounts'))).toBe(true)
  })

  it('refuses tokenPath values outside the account trading data dir', async () => {
    const { SchwabBroker } = await loadBrokerModule()
    const broker = new SchwabBroker({
      id: 'schwab-test',
      clientId: 'cid',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      tokenPath: join(home, 'escape.json'),
    })

    await expect(broker.init()).rejects.toThrow(/tokenPath must stay inside/i)
    expect(existsSync(join(home, 'escape.json'))).toBe(false)
  })

  it('uses hashValue as a fallback account selector', async () => {
    const { SchwabBroker } = await loadBrokerModule()
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/v1/oauth/token')) {
        return new Response(JSON.stringify({
          access_token: 'access-1',
          refresh_token: 'refresh-1',
          expires_in: 1800,
          token_type: 'Bearer',
        }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.includes('/trader/v1/accounts')) {
        return new Response(JSON.stringify([
          {
            accountNumber: 'primary-account',
            hashValue: 'shadow-account',
            currentBalances: {
              cashBalance: '1000.00',
              liquidationValue: '1500.00',
            },
            positions: [
              {
                symbol: 'MSFT',
                longQuantity: 2,
                marketValue: '600.00',
                instrument: {
                  assetType: 'EQUITY',
                  symbol: 'MSFT',
                  description: 'Microsoft Corp.',
                  exchange: 'NASDAQ',
                  currency: 'USD',
                },
              },
            ],
          },
        ]), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const broker = new SchwabBroker({
      id: 'schwab-test',
      clientId: 'cid',
      clientSecret: 'secret',
      refreshToken: 'refresh-initial',
      accountNumber: 'shadow-account',
    })

    await expect(broker.init()).resolves.toBeUndefined()
    const positions = await broker.getPositions()
    expect(positions).toHaveLength(1)
    expect(positions[0].contract.symbol).toBe('MSFT')
  })

  it('round-trips option native keys', async () => {
    const { SchwabBroker } = await loadBrokerModule()
    const broker = new SchwabBroker({
      clientId: 'cid',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      tokenPath,
    })
    const contract = new Contract()
    contract.symbol = 'AAPL'
    contract.secType = 'OPT'
    contract.exchange = 'SMART'
    contract.currency = 'USD'
    contract.lastTradeDateOrContractMonth = '20261217'
    contract.right = 'C'
    contract.strike = 150
    contract.multiplier = '100'

    const nativeKey = broker.getNativeKey(contract)
    const restored = broker.resolveNativeKey(nativeKey)
    expect(restored.secType).toBe('OPT')
    expect(restored.symbol).toBe('AAPL')
    expect(restored.lastTradeDateOrContractMonth).toBe('20261217')
    expect(restored.right).toBe('C')
    expect(restored.strike).toBe(150)
    expect(restored.multiplier).toBe('100')
  })

  it('refuses writes with a clear read-only error', async () => {
    const { SchwabBroker } = await loadBrokerModule()
    const broker = new SchwabBroker({
      clientId: 'cid',
      clientSecret: 'secret',
      refreshToken: 'refresh',
      tokenPath,
    })
    const result = await broker.placeOrder(new Contract(), {} as never)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/read-only/i)
  })
})
