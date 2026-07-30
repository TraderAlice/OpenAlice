// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import { TradeableContractsPanel } from './TradeableContractsPanel'

const mocks = vi.hoisted(() => ({
  searchContracts: vi.fn(),
}))

vi.mock('../../api/trading', () => ({
  tradingApi: {
    searchContracts: mocks.searchContracts,
  },
}))

const hit = (symbol: string, aliceId: string) => ({
  source: 'alpaca-paper',
  contract: {
    symbol,
    secType: 'STK',
    description: `${symbol} equity`,
    primaryExchange: 'NASDAQ',
    currency: 'USD',
    aliceId,
  },
})

beforeEach(async () => {
  mocks.searchContracts.mockReset()
  await i18n.changeLanguage('zh')
})

afterEach(cleanup)

describe('TradeableContractsPanel', () => {
  it('localizes contract expansion and order-entry actions', async () => {
    mocks.searchContracts.mockResolvedValue({
      utasConfigured: 1,
      results: [
        hit('AAPL', 'alpaca:stock:AAPL'),
        hit('MSFT', 'alpaca:stock:MSFT'),
        hit('NVDA', 'alpaca:stock:NVDA'),
        hit('GOOG', 'alpaca:stock:GOOG'),
      ],
    })
    const user = userEvent.setup()

    render(
      <MemoryRouter>
        <TradeableContractsPanel symbol="AAPL" assetClass="equity" />
      </MemoryRouter>,
    )

    expect(await screen.findByText('已配置券商中的可交易合约')).toBeTruthy()
    expect(screen.getAllByRole('link', { name: '下单 →' })).toHaveLength(3)

    await user.click(screen.getByRole('button', { name: '再显示 1 项（共 4 项）' }))

    expect(screen.getAllByRole('link', { name: '下单 →' })).toHaveLength(4)
    expect(screen.getByRole('button', { name: '收起' })).toBeTruthy()
  })

  it('keeps canonical contract identity and the order action legible on narrow rows', async () => {
    mocks.searchContracts.mockResolvedValue({
      utasConfigured: 1,
      results: [hit('AAPL', 'alpaca-paper|AAPL')],
    })

    render(
      <MemoryRouter>
        <TradeableContractsPanel symbol="AAPL" assetClass="equity" />
      </MemoryRouter>,
    )

    const symbol = await screen.findByText('AAPL')
    const row = symbol.closest('li')
    expect(row?.className).toContain('grid-cols-[minmax(0,1fr)_auto]')
    expect(row?.className).toContain('sm:flex')

    const description = screen.getByText('AAPL equity · NASDAQ · USD')
    expect(description.className).toContain('col-span-2')
    expect(description.className).toContain('sm:flex-1')

    const canonicalId = screen.getByText('alpaca-paper|AAPL')
    expect(canonicalId.className).toContain('min-w-0')
    expect(canonicalId.getAttribute('title')).toBe('alpaca-paper|AAPL')

    const account = screen.getByText('alpaca-paper')
    expect(account.className).toContain('hidden sm:inline')

    const order = screen.getByRole('link', { name: '下单 →' })
    expect(order.className).toContain('min-h-8')
    expect(order.className).toContain('sm:min-h-0')
    expect(order.getAttribute('href')).toBe('/uta/alpaca-paper?aliceId=alpaca-paper%7CAAPL')
  })

  it('localizes the no-match state with the requested symbol', async () => {
    mocks.searchContracts.mockResolvedValue({ utasConfigured: 1, results: [] })

    render(
      <MemoryRouter>
        <TradeableContractsPanel symbol="AAPL" assetClass="equity" />
      </MemoryRouter>,
    )

    expect(await screen.findByText('已配置券商中没有与 AAPL 匹配的可交易合约。')).toBeTruthy()
  })

  it('keeps the localized Trading setup action navigable', async () => {
    mocks.searchContracts.mockResolvedValue({ utasConfigured: 0, results: [] })

    render(
      <MemoryRouter>
        <TradeableContractsPanel symbol="AAPL" assetClass="equity" />
      </MemoryRouter>,
    )

    const setupLink = await screen.findByRole('link', { name: '前往“交易”添加' })
    expect(setupLink.getAttribute('href')).toBe('/trading')
    expect(setupLink.parentElement?.textContent).toBe(
      '尚未配置交易账户。前往“交易”添加，即可在此查看匹配合约。',
    )
  })
})
