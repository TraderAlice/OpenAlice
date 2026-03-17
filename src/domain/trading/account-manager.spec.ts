import { describe, it, expect, beforeEach } from 'vitest'
import { ContractDescription } from '@traderalice/ibkr'
import { AccountManager } from './account-manager.js'
import { UnifiedTradingAccount } from './UnifiedTradingAccount.js'
import {
  MockBroker,
  makeContract,
} from './__test__/mock-broker.js'
import './contract-ext.js'

function makeUta(broker: MockBroker, platformId?: string): UnifiedTradingAccount {
  return new UnifiedTradingAccount(broker, { platformId })
}

describe('AccountManager', () => {
  let manager: AccountManager

  beforeEach(() => {
    manager = new AccountManager()
  })

  // ==================== Registration ====================

  describe('add / remove', () => {
    it('adds and retrieves a UTA', () => {
      const uta = makeUta(new MockBroker({ id: 'a1' }))
      manager.add(uta)

      expect(manager.get('a1')).toBe(uta)
      expect(manager.has('a1')).toBe(true)
      expect(manager.size).toBe(1)
    })

    it('throws on duplicate id', () => {
      manager.add(makeUta(new MockBroker({ id: 'a1' })))
      expect(() =>
        manager.add(makeUta(new MockBroker({ id: 'a1' }))),
      ).toThrow('already registered')
    })

    it('removes a UTA', () => {
      manager.add(makeUta(new MockBroker({ id: 'a1' })))
      manager.remove('a1')
      expect(manager.has('a1')).toBe(false)
      expect(manager.size).toBe(0)
    })

    it('returns undefined for unknown id', () => {
      expect(manager.get('nope')).toBeUndefined()
    })
  })

  // ==================== listAccounts ====================

  describe('listAccounts', () => {
    it('returns summaries of all accounts', () => {
      manager.add(makeUta(new MockBroker({ id: 'a1', provider: 'alpaca', label: 'Paper' })))
      manager.add(makeUta(new MockBroker({ id: 'a2', provider: 'ccxt', label: 'Bybit' })))

      const list = manager.listAccounts()
      expect(list).toHaveLength(2)
      expect(list[0].id).toBe('a1')
      expect(list[0].provider).toBe('alpaca')
      expect(list[1].id).toBe('a2')
    })

    it('includes platformId when provided', () => {
      manager.add(makeUta(new MockBroker({ id: 'a1', provider: 'alpaca' }), 'alpaca-paper'))
      manager.add(makeUta(new MockBroker({ id: 'a2', provider: 'ccxt' })))

      const list = manager.listAccounts()
      expect(list[0].platformId).toBe('alpaca-paper')
      expect(list[1].platformId).toBeUndefined()
    })
  })

  // ==================== resolve ====================

  describe('resolve', () => {
    it('returns all when no source', () => {
      manager.add(makeUta(new MockBroker({ id: 'a1' })))
      manager.add(makeUta(new MockBroker({ id: 'a2' })))
      expect(manager.resolve()).toHaveLength(2)
    })

    it('matches by id', () => {
      manager.add(makeUta(new MockBroker({ id: 'a1' })))
      manager.add(makeUta(new MockBroker({ id: 'a2' })))
      expect(manager.resolve('a1')).toHaveLength(1)
      expect(manager.resolve('a1')[0].id).toBe('a1')
    })

    it('matches by provider', () => {
      manager.add(makeUta(new MockBroker({ id: 'a1', provider: 'alpaca' })))
      manager.add(makeUta(new MockBroker({ id: 'a2', provider: 'ccxt' })))
      expect(manager.resolve('alpaca')).toHaveLength(1)
    })

    it('resolveOne throws on zero matches', () => {
      expect(() => manager.resolveOne('nope')).toThrow('No account found')
    })

    it('resolveOne throws on multiple matches', () => {
      manager.add(makeUta(new MockBroker({ id: 'a1', provider: 'ccxt' })))
      manager.add(makeUta(new MockBroker({ id: 'a2', provider: 'ccxt' })))
      expect(() => manager.resolveOne('ccxt')).toThrow('Multiple accounts')
    })
  })

  // ==================== getAggregatedEquity ====================

  describe('getAggregatedEquity', () => {
    it('aggregates equity across accounts', async () => {
      manager.add(makeUta(new MockBroker({ id: 'a1', label: 'A', accountInfo: { netLiquidation: 50_000, totalCashValue: 30_000, unrealizedPnL: 2_000, realizedPnL: 500 } })))
      manager.add(makeUta(new MockBroker({ id: 'a2', label: 'B', accountInfo: { netLiquidation: 75_000, totalCashValue: 60_000, unrealizedPnL: 3_000, realizedPnL: 1_000 } })))

      const result = await manager.getAggregatedEquity()
      expect(result.totalEquity).toBe(125_000)
      expect(result.totalCash).toBe(90_000)
      expect(result.totalUnrealizedPnL).toBe(5_000)
      expect(result.totalRealizedPnL).toBe(1_500)
      expect(result.accounts).toHaveLength(2)
    })

    it('returns zeros when no accounts', async () => {
      const result = await manager.getAggregatedEquity()
      expect(result.totalEquity).toBe(0)
      expect(result.accounts).toHaveLength(0)
    })
  })

  // ==================== searchContracts ====================

  describe('searchContracts', () => {
    it('searches all accounts by default', async () => {
      const a1 = new MockBroker({ id: 'a1' })
      const desc1 = new ContractDescription()
      desc1.contract = makeContract({ aliceId: 'a1-AAPL' })
      a1.searchContracts.mockResolvedValue([desc1])

      const a2 = new MockBroker({ id: 'a2' })
      const desc2 = new ContractDescription()
      desc2.contract = makeContract({ aliceId: 'a2-AAPL' })
      a2.searchContracts.mockResolvedValue([desc2])

      manager.add(makeUta(a1))
      manager.add(makeUta(a2))

      const results = await manager.searchContracts('AAPL')
      expect(results).toHaveLength(2)
    })

    it('scopes search to specific accountId', async () => {
      const a1 = new MockBroker({ id: 'a1' })
      const desc1 = new ContractDescription()
      desc1.contract = makeContract({ aliceId: 'a1-AAPL' })
      a1.searchContracts.mockResolvedValue([desc1])

      const a2 = new MockBroker({ id: 'a2' })
      const desc2 = new ContractDescription()
      desc2.contract = makeContract({ aliceId: 'a2-AAPL' })
      a2.searchContracts.mockResolvedValue([desc2])

      manager.add(makeUta(a1))
      manager.add(makeUta(a2))

      const results = await manager.searchContracts('AAPL', 'a1')
      expect(results).toHaveLength(1)
      expect(results[0].accountId).toBe('a1')
    })

    it('excludes accounts with no matches', async () => {
      const a1 = new MockBroker({ id: 'a1' })
      a1.searchContracts.mockResolvedValue([])
      const a2 = new MockBroker({ id: 'a2' })
      const desc = new ContractDescription()
      desc.contract = makeContract()
      a2.searchContracts.mockResolvedValue([desc])

      manager.add(makeUta(a1))
      manager.add(makeUta(a2))

      const results = await manager.searchContracts('AAPL')
      expect(results).toHaveLength(1)
      expect(results[0].accountId).toBe('a2')
    })
  })

  // ==================== getContractDetails ====================

  describe('getContractDetails', () => {
    it('returns details from specified account', async () => {
      manager.add(makeUta(new MockBroker({ id: 'a1' })))

      const query = makeContract({ symbol: 'AAPL' })
      const details = await manager.getContractDetails(query, 'a1')
      expect(details).not.toBeNull()
      expect(details!.contract.symbol).toBe('AAPL')
      expect(details!.longName).toBe('Apple Inc.')
    })

    it('returns null for unknown account', async () => {
      const query = makeContract({ symbol: 'AAPL' })
      const details = await manager.getContractDetails(query, 'nope')
      expect(details).toBeNull()
    })
  })

  // ==================== closeAll ====================

  describe('closeAll', () => {
    it('calls close on all accounts and clears entries', async () => {
      const b1 = new MockBroker({ id: 'a1' })
      const b2 = new MockBroker({ id: 'a2' })
      manager.add(makeUta(b1))
      manager.add(makeUta(b2))

      await manager.closeAll()

      expect(b1.close).toHaveBeenCalled()
      expect(b2.close).toHaveBeenCalled()
      expect(manager.size).toBe(0)
    })

    it('does not throw if one account fails to close', async () => {
      const b1 = new MockBroker({ id: 'a1' })
      b1.close.mockRejectedValue(new Error('close failed'))
      manager.add(makeUta(b1))

      await manager.closeAll()
      expect(manager.size).toBe(0)
    })
  })
})
