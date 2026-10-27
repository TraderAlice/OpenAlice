// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MarketRotationPage } from './MarketRotationPage'
import { i18n } from '../i18n'

const mocks = vi.hoisted(() => ({
  sectorRotation: vi.fn(),
  open: vi.fn(),
  axes: [] as Array<{ dataKey?: string; domain?: number[]; name?: string }>,
  scatters: [] as Array<{ data: Array<{ x: number; y: number }>; isAnimationActive?: boolean }>,
}))

vi.mock('../tabs/store', () => ({ useWorkspace: (select: (state: { openOrFocus: typeof mocks.open }) => unknown) => select({ openOrFocus: mocks.open }) }))

vi.mock('../api/market', () => ({
  marketApi: {
    sectorRotation: mocks.sectorRotation,
  },
}))

vi.mock('../components/MeasuredChartFrame', () => ({
  MeasuredChartFrame: ({ children }: { children: (size: { width: number; height: number }) => ReactNode }) => <div data-testid="rotation-chart">{children({ width: 640, height: 280 })}</div>,
}))
vi.mock('recharts', async original => ({
  ...await original<typeof import('recharts')>(),
  ScatterChart: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Scatter: (props: typeof mocks.scatters[number]) => { mocks.scatters.push(props); return null },
  XAxis: (props: typeof mocks.axes[number]) => { mocks.axes.push(props); return null },
  YAxis: (props: typeof mocks.axes[number]) => { mocks.axes.push(props); return null },
  ReferenceLine: () => null, Tooltip: () => null,
}))

beforeEach(async () => {
  vi.clearAllMocks()
  mocks.axes.length = 0; mocks.scatters.length = 0
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

const performance = { '1D': 0.01, '1W': 0.02, '1M': 0.04, '3M': 0.06, '6M': 0.08 }
const sector = (symbol: string, score: number) => ({ symbol, sector: `${symbol} sector`, returns: { ...performance }, rel_strength: { ...performance }, momentum_acceleration: 0, dollar_volume: 100, dv_share: 0.1, dv_share_change: 0.01, rvol: 1, rotation_score: score, bars: 130 })
const rotation = () => ({ asOf: '2026-10-26', benchmark: { symbol: 'SPY', returns: performance }, sectors: [sector('XLK', 1), sector('XLE', 0)], methodology: 'Recovered methodology' })

describe('MarketRotationPage recovery', () => {
  it.each([-0.02, 0])('keeps zero inside both axes for negative or flat observations (%s)', async value => {
    const payload = rotation()
    payload.sectors = [{ ...sector('XLK', 0), rel_strength: { ...performance, '1M': value }, dv_share_change: value }]
    mocks.sectorRotation.mockResolvedValue(payload)
    render(<MarketRotationPage />)
    await screen.findByRole('table')
    for (const axis of mocks.axes.slice(-2)) {
      expect(axis.domain![0]).toBeLessThan(0)
      expect(axis.domain![1]).toBeGreaterThan(0)
    }
    expect(mocks.scatters.at(-1)?.data[0]).toMatchObject({ x: value * 100, y: value * 100 })
    expect(mocks.scatters.at(-1)?.isAnimationActive).toBe(false)
  })

  it('keeps zero inside both axes, changes the return period and labels differences as percentage points', async () => {
    const payload = rotation()
    payload.sectors.push({ ...sector('BAD', 2), dv_share_change: Infinity })
    mocks.sectorRotation.mockResolvedValue(payload)
    render(<MarketRotationPage />)
    await screen.findByRole('table')
    for (const axis of mocks.axes.slice(-2)) {
      expect(typeof axis.domain?.[0]).toBe('number')
      expect(axis.domain![0]).toBeLessThan(0)
      expect(axis.domain![1]).toBeGreaterThan(0)
    }
    expect(mocks.scatters.at(-1)?.data).toHaveLength(2)
    fireEvent.click(within(screen.getByRole('group', { name: 'Performance period' })).getByRole('button', { name: '6M' }))
    expect(mocks.scatters.at(-1)?.data[0].x).toBe(8)
    expect(mocks.axes.at(-2)?.name).toContain('6M')
    expect(mocks.axes.at(-2)?.name).toContain('pp')
    expect(screen.getByRole('columnheader', { name: /vs SPY.*6M/ })).toBeTruthy()
    expect(screen.getAllByText('+1.00 pp')).toHaveLength(2)
  })

  it('sorts the table without changing source data and opens ETF details from the keyboard', async () => {
    const payload = rotation()
    mocks.sectorRotation.mockResolvedValue(payload)
    render(<MarketRotationPage />)
    await screen.findByRole('table')
    fireEvent.click(screen.getByRole('button', { name: 'Score' }))
    fireEvent.click(screen.getByRole('button', { name: 'Score' }))
    const rows = within(screen.getByRole('table')).getAllByRole('row')
    expect(rows[1].textContent).toContain('XLE')
    fireEvent.click(screen.getByRole('button', { name: 'Open XLK details' }))
    expect(mocks.open).toHaveBeenCalledWith({ kind: 'market-detail', params: { assetClass: 'equity', symbol: 'XLK' } })
    expect(payload.sectors.map(row => row.symbol)).toEqual(['XLK', 'XLE'])
  })

  it('lets the user retry an initial board failure immediately', async () => {
    mocks.sectorRotation
      .mockRejectedValueOnce(new Error('Rotation board unavailable'))
      .mockResolvedValueOnce(rotation())

    render(<MarketRotationPage />)

    expect((await screen.findByRole('alert')).textContent).toContain('Rotation board unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByText('Recovered methodology')
    await waitFor(() => expect(mocks.sectorRotation).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()
    // Keep both sections at their natural height inside the page's scroll area.
    expect(screen.getByTestId('sector-rotation-table-scroll').classList.contains('shrink-0')).toBe(true)
    expect(screen.getByTestId('rotation-chart').parentElement?.classList.contains('shrink-0')).toBe(true)
  })
})
