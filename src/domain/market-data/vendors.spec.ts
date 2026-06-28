/**
 * Market-vendor catalog — list/set logic over a mocked executor + config.
 * Verifies the vendorMeta-presence filter, runtime-state join, sort order,
 * and the setMarketVendor guards (unknown id, always-on primary).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { QueryExecutor } from '@traderalice/opentypebb'

vi.mock('@/core/config.js', () => ({
  readMarketDataConfig: vi.fn(),
  updateExtraVendors: vi.fn(),
}))

import { readMarketDataConfig, updateExtraVendors } from '@/core/config.js'
import { listMarketVendors, setMarketVendor } from './vendors.js'

const META = { coverage: 'cov', howToUse: 'how' }

/** Minimal Provider-shaped stub — only the fields listMarketVendors reads. */
function P(
  name: string,
  opts: { meta?: typeof META; creds?: string[]; reprName?: string; website?: string } = {},
) {
  return {
    name,
    vendorMeta: opts.meta,
    credentials: opts.creds ?? [],
    reprName: opts.reprName,
    website: opts.website,
  }
}

function fakeExecutor(providers: ReturnType<typeof P>[]): QueryExecutor {
  return { listProviders: () => providers } as unknown as QueryExecutor
}

beforeEach(() => {
  vi.mocked(readMarketDataConfig).mockResolvedValue({
    providers: { equity: 'yfinance' },
    extraVendors: ['eastmoney'],
  } as unknown as Awaited<ReturnType<typeof readMarketDataConfig>>)
  vi.mocked(updateExtraVendors).mockReset()
  vi.mocked(updateExtraVendors).mockImplementation(async (mutate) => mutate([]))
})

describe('listMarketVendors', () => {
  it('keeps only vendorMeta providers, joins state, sorts always-on→enabled→rest', async () => {
    const exec = fakeExecutor([
      P('fmp', { creds: ['fmp_api_key'] }), // no vendorMeta → excluded
      P('twse', { meta: META }), // off (not primary, not in extraVendors)
      P('yfinance', { meta: META, reprName: 'Yahoo Finance' }), // primary → always-on
      P('eastmoney', { meta: META }), // enabled via extraVendors
    ])
    const v = await listMarketVendors(exec)

    expect(v.map((x) => x.id)).toEqual(['yfinance', 'eastmoney', 'twse'])
    expect(v.find((x) => x.id === 'yfinance')).toMatchObject({
      alwaysOn: true, enabled: true, keyless: true, name: 'Yahoo Finance',
    })
    expect(v.find((x) => x.id === 'eastmoney')).toMatchObject({ alwaysOn: false, enabled: true })
    expect(v.find((x) => x.id === 'twse')).toMatchObject({ alwaysOn: false, enabled: false, coverage: 'cov' })
    expect(v.some((x) => x.id === 'fmp')).toBe(false)
  })
})

describe('setMarketVendor', () => {
  const exec = fakeExecutor([
    P('yfinance', { meta: META }),
    P('twse', { meta: META }),
    P('eastmoney', { meta: META }),
  ])

  it('enable appends the vendor to extraVendors', async () => {
    const r = await setMarketVendor(exec, 'twse', true)
    expect(r).toMatchObject({ id: 'twse', enabled: true })
    const mutate = vi.mocked(updateExtraVendors).mock.calls[0]![0]
    expect(mutate(['eastmoney'])).toEqual(['eastmoney', 'twse'])
  })

  it('disable removes the vendor from extraVendors', async () => {
    await setMarketVendor(exec, 'eastmoney', false)
    const mutate = vi.mocked(updateExtraVendors).mock.calls[0]![0]
    expect(mutate(['eastmoney', 'twse'])).toEqual(['twse'])
  })

  it('rejects toggling the always-on primary (yfinance)', async () => {
    await expect(setMarketVendor(exec, 'yfinance', false)).rejects.toThrow(/always-on/)
    expect(updateExtraVendors).not.toHaveBeenCalled()
  })

  it('rejects an unknown vendor id', async () => {
    await expect(setMarketVendor(exec, 'nope', true)).rejects.toThrow(/Unknown market vendor/)
    expect(updateExtraVendors).not.toHaveBeenCalled()
  })
})
