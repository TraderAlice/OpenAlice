import { beforeEach, describe, expect, it, vi } from 'vitest'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { FedFredSeriesFetcher } from './fred-series.js'
import { fetchFredMultiSeries, multiSeriesToRecords } from '../utils/fred-helpers.js'

vi.mock('../../../core/provider/utils/helpers.js', () => ({ amakeRequest: vi.fn() }))
const request = vi.mocked(amakeRequest)
beforeEach(() => { request.mockReset() })

describe('FRED sparse observation joins', () => {
  it('joins quarterly and monthly data only on exact dates, in ascending order', async () => {
    request.mockResolvedValueOnce({ observations: [
      { date: '2024-04-01', value: '29000' },
      { date: '2024-01-01', value: '28000' },
    ] }).mockResolvedValueOnce({ observations: [
      { date: '2024-05-01', value: '4.0' },
      { date: '2024-04-01', value: '3.9' },
      { date: '2024-03-01', value: '-' },
      { date: '2024-02-01', value: '.' },
    ] })
    const query = FedFredSeriesFetcher.transformQuery({
      symbol: 'GDP,UNRATE', start_date: '2024-01-01', end_date: '2024-05-31',
    })
    const rows = FedFredSeriesFetcher.transformData(query,
      await FedFredSeriesFetcher.extractData(query, { federal_reserve_api_key: 'fixture-key' }))
    expect(rows).toEqual([
      { date: '2024-01-01', GDP: 28000 },
      { date: '2024-03-01', UNRATE: null },
      { date: '2024-04-01', GDP: 29000, UNRATE: 3.9 },
      { date: '2024-05-01', UNRATE: 4 },
    ])
    expect(request).toHaveBeenCalledTimes(2)
    for (const [url] of request.mock.calls) {
      const params = new URL(String(url)).searchParams
      expect(params.get('observation_start')).toBe('2024-01-01')
      expect(params.get('observation_end')).toBe('2024-05-31')
    }
  })

  it('keeps independent limited series sparse when their dates never overlap', async () => {
    request.mockResolvedValueOnce({ observations: [{ date: '2024-04-01', value: '29000' }] })
      .mockResolvedValueOnce({ observations: [{ date: '2024-06-01', value: '4.1' }] })
    const data = await fetchFredMultiSeries(['GDP', 'UNRATE'], 'fixture-key', { limit: 1 })
    expect(multiSeriesToRecords(data)).toEqual([
      { date: '2024-04-01', GDP: 29000 }, { date: '2024-06-01', UNRATE: 4.1 },
    ])
    expect(multiSeriesToRecords(data, { GDP: 'gdp', UNRATE: 'unemployment' })).toEqual([
      { date: '2024-04-01', gdp: 29000, unemployment: null },
      { date: '2024-06-01', gdp: null, unemployment: 4.1 },
    ])
    for (const [url] of request.mock.calls) {
      expect(new URL(String(url)).searchParams.get('limit')).toBe('1')
    }
  })

  it('preserves an upstream failure when no series supplied observations', async () => {
    const failure = new Error('fixture connection reset')
    request.mockRejectedValue(failure)
    await expect(fetchFredMultiSeries(['GDP', 'UNRATE'], 'fixture-key')).rejects.toBe(failure)
  })
})
