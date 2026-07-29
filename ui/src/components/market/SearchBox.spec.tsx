import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

import { i18n } from '../../i18n'

const state = vi.hoisted(() => ({
  loading: false,
}))

vi.mock('./useAssetSearch', () => ({
  useAssetSearch: () => ({ results: [], loading: state.loading }),
}))

import { SearchBox } from './SearchBox'

beforeEach(async () => {
  state.loading = false
  await i18n.changeLanguage('zh')
})

afterEach(cleanup)

afterAll(async () => {
  await i18n.changeLanguage('en')
})

function setup() {
  render(
    <MemoryRouter>
      <SearchBox />
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
})
