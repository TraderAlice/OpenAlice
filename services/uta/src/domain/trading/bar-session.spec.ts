import { describe, it, expect } from 'vitest'
import type { HistoricalBarsCapability } from '@traderalice/uta-protocol'
import { resolveBarSession } from './bar-session.js'

/** A broker that can actually filter (IBKR). */
const FILTERING: HistoricalBarsCapability = { supported: true, sessions: ['regular', 'extended'] }
/** A broker with no session filter (Alpaca / CCXT). */
const UNFILTERED: HistoricalBarsCapability = { supported: true }

describe('resolveBarSession — instrument defaults', () => {
  it('defaults stock-like instruments to regular hours', () => {
    for (const secType of ['STK', 'OPT', 'WAR', 'BOND', 'IND', 'FUND']) {
      expect(resolveBarSession(secType, undefined, FILTERING)).toEqual({ session: 'regular', forced: false })
    }
  })

  it('defaults an unknown or missing secType to regular hours', () => {
    expect(resolveBarSession(undefined, undefined, FILTERING)).toEqual({ session: 'regular', forced: false })
    expect(resolveBarSession('', undefined, FILTERING)).toEqual({ session: 'regular', forced: false })
    expect(resolveBarSession('BAG', undefined, FILTERING)).toEqual({ session: 'regular', forced: false })
  })

  it('defaults nearly-around-the-clock instruments to the continuous tape', () => {
    for (const secType of ['FUT', 'FOP', 'CFD', 'CMDTY']) {
      expect(resolveBarSession(secType, undefined, FILTERING)).toEqual({ session: 'extended', forced: false })
    }
  })

  it('defaults FX and crypto to the continuous tape', () => {
    expect(resolveBarSession('CASH', undefined, FILTERING)).toEqual({ session: 'extended', forced: false })
    expect(resolveBarSession('CRYPTO', undefined, FILTERING)).toEqual({ session: 'extended', forced: false })
  })

  it('matches secType case-insensitively and ignores surrounding whitespace', () => {
    expect(resolveBarSession(' cash ', 'regular', FILTERING)).toEqual({ session: 'extended', forced: true })
    expect(resolveBarSession('fut', undefined, FILTERING)).toEqual({ session: 'extended', forced: false })
  })
})

describe('resolveBarSession — explicit requests', () => {
  it('honors an explicit extended request on a stock', () => {
    expect(resolveBarSession('STK', 'extended', FILTERING)).toEqual({ session: 'extended', forced: false })
  })

  it('honors an explicit regular request on a future', () => {
    expect(resolveBarSession('FUT', 'regular', FILTERING)).toEqual({ session: 'regular', forced: false })
  })

  it('honors an explicit regular request on a stock (same as its default)', () => {
    expect(resolveBarSession('STK', 'regular', FILTERING)).toEqual({ session: 'regular', forced: false })
  })

  it('forces FX and crypto to extended even when regular is requested', () => {
    expect(resolveBarSession('CASH', 'regular', FILTERING)).toEqual({ session: 'extended', forced: true })
    expect(resolveBarSession('CRYPTO', 'regular', FILTERING)).toEqual({ session: 'extended', forced: true })
  })
})

describe('resolveBarSession — broker capability fallback', () => {
  it('falls back to a session the broker declares when the resolved one is unsupported', () => {
    const regularOnly: HistoricalBarsCapability = { supported: true, sessions: ['regular'] }
    expect(resolveBarSession('STK', 'extended', regularOnly)).toEqual({ session: 'regular', forced: true })
    expect(resolveBarSession('CASH', undefined, regularOnly)).toEqual({ session: 'regular', forced: true })
    const extendedOnly: HistoricalBarsCapability = { supported: true, sessions: ['extended'] }
    expect(resolveBarSession('STK', undefined, extendedOnly)).toEqual({ session: 'extended', forced: true })
  })

  it('forces extended when the broker declares no session filter', () => {
    expect(resolveBarSession('STK', undefined, UNFILTERED)).toEqual({ session: 'extended', forced: true })
    expect(resolveBarSession('STK', 'regular', UNFILTERED)).toEqual({ session: 'extended', forced: true })
  })

  it('does not mark extended as forced on an unfiltered broker when extended was already right', () => {
    expect(resolveBarSession('CRYPTO', undefined, UNFILTERED)).toEqual({ session: 'extended', forced: false })
    expect(resolveBarSession('STK', 'extended', UNFILTERED)).toEqual({ session: 'extended', forced: false })
  })

  it('forces extended when the broker lists sessions but not the resolved one', () => {
    const extendedOnly: HistoricalBarsCapability = { supported: true, sessions: ['extended'] }
    expect(resolveBarSession('STK', undefined, extendedOnly)).toEqual({ session: 'extended', forced: true })
  })

  it('treats a missing capability like a broker with no filter', () => {
    expect(resolveBarSession('STK', undefined, undefined)).toEqual({ session: 'extended', forced: true })
    expect(resolveBarSession('CASH', undefined, undefined)).toEqual({ session: 'extended', forced: false })
  })

  it('keeps the forced flag from the instrument rule when the broker can serve the result', () => {
    // The broker can serve extended, so the capability step must not clear the
    // instrument-forced flag.
    expect(resolveBarSession('CASH', 'regular', UNFILTERED)).toEqual({ session: 'extended', forced: true })
  })
})
