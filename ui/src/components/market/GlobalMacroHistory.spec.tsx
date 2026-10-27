// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { GlobalMacroHistory } from './GlobalMacroHistory'

vi.mock('../MeasuredChartFrame', () => ({
  MeasuredChartFrame: ({ children }: { children: (size: { width: number; height: number }) => ReactNode }) => children({ width: 480, height: 180 }),
}))
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)
const format = (value: number) => `${value.toFixed(2)}%`
const periods = ['2025-01-01', '2025-02-01', '2025-03-01', '2025-04-01']

it('renders actual zero/negative observations and breaks the curve at a missing period', () => {
  const cell = { value: -1, date: periods[3], history: [{ date: periods[0], value: 0 }, { date: periods[2], value: 2 }, { date: periods[3], value: -1 }] }
  const { container } = render(<GlobalMacroHistory cell={cell} periods={periods} period={periods[0]} title="China CPI history" format={format} />)
  expect(screen.getByLabelText('Selected observation: 0.00%, 2025-01-01')).toBeTruthy()
  expect(screen.getByText('3 observations')).toBeTruthy()
  const curve = container.querySelector('.recharts-line-curve')
  expect(curve).toBeTruthy()
  expect(curve!.getAttribute('d')?.match(/M/g)).toHaveLength(2)
})

it('shows a missing selected observation explicitly instead of carrying an older value', () => {
  render(<GlobalMacroHistory cell={{ value: 0, date: periods[0], history: [{ date: periods[0], value: 0 }] }} periods={periods} period={periods[1]} title="China CPI history" format={format} />)
  expect(screen.getByLabelText('Selected observation: No data, 2025-02-01')).toBeTruthy()
  expect(screen.getByText('1 observation')).toBeTruthy()
  expect(document.querySelector('.recharts-line-dot')).toBeTruthy()
})

it('keeps separated singleton observations visible across missing periods', () => {
  const cell = { value: -1, date: periods[2], history: [{ date: periods[0], value: 0 }, { date: periods[2], value: -1 }] }
  const { container } = render(<GlobalMacroHistory cell={cell} periods={periods} period={periods[0]} title="China CPI history" format={format} />)
  expect(screen.getByText('2 observations')).toBeTruthy()
  expect(container.querySelectorAll('.recharts-line-dot')).toHaveLength(2)
})

it('does not turn a legacy snapshot into invented history', () => {
  render(<GlobalMacroHistory cell={{ value: 4, date: periods[3] }} periods={periods} period={periods[3]} title="China CPI history" format={format} />)
  expect(screen.getByText('No historical observations for this indicator.')).toBeTruthy()
  expect(document.querySelector('.recharts-line')).toBeNull()
})
