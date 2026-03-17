import { describe, it, expect, beforeEach } from 'vitest'
import { ContractDescription } from '@traderalice/ibkr'
import { createTradingTools } from './trading.js'
import { AccountManager } from '@/domain/trading/account-manager.js'
import { UnifiedTradingAccount } from '@/domain/trading/UnifiedTradingAccount.js'
import { MockBroker, makePosition, makeContract } from '@/domain/trading/__test__/mock-broker.js'
import '@/domain/trading/contract-ext.js'

// ==================== Helpers ====================

function makeUta(broker: MockBroker): UnifiedTradingAccount {
  return new UnifiedTradingAccount(broker)
}

function makeManager(...brokers: MockBroker[]): AccountManager {
  const mgr = new AccountManager()
  for (const b of brokers) mgr.add(makeUta(b))
  return mgr
}

// ==================== resolve ====================

describe('AccountManager.resolve', () => {
  let mgr: AccountManager

  beforeEach(() => {
    mgr = makeManager(
      new MockBroker({ id: 'alpaca-paper', provider: 'alpaca', label: 'Alpaca Paper' }),
      new MockBroker({ id: 'bybit-main', provider: 'ccxt', label: 'Bybit Main' }),
    )
  })

  it('returns all UTAs when source is not provided', () => {
    const results = mgr.resolve()
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.id).sort()).toEqual(['alpaca-paper', 'bybit-main'])
  })

  it('returns single UTA by exact id', () => {
    const results = mgr.resolve('alpaca-paper')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('alpaca-paper')
  })

  it('returns all UTAs matching a provider name', () => {
    mgr.add(makeUta(new MockBroker({ id: 'binance-main', provider: 'ccxt', label: 'Binance' })))
    const results = mgr.resolve('ccxt')
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.id).sort()).toEqual(['binance-main', 'bybit-main'])
  })

  it('returns empty array when source matches nothing', () => {
    expect(mgr.resolve('nonexistent')).toHaveLength(0)
  })

  it('prefers id match over provider match', () => {
    mgr.add(makeUta(new MockBroker({ id: 'alpaca', provider: 'mock', label: 'Special' })))
    const results = mgr.resolve('alpaca')
    expect(results).toHaveLength(1)
    expect(results[0].id).toBe('alpaca')
  })
})

// ==================== resolveOne ====================

describe('AccountManager.resolveOne', () => {
  let mgr: AccountManager

  beforeEach(() => {
    mgr = makeManager(
      new MockBroker({ id: 'alpaca-paper', provider: 'alpaca' }),
      new MockBroker({ id: 'bybit-main', provider: 'ccxt' }),
    )
  })

  it('returns the single matching UTA', () => {
    const result = mgr.resolveOne('alpaca-paper')
    expect(result.id).toBe('alpaca-paper')
  })

  it('throws when no UTA matches', () => {
    expect(() => mgr.resolveOne('unknown-id')).toThrow('No account found matching source "unknown-id"')
  })

  it('throws with disambiguation info when multiple UTAs match provider', () => {
    mgr.add(makeUta(new MockBroker({ id: 'alpaca-live', provider: 'alpaca' })))
    expect(() => mgr.resolveOne('alpaca')).toThrow(/Multiple accounts match source "alpaca"/)
  })
})

// ==================== createTradingTools: listAccounts ====================

describe('createTradingTools — listAccounts', () => {
  it('returns summaries for all registered UTAs', async () => {
    const mgr = makeManager(new MockBroker({ id: 'acc1', provider: 'alpaca', label: 'Test' }))
    const tools = createTradingTools(mgr)
    const result = await (tools.listAccounts.execute as Function)({})
    expect(Array.isArray(result)).toBe(true)
    expect(result[0].id).toBe('acc1')
    expect(result[0].provider).toBe('alpaca')
  })
})

// ==================== createTradingTools: searchContracts ====================

describe('createTradingTools — searchContracts', () => {
  it('aggregates results from all UTAs', async () => {
    const a1 = new MockBroker({ id: 'acc1', provider: 'alpaca' })
    const a2 = new MockBroker({ id: 'acc2', provider: 'ccxt' })
    const desc1 = new ContractDescription()
    desc1.contract = makeContract({ symbol: 'AAPL' })
    const desc2 = new ContractDescription()
    desc2.contract = makeContract({ symbol: 'AAPL' })
    a1.searchContracts.mockResolvedValue([desc1])
    a2.searchContracts.mockResolvedValue([desc2])
    const mgr = makeManager(a1, a2)
    const tools = createTradingTools(mgr)
    const result = await (tools.searchContracts.execute as Function)({ pattern: 'AAPL' })
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(2)
    expect(result[0].source).toBe('acc1')
    expect(result[1].source).toBe('acc2')
  })

  it('returns no-results message when no UTAs found anything', async () => {
    const a1 = new MockBroker({ id: 'acc1' })
    a1.searchContracts.mockResolvedValue([])
    const mgr = makeManager(a1)
    const tools = createTradingTools(mgr)
    const result = await (tools.searchContracts.execute as Function)({ pattern: 'ZZZZ' })
    expect(result.results).toEqual([])
    expect(result.message).toContain('No contracts found')
  })

  it('returns error when no UTAs are registered', async () => {
    const mgr = new AccountManager()
    const tools = createTradingTools(mgr)
    const result = await (tools.searchContracts.execute as Function)({ pattern: 'AAPL' })
    expect(result.error).toBeTruthy()
  })

  it('skips UTAs that throw during searchContracts', async () => {
    const a1 = new MockBroker({ id: 'acc1' })
    const a2 = new MockBroker({ id: 'acc2' })
    a1.searchContracts.mockRejectedValue(new Error('connection error'))
    const desc = new ContractDescription()
    desc.contract = makeContract({ symbol: 'BTC' })
    a2.searchContracts.mockResolvedValue([desc])
    const mgr = makeManager(a1, a2)
    const tools = createTradingTools(mgr)
    const result = await (tools.searchContracts.execute as Function)({ pattern: 'BTC' })
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('acc2')
  })
})

// ==================== createTradingTools: getPortfolio ====================

describe('createTradingTools — getPortfolio', () => {
  it('returns all positions when symbol is omitted', async () => {
    const acc = new MockBroker({ id: 'acc1' })
    acc.setPositions([
      makePosition({ contract: makeContract({ symbol: 'AAPL' }) }),
      makePosition({ contract: makeContract({ symbol: 'TSLA' }) }),
    ])
    const mgr = makeManager(acc)
    const tools = createTradingTools(mgr)
    const result = await (tools.getPortfolio.execute as Function)({ source: 'acc1' })
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(2)
  })

  it('filters to specific symbol when provided', async () => {
    const acc = new MockBroker({ id: 'acc1' })
    acc.setPositions([
      makePosition({ contract: makeContract({ symbol: 'AAPL' }) }),
      makePosition({ contract: makeContract({ symbol: 'TSLA' }) }),
    ])
    const mgr = makeManager(acc)
    const tools = createTradingTools(mgr)
    const result = await (tools.getPortfolio.execute as Function)({ source: 'acc1', symbol: 'AAPL' })
    expect(Array.isArray(result)).toBe(true)
    expect(result).toHaveLength(1)
    expect(result[0].symbol).toBe('AAPL')
  })
})
