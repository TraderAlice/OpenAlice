import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveMt5TradeOrigin, parseMt5TradeLedgerCsv, summarizeMt5TradeLedger } from './trade-ledger.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('parseMt5TradeLedgerCsv', () => {
  it('parses deal rows and keeps tickets as strings', () => {
    const rows = parseMt5TradeLedgerCsv([
      'account_mode,server,login,broker,symbol,deal_ticket,order_ticket,position_id,time,entry,type,reason,volume,price,commission,fee,swap,profit,magic,comment',
      'demo,HFM-Demo,123456,hfmarkets,XAUUSD,987654321012345,123456789012345,555,2026-07-13T01:02:03.000Z,out,buy,client,0.01,2410.25,-0.07,0,-0.01,4.25,0,manual close',
    ].join('\n'))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      accountMode: 'demo',
      broker: 'hfmarkets',
      symbol: 'XAUUSD',
      dealTicket: '987654321012345',
      orderTicket: '123456789012345',
      positionId: '555',
      volume: 0.01,
      profit: 4.25,
    })
  })

  it('rejects malformed rows with a clear error', () => {
    expect(() => parseMt5TradeLedgerCsv('account_mode,server\nonly-one-column')).toThrow('Malformed MT5 trade ledger row 2')
  })
})

describe('deriveMt5TradeOrigin', () => {
  it('labels client zero-magic trades as manual', () => {
    expect(deriveMt5TradeOrigin({ magic: 0, reason: 'client', comment: 'closed from terminal' })).toBe('manual')
  })

  it('labels non-zero magic trades as ea', () => {
    expect(deriveMt5TradeOrigin({ magic: 880001, reason: 'expert', comment: 'JMB Goldmine' })).toBe('ea')
  })

  it('labels balance operations and unknown reasons separately', () => {
    expect(deriveMt5TradeOrigin({ magic: 0, reason: 'balance', comment: 'deposit' })).toBe('other')
    expect(deriveMt5TradeOrigin({ magic: 0, reason: '', comment: '' })).toBe('unknown')
  })
})

describe('summarizeMt5TradeLedger', () => {
  it('summarizes fresh demo trade history for a broker symbol', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-ledger-'))
    directories.push(root)
    const directory = join(root, 'hfmarkets', 'XAUUSD')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'deals.csv'), [
      'account_mode,server,login,broker,symbol,deal_ticket,order_ticket,position_id,time,entry,type,reason,volume,price,commission,fee,swap,profit,magic,comment',
      'demo,HFM-Demo,123456,hfmarkets,XAUUSD,1,11,101,2026-07-13T01:00:00.000Z,out,buy,client,0.01,2410.25,-0.07,0,-0.01,4.25,0,manual close',
      'demo,HFM-Demo,123456,hfmarkets,XAUUSD,2,12,102,2026-07-13T02:00:00.000Z,out,sell,expert,0.01,2408.25,-0.07,0,-0.01,-1.25,880001,JMB Goldmine demo',
    ].join('\n'))

    const summary = await summarizeMt5TradeLedger(root, 'hfmarkets', 'XAUUSD', new Date('2026-07-13T02:01:00.000Z'))

    expect(summary.state).toBe('learning')
    expect(summary.totalDeals).toBe(2)
    expect(summary.manualDeals).toBe(1)
    expect(summary.eaDeals).toBe(1)
    expect(summary.netProfit).toBeCloseTo(2.84)
    expect(summary.accountMode).toBe('demo')
  })

  it('blocks non-demo trade history from progression', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-ledger-'))
    directories.push(root)
    const directory = join(root, 'icmarkets', 'EURUSD')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'deals.csv'), [
      'account_mode,server,login,broker,symbol,deal_ticket,order_ticket,position_id,time,entry,type,reason,volume,price,commission,fee,swap,profit,magic,comment',
      'real,IC-Live,123456,icmarkets,EURUSD,1,11,101,2026-07-13T01:00:00.000Z,out,buy,client,0.01,1.17000,-0.07,0,0,1.25,0,manual close',
    ].join('\n'))

    const summary = await summarizeMt5TradeLedger(root, 'icmarkets', 'EURUSD', new Date('2026-07-13T02:01:00.000Z'))

    expect(summary.state).toBe('blocked')
    expect(summary.detail).toContain('non-demo')
  })

  it('does not learn from a ledger that has no rows for the requested broker symbol', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-ledger-'))
    directories.push(root)
    const directory = join(root, 'hfmarkets', 'XAUUSD')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'deals.csv'), [
      'account_mode,server,login,broker,symbol,deal_ticket,order_ticket,position_id,time,entry,type,reason,volume,price,commission,fee,swap,profit,magic,comment',
      'demo,HFM-Demo,123456,hfmarkets,EURUSD,1,11,101,2026-07-13T01:00:00.000Z,out,buy,client,0.01,1.17000,-0.07,0,0,1.25,0,manual close',
      'demo,IC-Demo,123456,icmarkets,XAUUSD,2,12,102,2026-07-13T01:05:00.000Z,out,sell,client,0.01,2410.25,-0.07,0,-0.01,4.25,0,manual close',
    ].join('\n'))

    const summary = await summarizeMt5TradeLedger(root, 'hfmarkets', 'XAUUSD', new Date('2026-07-13T02:01:00.000Z'))

    expect(summary.state).toBe('no_data')
    expect(summary.totalDeals).toBe(0)
    expect(summary.accountMode).toBeNull()
  })

  it('blocks mixed demo and real rows for the requested broker symbol', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-ledger-'))
    directories.push(root)
    const directory = join(root, 'icmarkets', 'EURUSD')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'deals.csv'), [
      'account_mode,server,login,broker,symbol,deal_ticket,order_ticket,position_id,time,entry,type,reason,volume,price,commission,fee,swap,profit,magic,comment',
      'demo,IC-Demo,123456,icmarkets,EURUSD,1,11,101,2026-07-13T01:00:00.000Z,out,buy,client,0.01,1.17000,-0.07,0,0,1.25,0,manual close',
      'real,IC-Live,123456,icmarkets,EURUSD,2,12,102,2026-07-13T01:05:00.000Z,out,sell,client,0.01,1.17100,-0.07,0,0,-0.75,0,manual close',
    ].join('\n'))

    const summary = await summarizeMt5TradeLedger(root, 'icmarkets', 'EURUSD', new Date('2026-07-13T02:01:00.000Z'))

    expect(summary.state).toBe('blocked')
    expect(summary.detail).toContain('non-demo')
    expect(summary.totalDeals).toBe(2)
  })

  it('blocks unreadable trade history instead of rejecting malformed ledger rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-ledger-'))
    directories.push(root)
    const directory = join(root, 'hfmarkets', 'XAUUSD')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'deals.csv'), [
      'account_mode,server,login,broker,symbol,deal_ticket,order_ticket,position_id,time,entry,type,reason,volume,price,commission,fee,swap,profit,magic,comment',
      'demo,HFM-Demo,123456,hfmarkets,XAUUSD,1',
    ].join('\n'))

    const summary = await summarizeMt5TradeLedger(root, 'hfmarkets', 'XAUUSD', new Date('2026-07-13T02:01:00.000Z'))

    expect(summary.state).toBe('blocked')
    expect(summary.label).toBe('Trade history unreadable')
    expect(summary.detail).toContain('Malformed MT5 trade ledger row 2')
    expect(summary.broker).toBe('hfmarkets')
    expect(summary.symbol).toBe('XAUUSD')
    expect(summary.lastUpdated).toEqual(expect.any(String))
    expect(summary.totalDeals).toBe(0)
    expect(summary.manualDeals).toBe(0)
    expect(summary.eaDeals).toBe(0)
    expect(summary.otherDeals).toBe(0)
    expect(summary.unknownDeals).toBe(0)
    expect(summary.netProfit).toBe(0)
  })
})
