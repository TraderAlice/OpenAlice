import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseExecutionStatusCsv, summarizeLatestJmbExecutionStatus } from './execution-status.js'

const HEADER = 'schema_version,captured_at,broker,server,account_mode,symbol,state,detail,rollout_stage,execution_enabled,kill_switch,decision_id,observation_id,event_id,event_type,event_time,result_code,result_detail,stop_protection_confirmed,position_direction,position_volume,position_open_price,position_stop_loss,position_id,reconciliation_state,daily_loss_count,daily_realized_loss,blocking_gate,next_safe_action'

const VALID_ROW = [
  '1',
  '2026-07-13T09:10:00.000Z',
  'hfmarkets',
  'HFMarketsGlobal-Demo4',
  'demo',
  'XAUUSD',
  'filled_protected',
  'Broker confirms the EA-owned position and protective stop.',
  'hfm_canary',
  '1',
  '0',
  'decision-opaque',
  'observation-opaque',
  'event-opaque',
  'fill_confirmed',
  '2026-07-13T09:09:58.000Z',
  '10009',
  'Request completed',
  '1',
  'buy',
  '0.01',
  '3334.25',
  '3324.25',
  'position-opaque',
  'reconciled',
  '1',
  '-8.75',
  '',
  'Monitor broker-side protection and reconciliation.',
].join(',')

const VALID_CSV = `${HEADER}\n${VALID_ROW}\n`

describe('parseExecutionStatusCsv', () => {
  it('parses the exact execution status contract without an account identifier', () => {
    const status = parseExecutionStatusCsv(VALID_CSV)

    expect(status.state).toBe('filled_protected')
    expect(status.position).toEqual({
      direction: 'buy',
      volume: 0.01,
      openPrice: 3334.25,
      stopLoss: 3324.25,
      id: 'position-opaque',
    })
    expect(status.latestEvent).toEqual({
      id: 'event-opaque',
      type: 'fill_confirmed',
      at: '2026-07-13T09:09:58.000Z',
      resultCode: '10009',
      detail: 'Request completed',
    })
    expect(JSON.stringify(status)).not.toMatch(/account.?login/i)
  })

  it.each([
    ['extra', VALID_CSV.replace('symbol,', 'account_login,symbol,')],
    ['missing', VALID_CSV.replace(',result_detail', '')],
    ['duplicate', VALID_CSV.replace('result_code,result_detail', 'result_code,result_code,result_detail')],
    ['reordered', VALID_CSV.replace('broker,server', 'server,broker')],
  ])('rejects a %s column contract', (_case, csv) => {
    expect(() => parseExecutionStatusCsv(csv)).toThrow(/schema/i)
  })

  it.each([
    ['a live account', VALID_CSV.replace(',demo,XAUUSD,', ',real,XAUUSD,')],
    ['an unknown lifecycle', VALID_CSV.replace(',filled_protected,', ',profitable,')],
    ['a non-binary switch', VALID_CSV.replace(',hfm_canary,1,0,', ',hfm_canary,true,0,')],
    ['an incomplete position', VALID_CSV.replace(',buy,0.01,', ',,0.01,')],
  ])('rejects %s', (_case, csv) => {
    expect(() => parseExecutionStatusCsv(csv)).toThrow()
  })

  it('accepts an in-progress event before broker result fields exist', () => {
    const csv = VALID_CSV
      .replace(',filled_protected,', ',order_requesting,')
      .replace(
        ',2026-07-13T09:09:58.000Z,10009,Request completed,1,buy,0.01,3334.25,3324.25,position-opaque,reconciled,',
        ',2026-07-13T09:09:58.000Z,,,0,,,,,,reconciliation_pending,',
      )

    expect(parseExecutionStatusCsv(csv)).toMatchObject({
      state: 'order_requesting',
      latestEvent: { type: 'fill_confirmed', resultCode: '', detail: '' },
      position: null,
    })
  })

  it.each([
    ['stop confirmation off', VALID_CSV.replace(',Request completed,1,buy,', ',Request completed,0,buy,')],
    ['no position', VALID_CSV.replace(',1,buy,0.01,3334.25,3324.25,position-opaque,reconciled,', ',1,,,,,,reconciled,')],
    ['zero volume', VALID_CSV.replace(',buy,0.01,', ',buy,0,')],
    ['negative volume', VALID_CSV.replace(',buy,0.01,', ',buy,-0.01,')],
    ['zero open price', VALID_CSV.replace(',0.01,3334.25,', ',0.01,0,')],
    ['zero stop', VALID_CSV.replace(',3334.25,3324.25,', ',3334.25,0,')],
    ['a nonprotective buy stop', VALID_CSV.replace(',3334.25,3324.25,', ',3334.25,3344.25,')],
    ['a nonprotective sell stop', VALID_CSV.replace(',buy,0.01,3334.25,3324.25,', ',sell,0.01,3334.25,3324.25,')],
    ['an empty position id', VALID_CSV.replace(',position-opaque,reconciled,', ',,reconciled,')],
  ])('rejects filled_protected with %s', (_case, csv) => {
    expect(() => parseExecutionStatusCsv(csv)).toThrow(/position/i)
  })

  it('rejects stop confirmation without a complete valid protective position', () => {
    const csv = VALID_CSV
      .replace(',filled_protected,', ',ready,')
      .replace(',1,buy,0.01,3334.25,3324.25,position-opaque,reconciled,', ',1,,,,,,reconciled,')

    expect(() => parseExecutionStatusCsv(csv)).toThrow(/stop protection/i)
  })

  it('rejects execution enabled in the status-only rollout stage', () => {
    expect(() => parseExecutionStatusCsv(VALID_CSV.replace(',hfm_canary,1,', ',status_only,1,'))).toThrow(/status.only/i)
  })

  it('rejects a broker paired with the other allowlisted demo server', () => {
    expect(() => parseExecutionStatusCsv(VALID_CSV.replace('HFMarketsGlobal-Demo4', 'ICMarketsSC-Demo'))).toThrow(/broker.*server|server.*broker/i)
  })

  it('rejects workstation-local timestamps without a canonical UTC suffix', () => {
    expect(() => parseExecutionStatusCsv(VALID_CSV.replaceAll('.000Z', ''))).toThrow(/timestamp|captured_at/i)
  })

  it('accepts a protected fill while the kill switch blocks new entries', () => {
    expect(parseExecutionStatusCsv(VALID_CSV.replace(',hfm_canary,1,0,', ',hfm_canary,1,1,'))).toMatchObject({
      state: 'filled_protected',
      killSwitch: true,
      stopProtectionConfirmed: true,
    })
  })

  it.each([
    [
      'reconciliation_required',
      VALID_CSV
        .replace(',filled_protected,', ',reconciliation_required,')
        .replace(',Request completed,1,buy,0.01,3334.25,3324.25,position-opaque,reconciled,', ',Request completed,0,,,,,,required,'),
    ],
    ['filled_protected', VALID_CSV],
    [
      'stopped',
      VALID_CSV
        .replace(',filled_protected,', ',stopped,')
        .replace(',Request completed,1,buy,0.01,3334.25,3324.25,position-opaque,reconciled,', ',Request completed,0,,,,,,reconciled,'),
    ],
    [
      'emergency_close',
      VALID_CSV
        .replace(',filled_protected,', ',emergency_close,')
        .replace(',Request completed,1,buy,0.01,3334.25,3324.25,position-opaque,reconciled,', ',Request completed,0,buy,0.01,3334.25,0,position-opaque,protection_error,'),
    ],
  ])('parses the Task 8 %s reconciliation lifecycle', (state, csv) => {
    expect(parseExecutionStatusCsv(csv)).toMatchObject({ state })
  })

  it('rejects filled_protected when broker stop confirmation is absent', () => {
    const csv = VALID_CSV.replace(',Request completed,1,buy,', ',Request completed,0,buy,')

    expect(() => parseExecutionStatusCsv(csv)).toThrow(/filled_protected|position/i)
  })
})

describe('summarizeLatestJmbExecutionStatus', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'openalice-execution-status-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('summarizes a protected demo fill without exposing account login', async () => {
    const directory = join(root, 'hfmarkets', 'XAUUSD')
    await mkdir(directory, { recursive: true })
    const path = join(directory, 'latest_status.csv')
    await writeFile(path, VALID_CSV, 'utf8')
    await utimes(path, new Date('2026-07-13T09:10:00.000Z'), new Date('2026-07-13T09:10:00.000Z'))

    const summary = await summarizeLatestJmbExecutionStatus(root, 'hfmarkets', 'XAUUSD', new Date('2026-07-13T09:10:30.000Z'))

    expect(summary.state).toBe('filled_protected')
    expect(summary.label).toBe('DEMO ENABLED')
    expect(JSON.stringify(summary)).not.toMatch(/account.?login/i)
  })

  it('fails closed when the status is missing, malformed, or stale', async () => {
    await expect(summarizeLatestJmbExecutionStatus(root, 'hfmarkets', 'XAUUSD')).resolves.toMatchObject({
      state: 'missing',
      executionEnabled: false,
      killSwitch: true,
    })

    const directory = join(root, 'hfmarkets', 'XAUUSD')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'latest_status.csv'), VALID_CSV.replace('symbol,', 'account_login,symbol,'), 'utf8')
    await expect(summarizeLatestJmbExecutionStatus(root, 'hfmarkets', 'XAUUSD')).resolves.toMatchObject({
      state: 'malformed',
      executionEnabled: false,
      killSwitch: true,
    })

    await writeFile(join(directory, 'latest_status.csv'), VALID_CSV, 'utf8')
    await utimes(join(directory, 'latest_status.csv'), new Date('2026-07-13T09:10:00.000Z'), new Date('2026-07-13T09:10:00.000Z'))
    await expect(summarizeLatestJmbExecutionStatus(root, 'hfmarkets', 'XAUUSD', new Date('2026-07-13T09:15:01.000Z'))).resolves.toMatchObject({
      state: 'stale',
      executionEnabled: false,
      killSwitch: true,
    })
  })

  it('fails closed when the row identity does not match the requested path', async () => {
    const directory = join(root, 'hfmarkets', 'XAUUSD')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'latest_status.csv'), VALID_CSV.replace(',hfmarkets,', ',icmarkets,'), 'utf8')

    await expect(summarizeLatestJmbExecutionStatus(root, 'hfmarkets', 'XAUUSD')).resolves.toMatchObject({
      state: 'malformed',
      executionEnabled: false,
      killSwitch: true,
    })
  })

  it('uses the trusted file modification time for freshness on non-UTC workstations', async () => {
    const directory = join(root, 'hfmarkets', 'XAUUSD')
    const path = join(directory, 'latest_status.csv')
    await mkdir(directory, { recursive: true })
    await writeFile(path, VALID_CSV.replaceAll('2026-07-13T09:10:00.000Z', '2026-01-01T00:00:00.000Z'), 'utf8')
    await utimes(path, new Date('2026-07-13T09:10:00.000Z'), new Date('2026-07-13T09:10:00.000Z'))

    await expect(summarizeLatestJmbExecutionStatus(root, 'hfmarkets', 'XAUUSD', new Date('2026-07-13T09:10:30.000Z')))
      .resolves.toMatchObject({ state: 'filled_protected' })
  })
})
