import { open } from 'node:fs/promises'
import { join } from 'node:path'

export type CompletedD1State = 'ready' | 'missing' | 'stale' | 'unsafe' | 'malformed'
export type TrendDirection = 'uptrend' | 'downtrend' | 'flat'

export interface CompletedD1Bar {
  asOf: string
  openEpoch: number
  open: number
  high: number
  low: number
  close: number
}

export interface ParsedCompletedD1 {
  capturedAt: string
  broker: string
  server: string
  accountMode: string
  symbol: string
  bars: CompletedD1Bar[]
}

export interface Mt5CompletedD1Summary {
  state: CompletedD1State
  detail: string
  ageHours: number | null
  parsed: ParsedCompletedD1 | null
}

export interface CompletedTrendObservation {
  asOf: string
  direction: TrendDirection
  lookbackReturn: number
  lookbackDays: number
  latestClose: number
  referenceClose: number
}

const COMPLETED_D1_HEADER = 'schema_version,captured_at,broker,server,account_mode,symbol,bar_as_of,bar_open_epoch,open,high,low,close'
const COMPLETED_D1_COLUMN_COUNT = 12

class CompletedD1ParseError extends Error {
  constructor(
    message: string,
    readonly state: Extract<CompletedD1State, 'unsafe' | 'malformed'> = 'malformed',
  ) {
    super(message)
  }
}

function malformed(message: string): never {
  throw new CompletedD1ParseError(message)
}

function parseFinite(value: string | undefined, field: string): number {
  const parsed = Number(value)
  if (value === undefined || value.trim() === '' || !Number.isFinite(parsed)) {
    malformed(`Completed D1 ${field} must be finite`)
  }
  return parsed
}

export function parseCompletedD1Csv(text: string): ParsedCompletedD1 {
  const [header, ...rows] = text.trim().split(/\r?\n/)
  if (header !== COMPLETED_D1_HEADER || rows.length === 0) {
    malformed('Completed D1 CSV has an invalid header or no bars')
  }

  let previousEpoch = Number.NEGATIVE_INFINITY
  let expectedMetadata: string[] | undefined
  const barDates = new Set<string>()
  const bars = rows.map((row) => {
    const values = row.split(',')
    if (values.length !== COMPLETED_D1_COLUMN_COUNT) malformed('Completed D1 rows must contain exactly 12 columns')
    if (values[0] !== '1') malformed('Completed D1 schema version must be 1')

    const metadata = values.slice(1, 6)
    if (metadata.some((value) => value.trim() === '')) malformed('Completed D1 metadata cannot be empty')
    if (expectedMetadata === undefined) {
      expectedMetadata = metadata
    } else if (metadata.some((value, index) => value !== expectedMetadata![index])) {
      malformed('Completed D1 metadata must be identical across rows')
    }
    if (values[4] !== 'demo') {
      throw new CompletedD1ParseError('Completed D1 observations must come from a demo account', 'unsafe')
    }

    const asOf = values[6]!
    if (asOf === '') malformed('Completed D1 bar_as_of cannot be empty')
    if (barDates.has(asOf)) malformed('Completed D1 bar_as_of values must be unique')
    barDates.add(asOf)

    const openEpoch = parseFinite(values[7], 'bar_open_epoch')
    if (!Number.isInteger(openEpoch)) malformed('Completed D1 bar_open_epoch must be an integer')
    if (openEpoch <= previousEpoch) malformed('Completed D1 bar epochs must be strictly ascending')
    previousEpoch = openEpoch
    return {
      asOf,
      openEpoch,
      open: parseFinite(values[8], 'open'),
      high: parseFinite(values[9], 'high'),
      low: parseFinite(values[10], 'low'),
      close: parseFinite(values[11], 'close'),
    }
  })
  return {
    capturedAt: expectedMetadata![0]!,
    broker: expectedMetadata![1]!,
    server: expectedMetadata![2]!,
    accountMode: expectedMetadata![3]!,
    symbol: expectedMetadata![4]!,
    bars,
  }
}

export async function readMt5CompletedD1(
  root: string,
  broker: string,
  symbol: string,
  options: { now?: Date; maxAgeHours: number },
): Promise<Mt5CompletedD1Summary> {
  if (!Number.isFinite(options.maxAgeHours) || options.maxAgeHours <= 0) {
    throw new Error('Completed D1 maximum age must be a positive finite number of hours')
  }

  const path = join(root, broker, symbol, 'completed_d1.csv')
  let text: string
  let modifiedAt: Date
  try {
    const handle = await open(path, 'r')
    try {
      const [contents, metadata] = await Promise.all([
        handle.readFile('utf8'),
        handle.stat(),
      ])
      text = contents
      modifiedAt = metadata.mtime
    } finally {
      await handle.close()
    }
  } catch {
    return {
      state: 'missing',
      detail: 'The completed D1 broker export is missing or unreadable.',
      ageHours: null,
      parsed: null,
    }
  }

  let parsed: ParsedCompletedD1
  try {
    parsed = parseCompletedD1Csv(text)
  } catch (error) {
    const state = error instanceof CompletedD1ParseError ? error.state : 'malformed'
    return {
      state,
      detail: error instanceof Error ? error.message : 'The completed D1 broker export is malformed.',
      ageHours: null,
      parsed: null,
    }
  }

  if (parsed.broker !== broker || parsed.symbol !== symbol || parsed.accountMode !== 'demo') {
    return {
      state: 'unsafe',
      detail: 'The completed D1 export identity does not match the requested demo broker and symbol.',
      ageHours: null,
      parsed: null,
    }
  }

  const now = options.now ?? new Date()
  const ageHours = Math.max(0, (now.getTime() - modifiedAt.getTime()) / 3_600_000)
  if (ageHours > options.maxAgeHours) {
    return {
      state: 'stale',
      detail: 'The completed D1 broker export is older than the policy maximum observation age.',
      ageHours,
      parsed,
    }
  }

  return {
    state: 'ready',
    detail: 'Completed D1 broker bars are current and demo-only.',
    ageHours,
    parsed,
  }
}

export function deriveCompletedTrendObservation(input: ParsedCompletedD1, lookbackDays: number): CompletedTrendObservation {
  if (!Number.isInteger(lookbackDays) || lookbackDays <= 0 || input.bars.length < lookbackDays + 1) {
    throw new Error('Completed D1 history is insufficient for the selected lookback')
  }
  const latest = input.bars.at(-1)!
  const reference = input.bars.at(-(lookbackDays + 1))!
  const lookbackReturn = latest.close / reference.close - 1
  return {
    asOf: latest.asOf,
    direction: lookbackReturn > 0 ? 'uptrend' : lookbackReturn < 0 ? 'downtrend' : 'flat',
    lookbackReturn,
    lookbackDays,
    latestClose: latest.close,
    referenceClose: reference.close,
  }
}
