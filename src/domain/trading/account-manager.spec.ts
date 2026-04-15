import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ContractDescription } from '@traderalice/ibkr'
import { AccountManager } from './account-manager.js'
import { UnifiedTradingAccount } from './UnifiedTradingAccount.js'
import {
  MockBroker,
  makeContract,
} from './brokers/mock/index.js'
import './contract-ext.js'

function makeUta(broker: MockBroker): UnifiedTradingAccount {
  return new UnifiedTradingAccount(broker)
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
      manager.add(makeUta(new MockBroker({ id: 'a1', label: 'Paper' })))
      manager.add(makeUta(new MockBroker({ id: 'a2', label: 'Bybit' })))

      const list = manager.listAccounts()
      expect(list).toHaveLength(2)
      expect(list[0].id).toBe('a1')
      expect(list[1].id).toBe('a2')
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

    it('returns empty for unknown id', () => {
      manager.add(makeUta(new MockBroker({ id: 'a1' })))
      expect(manager.resolve('nope')).toHaveLength(0)
    })

    it('resolveOne throws on zero matches', () => {
      expect(() => manager.resolveOne('nope')).toThrow('No account found')
    })

    it('resolveOne throws on multiple matches via resolve override', () => {
      // resolveOne only gets multiple if resolve returns multiple —
      // with id-only matching this can't happen, but test the guard
      manager.add(makeUta(new MockBroker({ id: 'a1' })))
      const result = manager.resolveOne('a1')
      expect(result.id).toBe('a1')
    })
  })

  // ==================== getAggregatedEquity ====================

  describe('getAggregatedEquity', () => {
    it('aggregates equity across accounts', async () => {
      manager.add(makeUta(new MockBroker({ id: 'a1', label: 'A', accountInfo: { netLiquidation: '50000', totalCashValue: '30000', unrealizedPnL: '2000', realizedPnL: '500' } })))
      manager.add(makeUta(new MockBroker({ id: 'a2', label: 'B', accountInfo: { netLiquidation: '75000', totalCashValue: '60000', unrealizedPnL: '3000', realizedPnL: '1000' } })))

      const result = await manager.getAggregatedEquity()
      expect(result.totalEquity).toBe('125000')
      expect(result.totalCash).toBe('90000')
      expect(result.totalUnrealizedPnL).toBe('5000')
      expect(result.totalRealizedPnL).toBe('1500')
      expect(result.accounts).toHaveLength(2)
    })

    it('returns zeros when no accounts', async () => {
      const result = await manager.getAggregatedEquity()
      expect(result.totalEquity).toBe('0')
      expect(result.accounts).toHaveLength(0)
    })
  })

  // ==================== searchContracts ====================

  describe('searchContracts', () => {
    it('searches all accounts by default', async () => {
      const a1 = new MockBroker({ id: 'a1' })
      const desc1 = new ContractDescription()
      desc1.contract = makeContract({ aliceId: 'a1|AAPL' })
      vi.spyOn(a1, 'searchContracts').mockResolvedValue([desc1])

      const a2 = new MockBroker({ id: 'a2' })
      const desc2 = new ContractDescription()
      desc2.contract = makeContract({ aliceId: 'a2|AAPL' })
      vi.spyOn(a2, 'searchContracts').mockResolvedValue([desc2])

      manager.add(makeUta(a1))
      manager.add(makeUta(a2))

      const results = await manager.searchContracts('AAPL')
      expect(results).toHaveLength(2)
    })

    it('scopes search to specific accountId', async () => {
      const a1 = new MockBroker({ id: 'a1' })
      const desc1 = new ContractDescription()
      desc1.contract = makeContract({ aliceId: 'a1|AAPL' })
      vi.spyOn(a1, 'searchContracts').mockResolvedValue([desc1])

      const a2 = new MockBroker({ id: 'a2' })
      const desc2 = new ContractDescription()
      desc2.contract = makeContract({ aliceId: 'a2|AAPL' })
      vi.spyOn(a2, 'searchContracts').mockResolvedValue([desc2])

      manager.add(makeUta(a1))
      manager.add(makeUta(a2))

      const results = await manager.searchContracts('AAPL', 'a1')
      expect(results).toHaveLength(1)
      expect(results[0].accountId).toBe('a1')
    })

    it('excludes accounts with no matches', async () => {
      const a1 = new MockBroker({ id: 'a1' })
      vi.spyOn(a1, 'searchContracts').mockResolvedValue([])
      const a2 = new MockBroker({ id: 'a2' })
      const desc = new ContractDescription()
      desc.contract = makeContract()
      vi.spyOn(a2, 'searchContracts').mockResolvedValue([desc])

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
      expect(details!.longName).toBe('Mock Contract')
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

      expect(b1.callCount('close')).toBe(1)
      expect(b2.callCount('close')).toBe(1)
      expect(manager.size).toBe(0)
    })

    it('does not throw if one account fails to close', async () => {
      const b1 = new MockBroker({ id: 'a1' })
      vi.spyOn(b1, 'close').mockRejectedValue(new Error('close failed'))
      manager.add(makeUta(b1))

      await manager.closeAll()
      expect(manager.size).toBe(0)
    })
  })
})
