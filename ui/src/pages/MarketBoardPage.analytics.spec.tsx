// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { MarketBoardPage } from './MarketBoardPage'

const mocks = vi.hoisted(() => ({
  data: null as unknown, error: null as string | null, retry: vi.fn(), open: vi.fn(),
  charts: [] as Array<{ data: Array<{ expiration: string; time?: number; price: number | null; basis?: number | null }> }>,
  axes: [] as Array<{ dataKey?: string; type?: string }>,
  lines: [] as Array<{ dataKey?: string; connectNulls?: boolean }>,
  references: [] as Array<{ y?: number }>,
}))
vi.mock('../tabs/store', () => ({ useWorkspace: (select: (state: { openOrFocus: typeof mocks.open }) => unknown) => select({ openOrFocus: mocks.open }) }))
vi.mock('../components/market/useReferenceBoard', () => ({ useReferenceBoard: () => ({ data: mocks.data, loading: false, updatedAt: null, error: mocks.error, retry: mocks.retry }) }))
vi.mock('../components/market/BoardMeta', () => ({ BoardMeta: () => null }))
vi.mock('../components/MeasuredChartFrame', () => ({ MeasuredChartFrame: ({ children }: { children: (size: { width: number; height: number }) => ReactNode }) => <div>{children({ width: 640, height: 180 })}</div> }))
vi.mock('recharts', async original => ({
  ...await original<typeof import('recharts')>(),
  LineChart: ({ children, data }: { children: ReactNode; data: typeof mocks.charts[number]['data'] }) => { mocks.charts.push({ data }); return <div>{children}</div> },
  XAxis: (props: typeof mocks.axes[number]) => { mocks.axes.push(props); return null },
  YAxis: () => null, Tooltip: () => null,
  Line: (props: typeof mocks.lines[number]) => { mocks.lines.push(props); return null },
  ReferenceLine: (props: typeof mocks.references[number]) => { mocks.references.push(props); return null },
}))

const mover = (symbol: string, price: number | null, relative_volume = 1) => ({ symbol, name: `${symbol} company`, price, change: 0, percent_change: 0, volume: 10, avg_volume: 10, relative_volume, turnover: null, dollar_volume: 100 })
const board = (rows: ReturnType<typeof mover>[]) => ({ meta: {}, gainers: rows, losers: [], active: [], undervaluedGrowth: [], growthTech: [], smallCaps: [], undervaluedLarge: [] })
const term = () => ({ meta: {}, curves: [{ symbol: 'BTC', spot: 100, points: [
  { expiration: '2027-06-25', price: 110, daysToExpiry: 180, annualizedBasis: 20 },
  { expiration: '2026-12-28', price: 101, daysToExpiry: 1, annualizedBasis: null },
  { expiration: '2027-01-29', price: null, daysToExpiry: 33, annualizedBasis: null },
] }] })

beforeEach(async () => {
  mocks.data = null; mocks.error = null; mocks.retry.mockReset(); mocks.open.mockReset()
  mocks.charts.length = 0; mocks.axes.length = 0; mocks.lines.length = 0; mocks.references.length = 0
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

describe('Movers reading', () => {
  it('searches the returned list and sorts finite values while preserving provider order and one-click navigation', async () => {
    const user = userEvent.setup()
    const rows = [mover('MISSING', null, Infinity), mover('HIGH', 5, 2), mover('ZERO', 0, 0)]
    mocks.data = board(rows)
    render(<MarketBoardPage spec={{ kind: 'market-board', params: { board: 'movers' } }} visible />)
    const symbols = () => within(screen.getByRole('table')).getAllByRole('button', { name: /Open .* details/ }).map(button => button.getAttribute('aria-label'))
    const search = screen.getByRole('textbox', { name: 'Search current list' })
    await user.type(search, 'zero company')
    expect(symbols()).toEqual(['Open ZERO details'])
    await user.clear(search)
    await user.click(screen.getByRole('button', { name: 'Price' }))
    expect(symbols()).toEqual(['Open HIGH details', 'Open ZERO details', 'Open MISSING details'])
    expect(screen.getByRole('columnheader', { name: /Price/ }).getAttribute('aria-sort')).toBe('descending')
    await user.click(screen.getByRole('button', { name: 'Price' }))
    expect(symbols()).toEqual(['Open ZERO details', 'Open HIGH details', 'Open MISSING details'])
    await user.click(screen.getByRole('button', { name: 'Price' }))
    expect(symbols()).toEqual(['Open MISSING details', 'Open HIGH details', 'Open ZERO details'])
    await user.click(screen.getByRole('button', { name: 'RVOL' }))
    expect(symbols()).toEqual(['Open HIGH details', 'Open ZERO details', 'Open MISSING details'])
    await user.click(screen.getByRole('button', { name: 'Open HIGH details' }))
    expect(mocks.open).toHaveBeenCalledTimes(1)
    expect(rows.map(row => row.symbol)).toEqual(['MISSING', 'HIGH', 'ZERO'])
  })

  it('lets an unavailable board retry without pretending it is an empty list', async () => {
    mocks.error = 'Unavailable'
    render(<MarketBoardPage spec={{ kind: 'market-board', params: { board: 'movers' } }} visible />)
    expect(screen.getByRole('alert').textContent).toContain('Unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.retry).toHaveBeenCalledTimes(1)
  })
})

describe('Term Structure reading', () => {
  it('does not replace a missing far-end quote with a nearer contract regime', () => {
    const payload = term()
    payload.curves[0].points[0].price = null
    mocks.data = payload
    render(<MarketBoardPage spec={{ kind: 'market-board', params: { board: 'term-structure' } }} visible />)
    expect(screen.queryByText('Far end at a premium')).toBeNull()
  })

  it('positions contracts on actual dates and keeps missing annualized basis as a gap', async () => {
    const user = userEvent.setup()
    mocks.data = term()
    render(<MarketBoardPage spec={{ kind: 'market-board', params: { board: 'term-structure' } }} visible />)
    expect(mocks.axes.at(-1)).toMatchObject({ dataKey: 'time', type: 'number' })
    const points = mocks.charts.at(-1)!.data
    expect(points.map(point => point.expiration)).toEqual(['2026-12-28', '2027-01-29', '2027-06-25'])
    expect(points[2].time! - points[1].time!).toBeGreaterThan(points[1].time! - points[0].time!)
    expect(mocks.references.at(-1)?.y).toBe(100)
    await user.click(screen.getByRole('button', { name: 'Annualized basis' }))
    expect(mocks.lines.at(-1)).toMatchObject({ dataKey: 'basis', connectNulls: false })
    expect(mocks.charts.at(-1)?.data.map(point => point.basis)).toEqual([null, null, 20])
    expect(mocks.references.at(-1)?.y).toBe(0)
    fireEvent.click(screen.getByText('Contract details'))
    expect(screen.getByRole('table', { name: 'BTC Contract details' })).toBeTruthy()
  })

  it('distinguishes far-end parity and does not infer a regime from an invalid reference', async () => {
    const user = userEvent.setup()
    const payload = term()
    payload.curves[0].points[0].price = 100
    mocks.data = payload
    const view = render(<MarketBoardPage spec={{ kind: 'market-board', params: { board: 'term-structure' } }} visible />)
    expect(screen.getByText('Far end at parity')).toBeTruthy()
    mocks.data = { ...payload, curves: [{ ...payload.curves[0], spot: 0 }] }
    view.rerender(<MarketBoardPage spec={{ kind: 'market-board', params: { board: 'term-structure' } }} visible />)
    expect(screen.queryByText('Far end at parity')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Annualized basis' }))
    expect(screen.getByRole('status').textContent).toContain('No annualized basis')
  })
})
