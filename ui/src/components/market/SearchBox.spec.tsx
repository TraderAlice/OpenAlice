// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter, useLocation } from 'react-router-dom'

import type { BarSourceCandidate } from '../../api/market'
import { i18n } from '../../i18n'

const state = vi.hoisted(() => ({
  loading: false,
  results: [] as BarSourceCandidate[],
}))

vi.mock('./useAssetSearch', () => ({
  useAssetSearch: () => ({ results: state.results, loading: state.loading }),
}))

import { SearchBox } from './SearchBox'

beforeEach(async () => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  state.loading = false
  state.results = []
  await i18n.changeLanguage('zh')
})

afterEach(cleanup)

afterAll(async () => {
  delete (Element.prototype as Partial<Element>).scrollIntoView
  await i18n.changeLanguage('en')
})

function LocationProbe() {
  const location = useLocation()
  return <output aria-label="route">{location.pathname + location.search}</output>
}

function setup() {
  render(
    <MemoryRouter initialEntries={['/market']}>
      <SearchBox />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('Market SearchBox localization', () => {
  it('localizes the input and empty result state', () => {
    setup()

    const input = screen.getByPlaceholderText('搜索资产——AAPL、比特币、EUR、黄金…')
    fireEvent.change(input, { target: { value: 'missing' } })

    expect(screen.getByText('无匹配')).toBeTruthy()
  })

  it('localizes the pending result state', () => {
    state.loading = true
    setup()

    fireEvent.change(
      screen.getByPlaceholderText('搜索资产——AAPL、比特币、EUR、黄金…'),
      { target: { value: 'apple' } },
    )

    expect(screen.getByText('搜索中…')).toBeTruthy()
  })

  it('ignores Enter during CJK IME composition (isComposing and keyCode 229)', () => {
    state.results = [
      {
        barId: 'yfinance|AAPL',
        source: 'vendor',
        sourceId: 'yfinance',
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'equity',
        label: 'AAPL',
      },
    ]
    setup()

    const input = screen.getByPlaceholderText('搜索资产——AAPL、比特币、EUR、黄金…') as HTMLInputElement
    fireEvent.change(input, { target: { value: '苹果' } })

    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(screen.getByLabelText('route').textContent).toBe('/market')
    expect(input.value).toBe('苹果')

    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(screen.getByLabelText('route').textContent).toBe('/market')
    expect(input.value).toBe('苹果')

    fireEvent.keyDown(input, { key: 'Enter', isComposing: false, keyCode: 13 })
    expect(screen.getByLabelText('route').textContent).toBe('/market/equity/AAPL?source=yfinance%7CAAPL')
  })
})
