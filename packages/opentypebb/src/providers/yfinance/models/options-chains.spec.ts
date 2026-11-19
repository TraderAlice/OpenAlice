import { afterEach, describe, expect, it, vi } from 'vitest'
import { NetworkUnreachableError, RateLimitedError } from '../../../core/provider/utils/errors.js'

const getOptionsDataMock = vi.fn()

vi.mock('../utils/helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/helpers.js')>()
  return {
    ...actual,
    getOptionsData: (...args: unknown[]) => getOptionsDataMock(...args),
  }
})

import { YFinanceOptionsChainsFetcher } from './options-chains.js'

afterEach(() => {
  vi.unstubAllGlobals()
  getOptionsDataMock.mockReset()
})

describe('YFinanceOptionsChainsFetcher error attribution', () => {
  it('surfaces NetworkUnreachableError instead of EmptyDataError when both yf2 and direct fetch fail on Bun network error', async () => {
    const bunErr = Object.assign(new Error('Unable to connect'), { code: 'ConnectionRefused' })
    getOptionsDataMock.mockRejectedValueOnce(new NetworkUnreachableError('finance.yahoo.com', 'ConnectionRefused: Unable to connect', bunErr))
    vi.stubGlobal('fetch', vi.fn(async () => { throw bunErr }))

    const query = YFinanceOptionsChainsFetcher.transformQuery({ symbol: 'AAPL' })
    const err = await YFinanceOptionsChainsFetcher.extractData(query, null).catch((e) => e)
    expect(err).toBeInstanceOf(NetworkUnreachableError)
    expect((err as Error).message).toContain('finance.yahoo.com')
    expect((err as Error).message).toContain('ConnectionRefused')
  })

  it('surfaces RateLimitedError when direct options fallback receives HTTP 429', async () => {
    getOptionsDataMock.mockRejectedValueOnce(new Error('crumb failed'))
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Too Many Requests', { status: 429 })))

    const query = YFinanceOptionsChainsFetcher.transformQuery({ symbol: 'AAPL' })
    const err = await YFinanceOptionsChainsFetcher.extractData(query, null).catch((e) => e)
    expect(err).toBeInstanceOf(RateLimitedError)
    expect((err as Error).message).toContain('HTTP 429')
  })
})
