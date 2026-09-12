// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useMarketBars } from './useMarketBars'
const bars = vi.hoisted(() => vi.fn())
vi.mock('../api/market', () => ({ barsApi: { bars } }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
it('discards a stale source response and supports explicit error retry', async () => {
  let resolve!: (value: unknown) => void
  bars.mockImplementationOnce(() => new Promise(r => { resolve = r })).mockResolvedValueOnce({ error: 'Source offline', results: null, meta: null })
  const { result, rerender } = renderHook(({ barId }) => useMarketBars({ barId, interval: '1d', count: 300 }), { initialProps: { barId: 'a|A' } })
  expect(result.current.loading).toBe(true)
  rerender({ barId: 'b|B' })
  await waitFor(() => expect(result.current.error).toBe('Source offline'))
  await act(async () => resolve({ results: [{ close: 99 }], meta: { barId: 'a|A' } }))
  expect(result.current.bars).toBeNull()
  bars.mockResolvedValueOnce({ results: [{ close: 42 }], meta: { barId: 'b|B' } })
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.bars?.[0].close).toBe(42))
  expect(result.current.error).toBeNull()
})
