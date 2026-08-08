/**
 * credential-map — pinning the two-table contract.
 *
 * The HTTP path (legacy Python OpenBB sidecar) and the SDK path
 * (in-process opentypebb) want different field names for the same
 * underlying user key. `fred` is the canonical example: HTTP wants
 * `fred_api_key`, SDK wants `federal_reserve_api_key` (provider
 * auto-prefix, see Provider constructor in the opentypebb package).
 *
 * If a future change merges these mappings back into one table, this
 * test fails — and that's the point. The two-table split is intentional.
 */

import { describe, it, expect } from 'vitest'
import { buildSDKCredentials } from '../credential-map.js'

describe('buildSDKCredentials — in-process opentypebb path', () => {
  it('maps fred → federal_reserve_api_key (provider name auto-prefix)', () => {
    expect(buildSDKCredentials({ fred: 'k1' })).toEqual({ federal_reserve_api_key: 'k1' })
  })

  it('maps fmp → fmp_api_key (user key matches provider name)', () => {
    expect(buildSDKCredentials({ fmp: 'k2' })).toEqual({ fmp_api_key: 'k2' })
  })

  it('maps MarketData without exposing the token outside the provider credential field', () => {
    expect(buildSDKCredentials({ marketdata: 'token' })).toEqual({ marketdata_api_key: 'token' })
  })

  it('maps multiple providers in one call', () => {
    expect(buildSDKCredentials({ fred: 'k1', fmp: 'k2', bls: 'k3' })).toEqual({
      federal_reserve_api_key: 'k1',
      fmp_api_key: 'k2',
      bls_api_key: 'k3',
    })
  })

  it('returns {} for undefined input', () => {
    expect(buildSDKCredentials(undefined)).toEqual({})
  })

  it('skips entries with empty/undefined values', () => {
    expect(buildSDKCredentials({ fred: undefined, fmp: '' })).toEqual({})
  })

  it('skips unknown provider keys', () => {
    expect(buildSDKCredentials({ fred: 'k1', unknown_provider: 'k2' })).toEqual({
      federal_reserve_api_key: 'k1',
    })
  })
})


describe('fred divergence — user key name ≠ SDK provider name', () => {
  it('fred maps to the provider-prefixed federal_reserve_api_key', () => {
    expect(buildSDKCredentials({ fred: 'k' })).toEqual({ federal_reserve_api_key: 'k' })
  })
})

describe('buildSDKCredentials hub sentinel', () => {
  const hub = { enabled: true, baseUrl: 'https://hub.test' }

  it('fills missing fred/eia/bls with the hub sentinel', () => {
    const creds = buildSDKCredentials({}, hub)
    expect(creds.federal_reserve_api_key).toBe('hub:https://hub.test')
    expect(creds.eia_api_key).toBe('hub:https://hub.test')
    expect(creds.bls_api_key).toBe('hub:https://hub.test')
  })

  it('user keys always win over the hub', () => {
    const creds = buildSDKCredentials({ fred: 'real-key' }, hub)
    expect(creds.federal_reserve_api_key).toBe('real-key')
    expect(creds.eia_api_key).toBe('hub:https://hub.test')
  })

  it('injects nothing when the hub is disabled or absent', () => {
    expect(buildSDKCredentials({}, { enabled: false, baseUrl: 'x' })).toEqual({})
    expect(buildSDKCredentials({})).toEqual({})
  })

  it('never touches non-hub providers (fmp has no proxy)', () => {
    const creds = buildSDKCredentials({}, hub)
    expect(creds.fmp_api_key).toBeUndefined()
  })
})
