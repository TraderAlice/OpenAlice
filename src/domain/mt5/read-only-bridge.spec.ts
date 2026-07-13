import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readMt5ReadOnlyBridge } from './read-only-bridge.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('readMt5ReadOnlyBridge', () => {
  it('defaults bridge exports to the exact Gold demo symbol', async () => {
    const source = await readFile(join(process.cwd(), 'tools', 'mt5', 'OpenAliceMt5ReadOnlyBridge.mq5'), 'utf8')

    expect(source).toContain('input string InpSymbol = "XAUUSD";')
    expect(source).not.toContain('input string InpSymbol = "XAUUSDb";')
    expect(source).toContain('OUTPUT_ROOT+"\\\\"+InpBrokerId+"\\\\"+InpSymbol+"\\\\completed_d1.csv"')
  })

  it('accepts a fresh demo-only read-only heartbeat', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-mt5-'))
    directories.push(root)
    const directory = join(root, 'hfmarkets', 'XAUUSDb')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'status.csv'), [
      'captured_at,broker,symbol,bridge_mode,account_mode,server,terminal_connected,bid,ask,spread_price,open_positions,open_orders',
      '2026-06-23T12:00:00,hfmarkets,XAUUSDb,read_only,demo,HFM-Demo,1,2345.10,2345.30,0.20,0,0',
    ].join('\n'))

    const status = await readMt5ReadOnlyBridge(root, 'hfmarkets', 'XAUUSDb')

    expect(status.state).toBe('ready')
    expect(status.spread).toBeCloseTo(0.2)
    expect(status.server).toBe('HFM-Demo')
  })

  it('blocks a heartbeat that is not a demo account', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-mt5-'))
    directories.push(root)
    const directory = join(root, 'icmarkets', 'XAUUSD')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'status.csv'), [
      'captured_at,broker,symbol,bridge_mode,account_mode,server,terminal_connected,bid,ask,spread_price,open_positions,open_orders',
      '2026-06-23T12:00:00,icmarkets,XAUUSD,read_only,real,IC-Demo,1,2345.10,2345.30,0.20,0,0',
    ].join('\n'))

    await expect(readMt5ReadOnlyBridge(root, 'icmarkets', 'XAUUSD')).resolves.toMatchObject({ state: 'unsafe_account' })
  })
})
