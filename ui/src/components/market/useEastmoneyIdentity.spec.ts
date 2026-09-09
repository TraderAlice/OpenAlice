// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { barsApi } from '../../api/market'
import { useEastmoneyIdentity } from './useEastmoneyIdentity'
vi.mock('../../api/market', () => ({ barsApi: { searchSources: vi.fn() } }))
afterEach(() => { cleanup(); vi.resetAllMocks() })
it('selects only the exact source identity and clears the previous name on navigation', async () => {
  vi.mocked(barsApi.searchSources).mockResolvedValueOnce({ count: 2, candidates: [
    { barId: 'yfinance|600519.SS', symbol: '600519.SS', source: 'vendor', sourceId: 'yfinance', assetClass: 'equity', name: 'Wrong source', label: '' },
    { barId: 'eastmoney|1.600519', symbol: '1.600519', source: 'vendor', sourceId: 'eastmoney', assetClass: 'equity', name: '贵州茅台', label: '' },
  ] }).mockRejectedValueOnce(new Error('offline'))
  const { result, rerender } = renderHook(({ source }) => useEastmoneyIdentity(source), { initialProps: { source: 'eastmoney|1.600519' } })
  expect(result.current?.loading).toBe(true)
  await waitFor(() => expect(result.current?.name).toBe('贵州茅台'))
  rerender({ source: 'eastmoney|0.000001' })
  expect(result.current?.name).toBeUndefined()
  expect(result.current?.code).toBe('000001')
  await waitFor(() => expect(result.current?.error).toBe(true))
  expect(result.current?.loading).toBe(false)
})
it('does not fetch metadata for other vendors or malformed identities', () => {
  const { result, rerender } = renderHook(({ source }) => useEastmoneyIdentity(source), { initialProps: { source: 'yfinance|AAPL' } })
  expect(result.current).toBeNull()
  rerender({ source: 'eastmoney|bad' })
  expect(result.current).toBeNull()
  expect(barsApi.searchSources).not.toHaveBeenCalled()
})
