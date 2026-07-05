/**
 * Trading tool aggregation — partial-tolerance (issue #390).
 *
 * One offline / region-blocked account must NOT blank every healthy account's
 * data. These tests drive a fake manager whose accounts selectively reject,
 * and assert the aggregating tools (getAccount / getPortfolio / getOrders)
 * degrade per-account instead of throwing the whole result away.
 */
import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import { BrokerError } from '@traderalice/uta-protocol'
import { createTradingTools } from './trading.js'

type AccOpts = {
  account?: Record<string, unknown>
  positions?: unknown[]
  orders?: unknown[]
  fail?: boolean
  connecting?: boolean
  asVendor?: boolean
  contracts?: unknown[]
}

const DEFAULT_ACCOUNT = { netLiquidation: '10000', baseCurrency: 'USD', totalCashValue: '10000', unrealizedPnL: '0', realizedPnL: '0' }

function pos(symbol: string) {
  return {
    contract: { symbol, secType: 'CRYPTO', aliceId: `acc|${symbol}` },
    currency: 'USD', side: 'long',
    quantity: new Decimal(1), avgCost: '100', marketPrice: '110',
    marketValue: '110', unrealizedPnL: '10', realizedPnL: '0',
  }
}

function fakeAccount(id: string, o: AccOpts) {
  // `fail` → a real transient outage (NETWORK) → degraded bucket.
  // `connecting` → the broker connect is still in flight (CONNECTING, what
  // _callBroker throws during the initial-connect window) → connecting bucket,
  // NOT degraded.
  const guard = () => {
    if (o.connecting) throw new BrokerError('CONNECTING', `${id} is still connecting to the broker`)
    if (o.fail) throw new BrokerError('NETWORK', `${id} is offline and reconnecting`)
  }
  return {
    id, label: id,
    getAccount: async () => { guard(); return o.account ?? DEFAULT_ACCOUNT },
    getPositions: async () => { guard(); return o.positions ?? [] },
    getOrders: async () => { guard(); return o.orders ?? [] },
    searchContracts: async () => { guard(); return o.contracts ?? [] },
    getPendingOrderIds: () => [],
    asVendor: o.asVendor ?? true,
  }
}

function fakeManager(accounts: ReturnType<typeof fakeAccount>[]) {
  return {
    resolve: async (source?: string, _opts?: { tradingOnly?: boolean }) => source ? accounts.filter((a) => a.id === source) : accounts,
    listUTAs: async () => accounts.map((a) => ({ id: a.id, label: a.label, asVendor: a.asVendor })),
    getFxRates: async () => [],
  } as never
}

// The AI-SDK tool wrapper exposes `.execute(args, options)`; our impls ignore
// the second arg. Typed loosely to dodge the Tool's strict ToolExecuteFunction
// param variance.
function run(tool: { execute?: unknown }, args: unknown): Promise<unknown> {
  return (tool.execute as (a: unknown, o: unknown) => Promise<unknown>)(args, {})
}

describe('trading tools — partial tolerance (#390)', () => {
  it('getPortfolio returns healthy holdings + a degraded marker when one account is offline', async () => {
    const tools = createTradingTools(fakeManager([
      fakeAccount('binance-x', { positions: [pos('BTC')] }),
      fakeAccount('bybit-readonly', { fail: true }),
    ]))
    const res = await run(tools.getPortfolio, {}) as { positions: unknown[]; degraded: Array<{ source: string; transient: boolean }> }
    expect(res.positions).toHaveLength(1)
    expect(res.degraded).toHaveLength(1)
    expect(res.degraded[0].source).toBe('bybit-readonly')
    expect(res.degraded[0].transient).toBe(true)
  })

  it('getPortfolio returns a bare positions array (no degraded key) when all healthy', async () => {
    const tools = createTradingTools(fakeManager([
      fakeAccount('binance-x', { positions: [pos('BTC')] }),
      fakeAccount('alpaca', { positions: [pos('AAPL')] }),
    ]))
    const res = await run(tools.getPortfolio, {}) as unknown[]
    expect(Array.isArray(res)).toBe(true)
    expect(res).toHaveLength(2)
  })

  it('getAccount yields healthy account + error marker for the offline one', async () => {
    const tools = createTradingTools(fakeManager([
      fakeAccount('binance-x', {}),
      fakeAccount('bybit-readonly', { fail: true }),
    ]))
    const res = await run(tools.getAccount, {}) as Array<Record<string, unknown>>
    expect(res).toHaveLength(2)
    const healthy = res.find((r) => r.source === 'binance-x')!
    const broken = res.find((r) => r.source === 'bybit-readonly')!
    expect(healthy.netLiquidation).toBeDefined()
    expect(broken.error).toBeDefined()
    expect(broken.transient).toBe(true)
  })

  it('getAccount with a single offline account returns the error object directly', async () => {
    const tools = createTradingTools(fakeManager([fakeAccount('bybit-readonly', { fail: true })]))
    const res = await run(tools.getAccount, {}) as Record<string, unknown>
    expect(Array.isArray(res)).toBe(false)
    expect(res.error).toBeDefined()
    expect(res.source).toBe('bybit-readonly')
  })

  it('getAccount with a single healthy account returns the account object directly', async () => {
    const tools = createTradingTools(fakeManager([fakeAccount('binance-x', {})]))
    const res = await run(tools.getAccount, {}) as Record<string, unknown>
    expect(Array.isArray(res)).toBe(false)
    expect(res.source).toBe('binance-x')
    expect(res.netLiquidation).toBeDefined()
    expect(res.error).toBeUndefined()
  })

  it('getOrders returns healthy orders + degraded marker when one account is offline', async () => {
    const order = {
      orderId: 'o1', contract: { symbol: 'BTC', aliceId: 'acc|BTC' },
      orderState: { status: 'Submitted' }, order: { orderId: 1 },
    }
    const tools = createTradingTools(fakeManager([
      fakeAccount('binance-x', { orders: [order] }),
      fakeAccount('bybit-readonly', { fail: true }),
    ]))
    const res = await run(tools.getOrders, {}) as { orders: unknown[]; degraded: Array<{ source: string }> }
    expect(res.orders).toHaveLength(1)
    expect(res.degraded).toHaveLength(1)
    expect(res.degraded[0].source).toBe('bybit-readonly')
  })

  it('getOrders groupBy:contract degrades into { grouped, degraded } when an account fails', async () => {
    const order = {
      orderId: 'o1', contract: { symbol: 'BTC', aliceId: 'acc|BTC' },
      orderState: { status: 'Submitted' }, order: { orderId: 1 },
    }
    const tools = createTradingTools(fakeManager([
      fakeAccount('binance-x', { orders: [order] }),
      fakeAccount('bybit-readonly', { fail: true }),
    ]))
    const res = await run(tools.getOrders, { groupBy: 'contract' }) as { grouped: Record<string, unknown>; degraded: Array<{ source: string }> }
    expect(res.grouped['acc|BTC']).toBeDefined()
    expect(res.degraded).toHaveLength(1)
    expect(res.degraded[0].source).toBe('bybit-readonly')
  })

  it('getOrders groupBy:contract returns the bare grouped map when all healthy', async () => {
    const order = {
      orderId: 'o1', contract: { symbol: 'BTC', aliceId: 'acc|BTC' },
      orderState: { status: 'Submitted' }, order: { orderId: 1 },
    }
    const tools = createTradingTools(fakeManager([fakeAccount('binance-x', { orders: [order] })]))
    const res = await run(tools.getOrders, { groupBy: 'contract' }) as Record<string, unknown>
    expect(res['acc|BTC']).toBeDefined()
    expect(res.degraded).toBeUndefined()
  })
})

describe('searchContracts — data-source participation', () => {
  it('defaults to accounts with UTA data-source participation enabled', async () => {
    const tools = createTradingTools(fakeManager([
      fakeAccount('alpaca-paper', {
        contracts: [{ contract: { aliceId: 'alpaca-paper|AAPL', symbol: 'AAPL' }, derivativeSecTypes: [] }],
      }),
      fakeAccount('bybit-paper', {
        asVendor: false,
        contracts: [{ contract: { aliceId: 'bybit-paper|BTC/USDT', symbol: 'BTC' }, derivativeSecTypes: [] }],
      }),
    ]))

    const res = await run(tools.searchContracts, { pattern: 'AAPL' }) as Array<Record<string, unknown>>
    expect(res.map((r) => r.source)).toEqual(['alpaca-paper'])
  })

  it('allows an explicit source even when data-source participation is disabled', async () => {
    const tools = createTradingTools(fakeManager([
      fakeAccount('bybit-paper', {
        asVendor: false,
        contracts: [{ contract: { aliceId: 'bybit-paper|BTC/USDT', symbol: 'BTC' }, derivativeSecTypes: [] }],
      }),
    ]))

    const res = await run(tools.searchContracts, { pattern: 'BTC', source: 'bybit-paper' }) as Array<Record<string, unknown>>
    expect(res.map((r) => r.source)).toEqual(['bybit-paper'])
  })
})

/**
 * Cold-start non-blocking — an account still establishing its broker connection
 * surfaces as `connecting` (pending), NOT `degraded` (broken). This is what
 * stops the UI/agent from reporting a cold-starting account as a failure, and
 * is the aggregation half of the fix that made reads return fast instead of
 * blocking ~30s on CCXT loadMarkets.
 */
describe('trading tools — connecting state (cold-start)', () => {
  it('getPortfolio routes a still-connecting account to `connecting`, not `degraded`', async () => {
    const tools = createTradingTools(fakeManager([
      fakeAccount('binance-x', { positions: [pos('BTC')] }),
      fakeAccount('okx-readonly', { connecting: true }),
    ]))
    const res = await run(tools.getPortfolio, {}) as {
      positions: unknown[]; degraded?: unknown[]; connecting: Array<{ source: string; code: string; transient: boolean }>
    }
    expect(res.positions).toHaveLength(1)
    expect(res.degraded).toBeUndefined()
    expect(res.connecting).toHaveLength(1)
    expect(res.connecting[0].source).toBe('okx-readonly')
    expect(res.connecting[0].code).toBe('CONNECTING')
    expect(res.connecting[0].transient).toBe(true)
  })

  it('getPortfolio splits a real failure (degraded) from a pending connect (connecting) in one response', async () => {
    const tools = createTradingTools(fakeManager([
      fakeAccount('binance-x', { positions: [pos('BTC')] }),
      fakeAccount('bybit-readonly', { fail: true }),
      fakeAccount('okx-readonly', { connecting: true }),
    ]))
    const res = await run(tools.getPortfolio, {}) as {
      positions: unknown[]; degraded: Array<{ source: string }>; connecting: Array<{ source: string }>
    }
    expect(res.positions).toHaveLength(1)
    expect(res.degraded).toHaveLength(1)
    expect(res.degraded[0].source).toBe('bybit-readonly')
    expect(res.connecting).toHaveLength(1)
    expect(res.connecting[0].source).toBe('okx-readonly')
  })

  it('getOrders routes a connecting account to `connecting`, leaving `degraded` unset', async () => {
    const tools = createTradingTools(fakeManager([
      fakeAccount('binance-x', { orders: [] }),
      fakeAccount('okx-readonly', { connecting: true }),
    ]))
    const res = await run(tools.getOrders, {}) as { orders: unknown[]; degraded?: unknown[]; connecting: Array<{ source: string }> }
    expect(res.degraded).toBeUndefined()
    expect(res.connecting).toHaveLength(1)
    expect(res.connecting[0].source).toBe('okx-readonly')
  })

  it('getAccount surfaces a connecting account inline with code CONNECTING', async () => {
    const tools = createTradingTools(fakeManager([
      fakeAccount('binance-x', {}),
      fakeAccount('okx-readonly', { connecting: true }),
    ]))
    const res = await run(tools.getAccount, {}) as Array<Record<string, unknown>>
    expect(res).toHaveLength(2)
    expect(res.find((r) => r.source === 'okx-readonly')?.code).toBe('CONNECTING')
  })
})

describe('tradingPush — AI-trading gate (#95)', () => {
  function pushFixture() {
    let pushed = 0
    const uta = {
      id: 'binance-demo',
      status: async () => ({ pendingMessage: 'ready to push', staged: [], pendingHash: 'h1' }),
      push: async () => { pushed++; return { hash: 'h1', message: 'sent', operationCount: 1, submitted: [{}], rejected: [] } },
    }
    const manager = { resolve: async () => [uta] } as never
    return { manager, pushed: () => pushed }
  }

  it('does NOT execute the push when AI trading is disabled — returns a manual-approval message', async () => {
    const { manager, pushed } = pushFixture()
    const tools = createTradingTools(manager, () => false)
    const res = await run(tools.tradingPush, {}) as { message: string }
    expect(pushed()).toBe(0)
    expect(res.message).toMatch(/manual approval|disabled/i)
  })

  it('executes the push to the broker when AI trading is enabled', async () => {
    const { manager, pushed } = pushFixture()
    const tools = createTradingTools(manager, () => true)
    const res = await run(tools.tradingPush, {}) as { results: Array<{ source: string }> }
    expect(pushed()).toBe(1)
    expect(res.results[0].source).toBe('binance-demo')
  })

  it('fails closed — no flag getter defaults to disabled (no push)', async () => {
    const { manager, pushed } = pushFixture()
    const tools = createTradingTools(manager)
    await run(tools.tradingPush, {})
    expect(pushed()).toBe(0)
  })
})
