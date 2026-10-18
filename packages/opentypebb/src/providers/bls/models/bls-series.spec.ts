import { beforeEach, describe, expect, it, vi } from 'vitest'
import { amakeRequest } from '../../../core/provider/utils/helpers.js'
import { EmptyDataError } from '../../../core/provider/utils/errors.js'
import { BLSBlsSeriesFetcher } from './bls-series.js'

vi.mock('../../../core/provider/utils/helpers.js', () => ({ amakeRequest: vi.fn() }))
const request = vi.mocked(amakeRequest)
const query = BLSBlsSeriesFetcher.transformQuery({
  symbol: 'SERIES_A,SERIES_B', start_date: '2024-01-01', end_date: '2024-12-31',
})
beforeEach(() => { request.mockReset() })

describe('BLS unavailable observations', () => {
  it('skips nonnumeric periods without filling gaps or losing other series', async () => {
    request.mockResolvedValue({ Results: { series: [
      { seriesID: 'SERIES_A', data: [
        { year: '2024', period: 'M04', value: '4.2' },
        { year: '2024', period: 'M03', value: '-' },
        { year: '2024', period: 'M02', value: 'NaN' },
        { year: '2024', period: 'M01', value: '0' },
      ] },
      { seriesID: 'SERIES_B', data: [
        { year: '2024', period: 'M03', value: '-1.5' },
        { year: '2024', period: 'M02', value: '' },
      ] },
    ] } })
    const rows = BLSBlsSeriesFetcher.transformData(query,
      await BLSBlsSeriesFetcher.extractData(query, null))
    expect(rows).toEqual([
      { date: '2024-01-01', series_id: 'SERIES_A', value: 0, period: 'M01' },
      { date: '2024-03-01', series_id: 'SERIES_B', value: -1.5, period: 'M03' },
      { date: '2024-04-01', series_id: 'SERIES_A', value: 4.2, period: 'M04' },
    ])
  })

  it('reports empty data when every observation is unavailable', async () => {
    request.mockResolvedValue({ Results: { series: [{ seriesID: 'SERIES_A', data: [
      { year: '2024', period: 'M01', value: '-' },
    ] }] } })
    await expect(BLSBlsSeriesFetcher.extractData(query, null)).rejects.toBeInstanceOf(EmptyDataError)
  })

  it('preserves upstream connection failures instead of treating them as empty data', async () => {
    const failure = new Error('fixture TLS connection reset')
    request.mockRejectedValue(failure)
    await expect(BLSBlsSeriesFetcher.extractData(query, null)).rejects.toBe(failure)
  })
})
