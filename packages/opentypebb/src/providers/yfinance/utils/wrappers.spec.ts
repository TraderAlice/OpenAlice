import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NetworkUnreachableError } from '../../../core/provider/utils/errors.js'

const bunError = () => Object.assign(
  new Error('Unable to connect. Is the computer able to access the url?'),
  { code: 'FailedToOpenSocket' },
)

const mockInstance = {
  search: vi.fn(),
  quoteSummary: vi.fn(),
  screener: vi.fn(),
  fundamentalsTimeSeries: vi.fn(),
  chart: vi.fn(),
  options: vi.fn(),
}

vi.mock('yahoo-finance2', () => ({
  default: class MockYahooFinance {
    search = mockInstance.search
    quoteSummary = mockInstance.quoteSummary
    screener = mockInstance.screener
    fundamentalsTimeSeries = mockInstance.fundamentalsTimeSeries
    chart = mockInstance.chart
    options = mockInstance.options
  },
}))

import {
  searchYahooFinance,
  getQuoteSummary,
  getRawQuoteSummary,
  getPredefinedScreener,
  getFinancialStatements,
  getHistoricalDividends,
  getOptionsData,
  getYahooNews,
} from './helpers.js'

describe('yfinance wrappers classify Bun fetch errors into NetworkUnreachableError', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    for (const fn of Object.values(mockInstance)) {
      fn.mockReset()
      fn.mockRejectedValue(bunError())
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function expectNetworkUnreachable(promise: Promise<unknown>) {
    const settled = promise.then(
      () => { throw new Error('expected rejection') },
      (err) => err,
    )
    await vi.runAllTimersAsync()
    const err = await settled
    expect(err).toBeInstanceOf(NetworkUnreachableError)
    expect((err as Error).message).toContain('finance.yahoo.com')
    expect((err as Error).message).toContain('FailedToOpenSocket')
  }

  it('searchYahooFinance attributes finance.yahoo.com', async () => {
    await expectNetworkUnreachable(searchYahooFinance('AAPL'))
  })

  it('getQuoteSummary attributes finance.yahoo.com', async () => {
    await expectNetworkUnreachable(getQuoteSummary('AAPL'))
  })

  it('getRawQuoteSummary attributes finance.yahoo.com', async () => {
    await expectNetworkUnreachable(getRawQuoteSummary('AAPL', ['price']))
  })

  it('getPredefinedScreener attributes finance.yahoo.com', async () => {
    await expectNetworkUnreachable(getPredefinedScreener('day_gainers'))
  })

  it('getFinancialStatements attributes finance.yahoo.com', async () => {
    await expectNetworkUnreachable(getFinancialStatements('AAPL', 'annual'))
  })

  it('getHistoricalDividends attributes finance.yahoo.com', async () => {
    await expectNetworkUnreachable(getHistoricalDividends('AAPL'))
  })

  it('getOptionsData attributes finance.yahoo.com', async () => {
    await expectNetworkUnreachable(getOptionsData('AAPL'))
  })

  it('getYahooNews attributes finance.yahoo.com', async () => {
    await expectNetworkUnreachable(getYahooNews('AAPL'))
  })
})
