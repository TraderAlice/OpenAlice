import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { CnLocalPaperBroker } from './CnLocalPaperBroker.js'
import type { CnQuoteSnapshot } from './cn-quote.js'
import { parseCnPaperBookState } from './cn-paper-book.js'

function snap(overrides: Partial<CnQuoteSnapshot> = {}): CnQuoteSnapshot {
  const prev = overrides.prevClose ?? 10
  return {
    code: '600519',
    market: 'sh',
    tencentCode: 'sh600519',
    name: 'Kweichow Moutai',
    last: 10,
    prevClose: prev,
    open: 10,
    bid: 9.99,
    ask: 10.01,
    volume: 1_000_000,
    limitUp: Math.round(prev * 1.1 * 100) / 100,
    limitDown: Math.round(prev * 0.9 * 100) / 100,
    timestamp: new Date(),
    ...overrides,
  }
}

describe('CnLocalPaperBroker bookkeeping', () => {
  let broker: CnLocalPaperBroker

  beforeEach(async () => {
    broker = new CnLocalPaperBroker({
      id: 'cn-book-test',
      cash: 1_000_000,
      quoteProvider: 'manual',
      enforceSession: false,
      enforceLotSize: false,
      enforceTPlus1: true,
      enforceLimitBand: false,
    })
    await broker.init()
    broker.setMarkPrice('600519', 10, snap())
  })

  afterEach(async () => {
    await broker.close()
  })

  it('adjustBookCash credits and debits cash', async () => {
    broker.adjustBookCash(50_000)
    expect(Number((await broker.getAccount()).totalCashValue)).toBe(1_050_000)
    broker.adjustBookCash(-20_000)
    expect(Number((await broker.getAccount()).totalCashValue)).toBe(1_030_000)
  })

  it('rejects cash adjust that would go negative', () => {
    expect(() => broker.adjustBookCash(-2_000_000)).toThrow(/negative/)
  })

  it('adjustBookPosition adds shares and locks T+1 by default', async () => {
    broker.adjustBookPosition({ nativeKey: '600519', quantityDelta: 200, avgCost: 9.5 })
    const view = await broker.getBookView()
    expect(view.positions).toHaveLength(1)
    expect(view.positions[0]!.quantity).toBe('200')
    expect(view.positions[0]!.avgCost).toBe('9.5')
    expect(view.positions[0]!.locked).toBe('200')
    expect(view.positions[0]!.sellable).toBe('0')
  })

  it('setSellable reclassifies locked vs sellable', async () => {
    broker.adjustBookPosition({ nativeKey: '600519', quantityDelta: 300, avgCost: 10 })
    broker.setSellable({ nativeKey: '600519', sellable: 200 })
    const view = await broker.getBookView()
    expect(view.positions[0]!.sellable).toBe('200')
    expect(view.positions[0]!.locked).toBe('100')
  })

  it('setBookSnapshot replaces cash and positions', async () => {
    broker.adjustBookCash(1)
    broker.setBookSnapshot({
      cash: 500_000,
      positions: [
        { nativeKey: '600519', quantity: 100, avgCost: 12, sellable: 100 },
      ],
    })
    const view = await broker.getBookView()
    expect(view.cash).toBe('500000')
    expect(view.positions).toHaveLength(1)
    expect(view.positions[0]!.sellable).toBe('100')
    expect(view.positions[0]!.locked).toBe('0')
  })

  it('export/import round-trips cash, positions, and T+1 locks', async () => {
    broker.adjustBookPosition({ nativeKey: '600519', quantityDelta: 100, avgCost: 11 })
    broker.setSellable({ nativeKey: '600519', sellable: 40 })
    broker.adjustBookCash(-1_000)
    const exported = broker.exportBookState()
    expect(exported.version).toBe(1)
    expect(exported.boughtToday[0]?.qty).toBe('60')

    const other = new CnLocalPaperBroker({
      id: 'cn-book-test',
      cash: 1_000_000,
      quoteProvider: 'manual',
      enforceSession: false,
    })
    await other.init()
    other.importBookState(exported)
    const view = await other.getBookView()
    expect(Number(view.cash)).toBe(999_000)
    expect(view.positions[0]!.quantity).toBe('100')
    expect(view.positions[0]!.sellable).toBe('40')
    expect(view.positions[0]!.locked).toBe('60')
    await other.close()
  })

  it('persister receives snapshots after adjust', async () => {
    const seen: unknown[] = []
    broker.setBookPersister((state) => { seen.push(state) })
    broker.adjustBookCash(100)
    // allow microtask chain
    await Promise.resolve()
    await Promise.resolve()
    expect(seen.length).toBeGreaterThanOrEqual(1)
    const parsed = parseCnPaperBookState(seen[seen.length - 1])
    expect(Number(parsed.cash)).toBe(1_000_100)
  })
})

describe('cn-paper-persistence file round-trip', () => {
  it('writes and reloads book JSON under OPENALICE_HOME', async () => {
    const home = join(tmpdir(), `cn-paper-book-${Date.now()}`)
    const prev = process.env.OPENALICE_HOME
    process.env.OPENALICE_HOME = home
    try {
      // Dynamic import after env so dataPath resolves to tmp home.
      vi.resetModules()
      const { createCnPaperBookPersister, loadCnPaperBook } = await import('../../cn-paper-persistence.js')
      const persist = createCnPaperBookPersister('uta-cn-test')
      await persist({
        version: 1,
        cash: '123456',
        positions: [{ nativeKey: '600519', quantity: '100', avgCost: '10' }],
        boughtToday: [{ nativeKey: '600519', day: '2026-09-28', qty: '40' }],
        markPrices: [{ nativeKey: '600519', price: '10.5' }],
      })
      const loaded = await loadCnPaperBook('uta-cn-test')
      expect(loaded?.cash).toBe('123456')
      expect(loaded?.positions[0]?.quantity).toBe('100')
      expect(loaded?.boughtToday[0]?.qty).toBe('40')
      const raw = await readFile(join(home, 'data', 'trading', 'uta-cn-test', 'cn-paper-book.json'), 'utf-8')
      expect(raw).toContain('600519')
    } finally {
      if (prev === undefined) delete process.env.OPENALICE_HOME
      else process.env.OPENALICE_HOME = prev
      await rm(home, { recursive: true, force: true }).catch(() => {})
    }
  })
})
