import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import type { EconomicCalendarBoard, EconomicCalendarEvent } from '../../api/reference'
import { NewsEconomicCalendar } from './NewsEconomicCalendar'

const mocks = vi.hoisted(() => ({ calendar: vi.fn() }))
vi.mock('../../api/reference', () => ({ referenceApi: { economicCalendar: mocks.calendar } }))
const event = (overrides: Partial<EconomicCalendarEvent> = {}): EconomicCalendarEvent => ({ date: '2026-10-25T11:00:00Z', event: 'Example economic release', country: 'Example country', importance: 'High', source: null, currency: 'USD', unit: '%', actual: 0, consensus: 0, previous: 0, ...overrides })
const board = (events = [event()]): EconomicCalendarBoard => ({ events, window: { start: '2026-10-25', end: '2026-11-08' }, meta: { provider: 'fixture', asOf: '2026-10-25T10:00:00Z' } })
beforeEach(async () => { await i18n.changeLanguage('en'); vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-25T10:00:00Z')); mocks.calendar.mockReset().mockResolvedValue(board()) })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('News economic calendar', () => {
  it('previews a real supplied time and preserves zero actual, forecast and previous values', async () => {
    render(<NewsEconomicCalendar locale="en" />)
    expect(await screen.findByText('Example economic release')).toBeTruthy()
    expect(screen.getByText('in 1 hour')).toBeTruthy()
    await userEvent.click(screen.getByText('Economic calendar', { selector: 'summary span' }))
    const release = await screen.findByRole('article', { name: 'Example economic release' })
    expect(within(release).getAllByText('0')).toHaveLength(3)
    expect(within(release).getByText('Forecast')).toBeTruthy()
    expect(within(release).getByText('Previous')).toBeTruthy()
  })
  it('does not guess a timezone or countdown and excludes invalid calendar dates', async () => {
    mocks.calendar.mockResolvedValue(board([event({ date: '2026-10-25 11:00:00' }), event({ date: '2026-02-30', event: 'Invalid event' })]))
    render(<NewsEconomicCalendar locale="en" />)
    await screen.findByText('Example economic release')
    expect(screen.getByText('Time or timezone not supplied')).toBeTruthy()
    expect(screen.queryByText('in 1 hour')).toBeNull()
    expect(screen.queryByText('Invalid event')).toBeNull()
  })
  it('keeps errors local and retries through the existing data path', async () => {
    mocks.calendar.mockRejectedValueOnce(new Error('Provider unavailable')).mockResolvedValueOnce(board())
    render(<NewsEconomicCalendar locale="en" />)
    await screen.findByText('Economic calendar unavailable')
    await userEvent.click(screen.getByRole('button', { name: 'Retry economic calendar' }))
    expect(await screen.findByText('Example economic release')).toBeTruthy()
    expect(mocks.calendar).toHaveBeenCalledTimes(2)
  })
})
