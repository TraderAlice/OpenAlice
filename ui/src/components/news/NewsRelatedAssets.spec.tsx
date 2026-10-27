import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { NewsRelatedAssets } from './NewsRelatedAssets'

const mocks = vi.hoisted(() => ({ bars: vi.fn() }))
vi.mock('../../api/market', () => ({ barsApi: { bars: mocks.bars } }))
beforeEach(async () => { await i18n.changeLanguage('en'); mocks.bars.mockReset().mockResolvedValue({ results: [{ date: '2026-10-23', open: 100, high: 100, low: 100, close: 100, volume: 1 }, { date: '2026-10-24', open: 100, high: 110, low: 100, close: 110, volume: 1 }], meta: { provider: 'fixture', interval: '1d', asOf: '2026-10-24' } }) })
afterEach(cleanup)
describe('event asset cards', () => {
  it('uses explicit supported codes, de-duplicates aliases and preserves the data source/date', async () => {
    render(<NewsRelatedAssets symbols={['NASDAQ:AAPL', 'EQUITY:AAPL']} />)
    expect(await screen.findByText('110.00')).toBeTruthy()
    await waitFor(() => expect(mocks.bars).toHaveBeenCalledTimes(1))
    expect(mocks.bars).toHaveBeenCalledWith(expect.objectContaining({ symbol: 'AAPL', assetClass: 'equity', interval: '1d' }))
    expect(screen.getByText('2026-10-24 · fixture')).toBeTruthy()
    expect(screen.getByText('Market prices are context for this event')).toBeTruthy()
    expect(screen.queryByRole('group', { name: 'Markets' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Sector ETFs' })).toBeNull()
  })
  it('keeps absent or unsupported codes explicit and never fills them with default assets', async () => {
    const { rerender } = render(<NewsRelatedAssets symbols={[]} />)
    expect(screen.getByText('No supported asset codes in this event')).toBeTruthy()
    rerender(<NewsRelatedAssets symbols={['DEMO:EXAMPLE']} />)
    expect(screen.getByText('DEMO:EXAMPLE')).toBeTruthy()
    expect(screen.getByText('Quote source not identified')).toBeTruthy()
    expect(mocks.bars).not.toHaveBeenCalled()
  })
})
