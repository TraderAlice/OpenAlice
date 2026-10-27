import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
  valuation: vi.fn(() => new Promise(() => {})),
  bars: vi.fn(() => new Promise(() => {})),
  rotation: vi.fn(),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) =>
    selector({ openOrFocus: mocks.openOrFocus }),
}))

vi.mock('../api/reference', () => ({
  referenceApi: { valuation: mocks.valuation },
}))

vi.mock('../api/market', () => ({ barsApi: { bars: mocks.bars }, marketApi: { sectorRotation: mocks.rotation } }))

vi.mock('../components/market/SearchBox', () => ({
  SearchBox: () => <div>search box</div>,
}))

import { MarketPage } from './MarketPage'

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('zh')
})

afterEach(cleanup)

afterAll(async () => {
  await i18n.changeLanguage('en')
})

describe('MarketPage FX desk', () => {
  it('owns multi-market controls and the sector ETF entry on the market overview', async () => {
    const user = userEvent.setup()
    render(<MarketPage />)
    expect(screen.getByRole('button', { name: '行业 ETF' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: '外汇' }))
    await waitFor(() => expect(mocks.bars).toHaveBeenCalledWith({ symbol: 'EURUSD', assetClass: 'currency', interval: '1d', count: 2 }))
    expect(mocks.rotation).not.toHaveBeenCalled()
  })
  it('localizes the landing copy without changing board routing', () => {
    render(<MarketPage />)

    expect(screen.getByRole('heading', { name: '市场' })).toBeTruthy()
    expect(screen.getByText('搜索资产并查看价格历史。')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '从现货、套息到宏观，集中在一个货币对视图。' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /跨国宏观/ }))

    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'market-board',
      params: { board: 'global-macro' },
    })
  })
})
