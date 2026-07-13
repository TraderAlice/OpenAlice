import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveCompletedTrendObservation, parseCompletedD1Csv, readMt5CompletedD1 } from './completed-d1.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function csv(closes: number[]): string {
  const rows = closes.map((close, index) =>
    `1,2026-07-13T09:00:00.000Z,hfmarkets,HFMarketsGlobal-Demo4,demo,XAUUSD,2026-05-${String(index + 1).padStart(2, '0')},${index + 1},${close},${close},${close},${close}`,
  )
  return ['schema_version,captured_at,broker,server,account_mode,symbol,bar_as_of,bar_open_epoch,open,high,low,close', ...rows].join('\n')
}

describe('completed D1 broker bars', () => {
  it('derives the signal from completed bars only', () => {
    const parsed = parseCompletedD1Csv(csv([100, 101, 103]))
    expect(deriveCompletedTrendObservation(parsed, 2)).toMatchObject({
      direction: 'uptrend',
      lookbackDays: 2,
      latestClose: 103,
      referenceClose: 100,
    })
  })

  it('rejects duplicate or descending bar epochs', () => {
    expect(() => parseCompletedD1Csv(csv([100, 101]).replace(',2,101,', ',1,101,'))).toThrow(/ascending/)
  })

  it('rejects non-finite prices and malformed row widths', () => {
    expect(() => parseCompletedD1Csv(csv([100, 101]).replace(',101,101,101,101', ',NaN,101,101,101'))).toThrow(/finite/)
    expect(() => parseCompletedD1Csv(`${csv([100])},extra`)).toThrow(/columns/)
  })

  it('requires consistent demo metadata and unique bar dates', () => {
    expect(() => parseCompletedD1Csv(csv([100, 101]).replace('HFMarketsGlobal-Demo4,demo,XAUUSD,2026-05-02', 'Other-Demo,demo,XAUUSD,2026-05-02'))).toThrow(/metadata/)
    expect(() => parseCompletedD1Csv(csv([100]).replace(',demo,', ',real,'))).toThrow(/demo/)
    expect(() => parseCompletedD1Csv(csv([100, 101]).replace('2026-05-02,2', '2026-05-01,2'))).toThrow(/unique/)
  })

  it('reads a fresh file using its modification time', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-mt5-d1-'))
    directories.push(root)
    const directory = join(root, 'hfmarkets', 'XAUUSD')
    const path = join(directory, 'completed_d1.csv')
    await mkdir(directory, { recursive: true })
    await writeFile(path, csv([100, 101, 103]))
    await utimes(path, new Date('2026-07-13T08:00:00.000Z'), new Date('2026-07-13T08:00:00.000Z'))

    await expect(readMt5CompletedD1(root, 'hfmarkets', 'XAUUSD', {
      now: new Date('2026-07-13T09:30:00.000Z'),
      maxAgeHours: 2,
    })).resolves.toMatchObject({
      state: 'ready',
      ageHours: 1.5,
      parsed: { broker: 'hfmarkets', symbol: 'XAUUSD' },
    })
  })

  it('fails closed for missing, stale, unsafe, and malformed files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-mt5-d1-'))
    directories.push(root)
    const directory = join(root, 'hfmarkets', 'XAUUSD')
    const path = join(directory, 'completed_d1.csv')

    await expect(readMt5CompletedD1(root, 'hfmarkets', 'XAUUSD', { maxAgeHours: 2 })).resolves.toMatchObject({ state: 'missing', parsed: null })

    await mkdir(directory, { recursive: true })
    await writeFile(path, csv([100, 101]))
    await utimes(path, new Date('2026-07-13T06:00:00.000Z'), new Date('2026-07-13T06:00:00.000Z'))
    await expect(readMt5CompletedD1(root, 'hfmarkets', 'XAUUSD', {
      now: new Date('2026-07-13T09:00:00.000Z'),
      maxAgeHours: 2,
    })).resolves.toMatchObject({ state: 'stale', ageHours: 3, parsed: expect.any(Object) })

    await writeFile(path, csv([100, 101]).replace(',demo,', ',real,'))
    await expect(readMt5CompletedD1(root, 'hfmarkets', 'XAUUSD', { maxAgeHours: 2 })).resolves.toMatchObject({ state: 'unsafe', parsed: null })

    await writeFile(path, 'not,a,completed,d1,file')
    await expect(readMt5CompletedD1(root, 'hfmarkets', 'XAUUSD', { maxAgeHours: 2 })).resolves.toMatchObject({ state: 'malformed', parsed: null })
  })
})
