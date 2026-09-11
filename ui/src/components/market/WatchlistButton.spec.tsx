// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useWatchlist } from '../../tabs/watchlist-store'
import { WatchlistButton } from './WatchlistButton'
afterEach(() => { cleanup(); useWatchlist.setState({ entries: [] }) })
it('toggles the current asset and exposes its state without visible button text', () => {
  const { rerender } = render(<WatchlistButton assetClass="equity" symbol="1.600519" />)
  const button = screen.getByRole('button', { name: 'Add to watchlist' })
  expect(button.textContent).toBe('')
  fireEvent.click(button)
  expect(screen.getByRole('button', { name: 'Remove from watchlist' }).getAttribute('aria-pressed')).toBe('true')
  rerender(<WatchlistButton assetClass="equity" symbol="0.000001" />)
  expect(screen.getByRole('button', { name: 'Add to watchlist' }).getAttribute('aria-pressed')).toBe('false')
  rerender(<WatchlistButton assetClass="equity" symbol="1.600519" />)
  fireEvent.click(screen.getByRole('button', { name: 'Remove from watchlist' }))
  expect(useWatchlist.getState().entries).toEqual([])
})
