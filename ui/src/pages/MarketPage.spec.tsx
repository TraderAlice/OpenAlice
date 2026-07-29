import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
  valuation: vi.fn(() => new Promise(() => {})),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) =>
    selector({ openOrFocus: mocks.openOrFocus }),
}))

vi.mock('../api/reference', () => ({
  referenceApi: { valuation: mocks.valuation },
}))

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
