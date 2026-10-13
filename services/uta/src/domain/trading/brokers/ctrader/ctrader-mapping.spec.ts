import { describe, it, expect } from 'vitest'
import Decimal from 'decimal.js'
import {
  OrderStatus,
  OrderType,
  TimeInForce,
  classifyAssetClass,
  formatGoodTillDate,
  money,
  orderStatusToIbkr,
  orderTypeToIbkr,
  plainPrice,
  scaledPrice,
  scheduleClock,
  secondsIntoWeek,
  timeInForceToIbkr,
  trendbarToBar,
  unitsToVolume,
  volumeToUnits,
} from './ctrader-mapping.js'

describe('numeric encodings', () => {
  it('decodes 1/100000-scaled prices to the symbol digits', () => {
    expect(scaledPrice(112016, 5)).toBe('1.12016')
    expect(scaledPrice(53423782)).toBe('534.23782')
    expect(scaledPrice(419501000, 2)).toBe('4195.01')
    expect(scaledPrice(419501789, 2)).toBe('4195.02')
  })

  it('rounds plain double prices without float artifacts', () => {
    expect(plainPrice(1.1 + 0.2, 5)).toBe('1.3')
    expect(plainPrice(4195.214999, 2)).toBe('4195.21')
  })

  it('scales money by moneyDigits, defaulting to 2', () => {
    expect(money(10053099944, 8)).toBe('100.53099944')
    expect(money(100000, undefined)).toBe('1000')
    expect(money(-1700, 2)).toBe('-17')
    expect(money(undefined, 2)).toBe('0')
  })

  it('converts volume cents to units and back exactly', () => {
    expect(volumeToUnits(1000).toString()).toBe('10')
    expect(volumeToUnits(150).toString()).toBe('1.5')
    expect(unitsToVolume(new Decimal('10'))).toBe(1000)
    expect(unitsToVolume(new Decimal('0.01'))).toBe(1)
    expect(() => unitsToVolume(new Decimal('0.001'))).toThrow(/finer than/)
  })
})

describe('enum mapping', () => {
  it('maps order types to IBKR strings', () => {
    expect(orderTypeToIbkr(OrderType.MARKET)).toBe('MKT')
    expect(orderTypeToIbkr(OrderType.MARKET_RANGE)).toBe('MKT')
    expect(orderTypeToIbkr(OrderType.LIMIT)).toBe('LMT')
    expect(orderTypeToIbkr(OrderType.STOP)).toBe('STP')
    expect(orderTypeToIbkr(OrderType.STOP_LIMIT)).toBe('STP LMT')
  })

  it('maps order statuses, keeping partially filled orders working', () => {
    expect(orderStatusToIbkr(OrderStatus.ACCEPTED)).toBe('Submitted')
    expect(orderStatusToIbkr(OrderStatus.FILLED)).toBe('Filled')
    expect(orderStatusToIbkr(OrderStatus.REJECTED)).toBe('Inactive')
    expect(orderStatusToIbkr(OrderStatus.EXPIRED)).toBe('Cancelled')
    expect(orderStatusToIbkr(OrderStatus.CANCELLED)).toBe('Cancelled')
  })

  it('maps time in force with the proto default of IOC', () => {
    expect(timeInForceToIbkr(TimeInForce.GOOD_TILL_CANCEL)).toBe('GTC')
    expect(timeInForceToIbkr(TimeInForce.GOOD_TILL_DATE)).toBe('GTD')
    expect(timeInForceToIbkr(TimeInForce.FILL_OR_KILL)).toBe('FOK')
    expect(timeInForceToIbkr(TimeInForce.MARKET_ON_OPEN)).toBe('OPG')
    expect(timeInForceToIbkr(undefined)).toBe('IOC')
  })

  it('formats good-till-date in UTC', () => {
    expect(formatGoodTillDate(Date.UTC(2026, 9, 12, 21, 5, 9))).toBe('20261012 21:05:09 UTC')
  })
})

describe('classifyAssetClass', () => {
  it.each([
    [['Forex', 'Majors'], 'currency'],
    [['FX'], 'currency'],
    [['Metals', 'Spot Metals'], 'commodity'],
    [['Commodities', 'Energy'], 'commodity'],
    [['Indices'], 'equity'],
    [['Stocks', 'US Shares'], 'equity'],
    [['ETFs'], 'equity'],
    [['Crypto', 'Cryptocurrencies'], 'crypto'],
    [['Something else'], 'unknown'],
    [[undefined], 'unknown'],
  ] as const)('classifies %j as %s', (names, expected) => {
    expect(classifyAssetClass(...names)).toBe(expected)
  })
})

describe('trendbarToBar', () => {
  it('rebuilds OHLC from low plus deltas', () => {
    const bar = trendbarToBar({ low: 112000, deltaOpen: 10, deltaHigh: 30, deltaClose: 16, volume: 42, utcTimestampInMinutes: 29_000_000 }, 5)
    expect(bar).toEqual({
      timestamp: new Date(29_000_000 * 60_000),
      open: '1.1201', high: '1.1203', low: '1.12', close: '1.12016', volume: '42',
    })
  })

  it('drops incomplete rows', () => {
    expect(trendbarToBar({ deltaOpen: 1 })).toBeNull()
  })
})

describe('trading schedule', () => {
  // Sunday 22:00 → Friday 22:00 UTC, the usual FX week.
  const fxWeek = [{ startSecond: 22 * 3600, endSecond: 5 * 86_400 + 22 * 3600 }]

  it('counts seconds from Sunday 00:00 in the schedule time zone', () => {
    expect(secondsIntoWeek(new Date('2026-10-11T00:00:00Z'), 'UTC')).toBe(0)
    expect(secondsIntoWeek(new Date('2026-10-12T01:02:03Z'), 'UTC')).toBe(86_400 + 3723)
    // 23:30 UTC Saturday is already Sunday 00:30 in Berlin (UTC+2 in October).
    expect(secondsIntoWeek(new Date('2026-10-10T22:30:00Z'), 'Europe/Berlin')).toBe(30 * 60)
  })

  it('reports closed on Saturday with the Sunday open', () => {
    const clock = scheduleClock(fxWeek, 'UTC', new Date('2026-10-10T16:00:00Z'))
    expect(clock.isOpen).toBe(false)
    expect(clock.nextOpen).toEqual(new Date('2026-10-11T22:00:00Z'))
  })

  it('reports open mid-week with the Friday close', () => {
    const clock = scheduleClock(fxWeek, 'UTC', new Date('2026-10-14T09:00:00Z'))
    expect(clock.isOpen).toBe(true)
    expect(clock.nextClose).toEqual(new Date('2026-10-16T22:00:00Z'))
  })

  it('finds the next interval of a split day', () => {
    const daily = [1, 2, 3, 4, 5].flatMap((d) => [
      { startSecond: d * 86_400 + 1 * 3600, endSecond: d * 86_400 + 12 * 3600 },
      { startSecond: d * 86_400 + 13 * 3600, endSecond: d * 86_400 + 21 * 3600 },
    ])
    const clock = scheduleClock(daily, 'UTC', new Date('2026-10-13T12:30:00Z'))
    expect(clock).toMatchObject({ isOpen: false, nextOpen: new Date('2026-10-13T13:00:00Z') })
  })

  it('lands on the exact schedule second in the venue time zone (real EURUSD demo schedule)', () => {
    // Spotware demo EURUSD, America/New_York: Sun 17:00:05 → Mon 16:29:55, daily.
    const eurusd = [
      { startSecond: 61_205, endSecond: 145_795 }, { startSecond: 147_605, endSecond: 232_195 },
      { startSecond: 234_005, endSecond: 318_595 }, { startSecond: 320_405, endSecond: 404_995 },
      { startSecond: 406_805, endSecond: 491_395 },
    ]
    const clock = scheduleClock(eurusd, 'America/New_York', new Date('2026-10-13T13:56:40.882Z'))
    expect(clock).toMatchObject({ isOpen: true, nextClose: new Date('2026-10-13T20:29:55.000Z') })
  })

  it('treats a symbol without schedule as always open', () => {
    expect(scheduleClock([], undefined, new Date()).isOpen).toBe(true)
  })
})
