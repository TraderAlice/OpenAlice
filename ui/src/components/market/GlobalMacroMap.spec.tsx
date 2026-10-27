// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GlobalMacroRow } from '../../api/reference'
import { i18n } from '../../i18n'
import { GlobalMacroMap } from './GlobalMacroMap'
import world from './world-map.json'

vi.mock('../MeasuredChartFrame', () => ({ MeasuredChartFrame: () => null }))

const cell = (value: number | null, date: string | null = '2025-01-01') => ({ value, date })
function row(country: string, label: string, value: number | null, date: string | null = '2025-01-01'): GlobalMacroRow {
  return { country, label, cpiYoy: cell(value, date), shortRate: cell(3.5, '2026-09-01'), cli: cell(101, '2026-09-01'), housePrice: cell(100), sharePrice: cell(120) }
}
const rows = [row('US', 'United States', 4, '2024-01-01'), row('china', 'China', 0), row('germany', 'Germany', 2), row('japan', 'Japan', 3, null), row('united_kingdom', 'United Kingdom', NaN)]
beforeEach(async () => { await i18n.changeLanguage('en') })
afterEach(cleanup)

it('draws the selected country historical observations and follows the timeline selection', () => {
  const historical = row('US', 'United States', 4, '2025-02-01')
  historical.cpiYoy.history = [{ date: '2025-01-01', value: 0 }, { date: '2025-02-01', value: 4 }]
  render(<GlobalMacroMap rows={[historical]} selectedCountry="US" onSelectCountry={vi.fn()} />)
  expect(screen.getByRole('figure', { name: 'United States · CPI YoY history' })).toBeTruthy()
  fireEvent.change(screen.getByRole('slider', { name: 'Historical timeline' }), { target: { value: '0' } })
  expect(screen.getByLabelText('Selected observation: 0.00%, 2025-01-01')).toBeTruthy()
})

it('shows a country value/date card on hover and keyboard focus while preserving country selection', async () => {
  const user = userEvent.setup()
  const select = vi.fn()
  render(<GlobalMacroMap rows={rows} selectedCountry={null} onSelectCountry={select} />)
  const china = screen.getByRole('button', { name: /^China: CPI YoY/ })
  await user.hover(china)
  const tooltip = await screen.findByRole('tooltip')
  expect(within(tooltip).getByText('China')).toBeTruthy()
  expect(within(tooltip).getByText('0.00%')).toBeTruthy()
  expect(within(tooltip).getByText('2025-01-01')).toBeTruthy()
  expect(select).not.toHaveBeenCalled()
  await user.unhover(china)
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  china.focus()
  expect(await screen.findByRole('tooltip')).toBeTruthy()
  await user.keyboard('{Enter}')
  expect(select).toHaveBeenLastCalledWith('china')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
})

it('highlights an exact value range on hover, supports a pinned range and resets it on period changes', async () => {
  const user = userEvent.setup()
  render(<GlobalMacroMap rows={rows} selectedCountry={null} onSelectCountry={vi.fn()} />)
  const china = screen.getByRole('button', { name: /^China: CPI YoY/ })
  const germany = screen.getByRole('button', { name: /^Germany: CPI YoY/ })
  const original = germany.getAttribute('fill-opacity')
  const low = screen.getByRole('button', { name: /^Value range 0.00% to 0.40%/ })
  await user.hover(low)
  expect(Number(germany.getAttribute('fill-opacity'))).toBeLessThan(Number(original))
  expect(china.getAttribute('fill-opacity')).toBe('0.25')
  await user.click(low)
  await user.unhover(low)
  expect(low.getAttribute('aria-pressed')).toBe('true')
  expect(Number(germany.getAttribute('fill-opacity'))).toBeLessThan(Number(original))
  await user.keyboard('{Escape}')
  expect(germany.getAttribute('fill-opacity')).toBe(original)
  await user.click(low)
  await user.selectOptions(screen.getByRole('combobox', { name: 'Observation period' }), '2024-01-01')
  expect(screen.getAllByRole('button', { name: /^Value range/ })).toHaveLength(1)
  expect(screen.getByRole('button', { name: /^Value range/ }).getAttribute('aria-pressed')).toBe('false')
})

it('keeps the Taiwan geometry in the same China fill, selection and accessible control', async () => {
  const user = userEvent.setup()
  const select = vi.fn()
  const { rerender } = render(<GlobalMacroMap rows={rows} selectedCountry="china" onSelectCountry={select} />)
  const china = screen.getByRole('button', { name: /^China: CPI YoY/ })
  expect(china.getAttribute('d')).toContain(world.countries.find(country => country.id === 'TW')!.path)
  expect(china.getAttribute('aria-pressed')).toBe('true')
  expect(china.getAttribute('stroke')).toBe('var(--primary)')
  expect(china.getAttribute('fill')).toBe('var(--chart-1)')
  expect(screen.queryByText('Taiwan', { exact: true })).toBeNull()
  await user.click(china)
  expect(select).toHaveBeenLastCalledWith('china')
  rerender(<GlobalMacroMap rows={rows} selectedCountry="US" onSelectCountry={select} />)
  expect(china.getAttribute('aria-pressed')).toBe('false')
  expect(china.getAttribute('stroke')).toBe('var(--background)')
})

it('scrubs real history with linked dates, colors, range, previous/next and latest controls', async () => {
  const user = userEvent.setup()
  const historical = row('US', 'United States', 9, '2025-04-01')
  historical.cpiYoy.history = [{ date: '2025-01-01', value: 0 }, { date: '2025-02-01', value: -1 }, { date: '2025-04-01', value: 4 }]
  const onPeriodChange = vi.fn()
  render(<GlobalMacroMap rows={[historical]} selectedCountry="US" onSelectCountry={vi.fn()} onPeriodChange={onPeriodChange} />)
  const slider = screen.getByRole('slider', { name: 'Historical timeline' }) as HTMLInputElement
  expect(slider.getAttribute('aria-valuetext')).toBe('2025-04-01')
  fireEvent.change(slider, { target: { value: '0' } })
  expect(screen.getByRole('button', { name: /^United States: CPI YoY 0.00%, 2025-01-01/ })).toBeTruthy()
  expect(slider.getAttribute('aria-valuetext')).toBe('2025-01-01')
  expect(onPeriodChange).toHaveBeenLastCalledWith('2025-01-01')
  expect((screen.getByRole('button', { name: 'Previous period' }) as HTMLButtonElement).disabled).toBe(true)
  await user.click(screen.getByRole('button', { name: 'Next period' }))
  expect(slider.getAttribute('aria-valuetext')).toBe('2025-02-01')
  await user.click(screen.getByRole('button', { name: 'Latest period' }))
  expect(slider.getAttribute('aria-valuetext')).toBe('2025-04-01')
  expect(screen.getByRole('button', { name: /^United States: CPI YoY 4.00%, 2025-04-01/ })).toBeTruthy()
  await user.selectOptions(screen.getByRole('combobox', { name: 'Indicator' }), 'shortRate')
  expect(slider.disabled).toBe(true)
  expect(screen.getByText('History unavailable; showing snapshot observations.')).toBeTruthy()
})

it('compares one supplied period, includes zero, and leaves old, undated and invalid cells uncolored', () => {
  render(<GlobalMacroMap rows={rows} selectedCountry={null} onSelectCountry={vi.fn()} />)
  expect((screen.getByRole('combobox', { name: 'Observation period' }) as HTMLSelectElement).value).toBe('2025-01-01')
  expect(screen.getByRole('status').textContent).toContain('2 of 5 countries')
  expect(screen.getByRole('button', { name: /^China: CPI YoY 0.00%/ }).getAttribute('fill')).not.toBe('var(--muted)')
  for (const name of ['United States', 'Japan', 'United Kingdom']) {
    expect(screen.getByRole('button', { name: `${name}: No data for this period` }).getAttribute('fill')).toBe('var(--muted)')
  }
  expect(screen.getByText('0.00%')).toBeTruthy()
})

it('switches metric and observation period without treating the snapshot as a full history', async () => {
  const user = userEvent.setup()
  render(<GlobalMacroMap rows={rows} selectedCountry={null} onSelectCountry={vi.fn()} />)
  await user.selectOptions(screen.getByRole('combobox', { name: 'Observation period' }), '2024-01-01')
  expect(screen.getByRole('status').textContent).toContain('1 of 5 countries')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Indicator' }), 'shortRate')
  expect((screen.getByRole('combobox', { name: 'Observation period' }) as HTMLSelectElement).value).toBe('2026-09-01')
  expect(screen.getByRole('status').textContent).toContain('5 of 5 countries')
})

it('selects supplied countries through the keyboard or native selector and supports zoom/reset', async () => {
  const user = userEvent.setup()
  const select = vi.fn()
  render(<GlobalMacroMap rows={rows} selectedCountry={null} onSelectCountry={select} />)
  const china = screen.getByRole('button', { name: /^China: CPI YoY/ })
  china.focus()
  await user.keyboard('{Enter}')
  expect(select).toHaveBeenLastCalledWith('china')
  await user.selectOptions(screen.getByRole('combobox', { name: 'Country' }), 'US')
  expect(select).toHaveBeenLastCalledWith('US')
  const map = screen.getByRole('group', { name: 'World macro map' })
  const initial = map.getAttribute('viewBox')
  await user.click(screen.getByRole('button', { name: 'Zoom in' }))
  expect(map.getAttribute('viewBox')).not.toBe(initial)
  await user.click(screen.getByRole('button', { name: 'Reset map' }))
  expect(map.getAttribute('viewBox')).toBe(initial)
})

it('keeps an empty or entirely undated response readable without fabricating a period', () => {
  render(<GlobalMacroMap rows={[row('china', 'China', 0, null)]} selectedCountry={null} onSelectCountry={vi.fn()} />)
  expect((screen.getByRole('combobox', { name: 'Observation period' }) as HTMLSelectElement).disabled).toBe(true)
  expect(screen.getByRole('status').textContent).toContain('0 of 1 countries')
  expect(screen.getByRole('button', { name: 'China: No data for this period' }).getAttribute('fill')).toBe('var(--muted)')
})
