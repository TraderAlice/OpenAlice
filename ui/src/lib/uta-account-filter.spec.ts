import { describe, expect, it } from 'vitest'
import type { UTASummary, UTATier } from '../api/types'
import { displayNameForUTA, displayProviderForUTA, filterAccountTierUTAs, isAccountTierUTA } from './uta-account-filter'

function summary(id: string, tier: UTATier): UTASummary {
  return {
    id,
    label: id,
    asVendor: true,
    capabilities: { supportedSecTypes: [], supportedOrderTypes: [] },
    health: {
      status: 'healthy',
      reach: tier === 'data' ? 'connected' : 'readable',
      tier,
      consecutiveFailures: 0,
      recovering: false,
      connecting: false,
      disabled: false,
    },
  }
}

describe('UTA account filtering', () => {
  it('drops public-data-only UTAs from account surfaces', () => {
    const utas = [
      summary('alpaca-paper', 'trading'),
      summary('ibkr-demo', 'account'),
      summary('binance-readonly', 'data'),
      summary('okx-readonly', 'data'),
    ]

    expect(filterAccountTierUTAs(utas).map((u) => u.id)).toEqual(['alpaca-paper', 'ibkr-demo'])
  })

  it('treats account and trading tiers as portfolio accounts', () => {
    expect(isAccountTierUTA(summary('funded-readonly', 'account'))).toBe(true)
    expect(isAccountTierUTA(summary('trade-enabled', 'trading'))).toBe(true)
  })

  it('infers display provider from existing provider or UTA id', () => {
    expect(displayProviderForUTA({ id: 'paper', provider: 'alpaca' })).toBe('alpaca')
    expect(displayProviderForUTA({ id: 'binance-readonly' })).toBe('ccxt')
    expect(displayProviderForUTA({ id: 'ibkr-main' })).toBe('ibkr')
  })

  it('prefers the configured account label for display names', () => {
    expect(displayNameForUTA(
      { id: 'alpaca-paper', label: 'Retirement Paper' },
      { label: 'Alpaca' },
    )).toBe('Retirement Paper')
    expect(displayNameForUTA(
      { id: 'ibkr-main', label: '   ' },
      { label: 'IBKR' },
    )).toBe('IBKR')
    expect(displayNameForUTA({ id: 'custom-broker' })).toBe('custom-broker')
  })
})
