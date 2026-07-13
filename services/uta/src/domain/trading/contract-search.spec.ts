import { describe, it, expect, vi } from 'vitest'
import { ContractDescription } from '@traderalice/ibkr'
import { searchTradeableContracts } from './contract-search.js'
import { UTAManager } from './uta-manager.js'
import { UnifiedTradingAccount } from './UnifiedTradingAccount.js'
import { MockBroker, makeContract } from './brokers/mock/index.js'
import './contract-ext.js'

function makeDesc(aliceId: string): ContractDescription {
  const desc = new ContractDescription()
  desc.contract = makeContract({ aliceId, symbol: aliceId.split('|')[1] })
  desc.derivativeSecTypes = []
  return desc
}

describe('searchTradeableContracts — data-source participation', () => {
  it('skips non-vendor UTAs during default aggregate search', async () => {
    const manager = new UTAManager()
    const enabled = new MockBroker({ id: 'enabled' })
    const disabled = new MockBroker({ id: 'disabled' })
    vi.spyOn(enabled, 'searchContracts').mockResolvedValue([makeDesc('enabled|AAPL')])
    const disabledSearch = vi.spyOn(disabled, 'searchContracts').mockResolvedValue([makeDesc('disabled|AAPL')])

    manager.add(new UnifiedTradingAccount(enabled))
    manager.add(new UnifiedTradingAccount(disabled, { asVendor: false }))

    const hits = await searchTradeableContracts(manager, 'AAPL')
    expect(hits.map((h) => h.source)).toEqual(['enabled'])
    expect(disabledSearch).not.toHaveBeenCalled()
  })

  it('allows explicit source search even when asVendor is disabled', async () => {
    const manager = new UTAManager()
    const disabled = new MockBroker({ id: 'disabled' })
    const disabledSearch = vi.spyOn(disabled, 'searchContracts').mockResolvedValue([makeDesc('disabled|AAPL')])

    manager.add(new UnifiedTradingAccount(disabled, { asVendor: false }))

    const hits = await searchTradeableContracts(manager, 'AAPL', 'unknown', 'disabled')
    expect(hits.map((h) => h.source)).toEqual(['disabled'])
    expect(disabledSearch).toHaveBeenCalledOnce()
  })
})
