import { describe, it, expect, beforeEach } from 'vitest'
import { useWatchlist } from './watchlist-store'

beforeEach(() => {
  localStorage.clear()
  useWatchlist.setState({ entries: [] })
})

describe('watchlist', () => {
  it('add appends a new entry to the front (newest first)', () => {
    const s = useWatchlist.getState()
    s.add('equity', 'AAPL')
    s.add('crypto', 'BTC/USD')
    const entries = useWatchlist.getState().entries
    expect(entries).toHaveLength(2)
    expect(entries[0].symbol).toBe('BTC/USD')
    expect(entries[1].symbol).toBe('AAPL')
  })

  it('add is a no-op when entry already exists', () => {
    const s = useWatchlist.getState()
    s.add('equity', 'AAPL')
    s.add('equity', 'AAPL')
    expect(useWatchlist.getState().entries).toHaveLength(1)
  })

  it('add distinguishes by both assetClass and symbol', () => {
    // Same symbol string in different asset classes is allowed (rare, but
    // the contract is "compound key").
    const s = useWatchlist.getState()
    s.add('equity', 'AAPL')
    s.add('crypto', 'AAPL')
    expect(useWatchlist.getState().entries).toHaveLength(2)
  })

  it('remove drops the matching entry', () => {
    const s = useWatchlist.getState()
    s.add('equity', 'AAPL')
    s.add('equity', 'TSLA')
    s.remove('equity', 'AAPL')
    const entries = useWatchlist.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0].symbol).toBe('TSLA')
  })

  it('has reflects current membership', () => {
    const s = useWatchlist.getState()
    expect(s.has('equity', 'AAPL')).toBe(false)
    s.add('equity', 'AAPL')
    expect(useWatchlist.getState().has('equity', 'AAPL')).toBe(true)
    useWatchlist.getState().remove('equity', 'AAPL')
    expect(useWatchlist.getState().has('equity', 'AAPL')).toBe(false)
  })
})
