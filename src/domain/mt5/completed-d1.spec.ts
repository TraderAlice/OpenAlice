import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveCompletedTrendObservation, parseCompletedD1Csv, readMt5CompletedD1 } from './completed-d1.js'

const fsMocks = vi.hoisted(() => ({
  open: vi.fn(),
  readFile: vi.fn(),
  stat: vi.fn(),
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  fsMocks.open.mockImplementation(actual.open)
  fsMocks.readFile.mockImplementation(actual.readFile)
  fsMocks.stat.mockImplementation(actual.stat)
  return { ...actual, ...fsMocks }
})

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  fsMocks.open.mockReset().mockImplementation(actual.open)
  fsMocks.readFile.mockReset().mockImplementation(actual.readFile)
  fsMocks.stat.mockReset().mockImplementation(actual.stat)
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
      expectedServer: 'HFMarketsGlobal-Demo4',
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

    await expect(readMt5CompletedD1(root, 'hfmarkets', 'XAUUSD', { maxAgeHours: 2, expectedServer: 'HFMarketsGlobal-Demo4' })).resolves.toMatchObject({ state: 'missing', parsed: null })

    await mkdir(directory, { recursive: true })
    await writeFile(path, csv([100, 101]))
    await utimes(path, new Date('2026-07-13T06:00:00.000Z'), new Date('2026-07-13T06:00:00.000Z'))
    await expect(readMt5CompletedD1(root, 'hfmarkets', 'XAUUSD', {
      now: new Date('2026-07-13T09:00:00.000Z'),
      maxAgeHours: 2,
      expectedServer: 'HFMarketsGlobal-Demo4',
    })).resolves.toMatchObject({ state: 'stale', ageHours: 3, parsed: expect.any(Object) })

    await writeFile(path, csv([100, 101]).replace(',demo,', ',real,'))
    await expect(readMt5CompletedD1(root, 'hfmarkets', 'XAUUSD', { maxAgeHours: 2, expectedServer: 'HFMarketsGlobal-Demo4' })).resolves.toMatchObject({ state: 'unsafe', parsed: null })

    await writeFile(path, 'not,a,completed,d1,file')
    await expect(readMt5CompletedD1(root, 'hfmarkets', 'XAUUSD', { maxAgeHours: 2, expectedServer: 'HFMarketsGlobal-Demo4' })).resolves.toMatchObject({ state: 'malformed', parsed: null })
  })

  it('fails closed when fresh completed D1 evidence comes from the wrong server', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-mt5-d1-'))
    directories.push(root)
    const directory = join(root, 'hfmarkets', 'XAUUSD')
    const path = join(directory, 'completed_d1.csv')
    await mkdir(directory, { recursive: true })
    await writeFile(path, csv([100, 101, 103]).replaceAll('HFMarketsGlobal-Demo4', 'Other-Demo'))
    await utimes(path, new Date('2026-07-13T09:00:00.000Z'), new Date('2026-07-13T09:00:00.000Z'))

    await expect(readMt5CompletedD1(root, 'hfmarkets', 'XAUUSD', {
      now: new Date('2026-07-13T09:30:00.000Z'),
      maxAgeHours: 2,
      expectedServer: 'HFMarketsGlobal-Demo4',
    })).resolves.toMatchObject({ state: 'unsafe', parsed: null })
  })

  it('reads contents and modification time from the same file identity', async () => {
    const staleModifiedAt = new Date('2026-07-13T06:00:00.000Z')
    const freshModifiedAt = new Date('2026-07-13T09:00:00.000Z')
    const staleText = csv([100, 101])
    const close = vi.fn().mockResolvedValue(undefined)

    fsMocks.readFile.mockResolvedValueOnce(staleText)
    fsMocks.stat.mockResolvedValueOnce({ mtime: freshModifiedAt })
    fsMocks.open.mockResolvedValueOnce({
      readFile: vi.fn().mockResolvedValue(staleText),
      stat: vi.fn().mockResolvedValue({ mtime: staleModifiedAt }),
      close,
    })

    await expect(readMt5CompletedD1('root', 'hfmarkets', 'XAUUSD', {
      now: freshModifiedAt,
      maxAgeHours: 2,
      expectedServer: 'HFMarketsGlobal-Demo4',
    })).resolves.toMatchObject({ state: 'stale', ageHours: 3 })
    expect(close).toHaveBeenCalledOnce()
  })
})
