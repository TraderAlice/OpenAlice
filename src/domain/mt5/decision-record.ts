import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export type JmbDecisionMode = 'shadow' | 'demo_blocked' | 'demo_order_requested' | 'demo_filled' | 'demo_closed' | 'skipped'
export type JmbDecisionDirection = 'buy' | 'sell' | 'flat'
export type JmbGateState = 'pass' | 'fail' | 'warn'

export interface JmbGateResult {
  gate: string
  state: JmbGateState
  detail: string
}

export interface JmbDecisionRecord {
  schemaVersion: 1
  decisionId: string
  createdAt: string
  broker: string
  server: string | null
  accountMode: string | null
  symbol: string
  canonicalInstrument: string
  strategyVersion: string
  mode: JmbDecisionMode
  direction: JmbDecisionDirection
  reasonCode: string
  reasonDetail: string
  entryReferencePrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  volume: number
  spread: number | null
  riskAmount: number | null
  maxAllowedRisk: number
  gateResults: JmbGateResult[]
  orderTicket: string | null
  positionId: string | null
  outcome: string | null
}

export interface JmbDecisionSummary {
  state: 'no_decision' | 'shadow' | 'demo_blocked' | 'error'
  label: string
  detail: string
  broker: string
  symbol: string
  lastUpdated: string | null
  decision: JmbDecisionRecord | null
}

const HEADER = [
  'schema_version',
  'decision_id',
  'created_at',
  'broker',
  'server',
  'account_mode',
  'symbol',
  'canonical_instrument',
  'strategy_version',
  'mode',
  'direction',
  'reason_code',
  'reason_detail',
  'entry_reference_price',
  'stop_loss',
  'take_profit',
  'volume',
  'spread',
  'risk_amount',
  'max_allowed_risk',
  'gate_results_json',
  'order_ticket',
  'position_id',
  'outcome',
]

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]

    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      record.push(current)
      current = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      record.push(current)
      records.push(record)
      record = []
      current = ''
      if (character === '\r' && text[index + 1] === '\n') index += 1
    } else {
      current += character
    }
  }

  if (quoted) throw new Error('Decision CSV has an unterminated quoted field')
  if (current !== '' || record.length > 0) {
    record.push(current)
    records.push(record)
  }

  return records
}

function numberOrNull(value: string): number | null {
  if (value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric decision field: ${value}`)
  return parsed
}

function requiredNumber(value: string, field: string): number {
  if (value === '') throw new Error(`Missing numeric decision field: ${field}`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric decision field: ${field}`)
  return parsed
}

export function createJmbDecisionId(
  input: Pick<JmbDecisionRecord, 'createdAt' | 'broker' | 'symbol' | 'strategyVersion' | 'mode' | 'direction'>,
): string {
  return createHash('sha256')
    .update([input.createdAt, input.broker, input.symbol, input.strategyVersion, input.mode, input.direction].join('|'))
    .digest('hex')
    .slice(0, 24)
}

export function serializeLatestDecisionCsv(record: JmbDecisionRecord): string {
  const values = [
    String(record.schemaVersion),
    record.decisionId,
    record.createdAt,
    record.broker,
    record.server ?? '',
    record.accountMode ?? '',
    record.symbol,
    record.canonicalInstrument,
    record.strategyVersion,
    record.mode,
    record.direction,
    record.reasonCode,
    record.reasonDetail,
    record.entryReferencePrice == null ? '' : String(record.entryReferencePrice),
    record.stopLoss == null ? '' : String(record.stopLoss),
    record.takeProfit == null ? '' : String(record.takeProfit),
    String(record.volume),
    record.spread == null ? '' : String(record.spread),
    record.riskAmount == null ? '' : String(record.riskAmount),
    String(record.maxAllowedRisk),
    JSON.stringify(record.gateResults),
    record.orderTicket ?? '',
    record.positionId ?? '',
    record.outcome ?? '',
  ]

  return `${HEADER.join(',')}\n${values.map(csvEscape).join(',')}\n`
}

export function parseLatestDecisionCsv(text: string): JmbDecisionRecord {
  const records = parseCsvRecords(text)
  if (records.length !== 2) throw new Error('Decision CSV is missing header or value row')

  const [headers, values] = records
  if (headers.join(',') !== HEADER.join(',') || values.length !== HEADER.length) throw new Error('Decision CSV schema mismatch')

  const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))

  return {
    schemaVersion: 1,
    decisionId: row['decision_id']!,
    createdAt: row['created_at']!,
    broker: row['broker']!,
    server: row['server'] || null,
    accountMode: row['account_mode'] || null,
    symbol: row['symbol']!,
    canonicalInstrument: row['canonical_instrument']!,
    strategyVersion: row['strategy_version']!,
    mode: row['mode'] as JmbDecisionMode,
    direction: row['direction'] as JmbDecisionDirection,
    reasonCode: row['reason_code']!,
    reasonDetail: row['reason_detail']!,
    entryReferencePrice: numberOrNull(row['entry_reference_price']!),
    stopLoss: numberOrNull(row['stop_loss']!),
    takeProfit: numberOrNull(row['take_profit']!),
    volume: requiredNumber(row['volume']!, 'volume'),
    spread: numberOrNull(row['spread']!),
    riskAmount: numberOrNull(row['risk_amount']!),
    maxAllowedRisk: requiredNumber(row['max_allowed_risk']!, 'max_allowed_risk'),
    gateResults: JSON.parse(row['gate_results_json']!) as JmbGateResult[],
    orderTicket: row['order_ticket'] || null,
    positionId: row['position_id'] || null,
    outcome: row['outcome'] || null,
  }
}

function decisionDirectory(root: string, broker: string, symbol: string): string {
  return join(root, broker, symbol)
}

export async function appendJmbDecisionRecord(root: string, record: JmbDecisionRecord): Promise<void> {
  const directory = decisionDirectory(root, record.broker, record.symbol)
  await mkdir(directory, { recursive: true })
  await appendFile(join(directory, 'decisions.jsonl'), `${JSON.stringify(record)}\n`, 'utf8')
}

export async function writeLatestJmbDecision(root: string, record: JmbDecisionRecord): Promise<void> {
  const directory = decisionDirectory(root, record.broker, record.symbol)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'latest_decision.csv'), serializeLatestDecisionCsv(record), 'utf8')
}

function fileErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : null
}

function noDecisionSummary(broker: string, symbol: string): JmbDecisionSummary {
  return {
    state: 'no_decision',
    label: 'No JMB decision yet',
    detail: 'Run the shadow decision runner before enabling any demo risk shell.',
    broker,
    symbol,
    lastUpdated: null,
    decision: null,
  }
}

function unreadableSummary(broker: string, symbol: string, lastUpdated: string | null): JmbDecisionSummary {
  return {
    state: 'error',
    label: 'Decision unreadable',
    detail: 'The latest decision CSV is malformed. The risk shell must fail closed.',
    broker,
    symbol,
    lastUpdated,
    decision: null,
  }
}

export async function summarizeLatestJmbDecision(
  root: string,
  broker: string,
  symbol: string,
  now = new Date(),
): Promise<JmbDecisionSummary> {
  const path = join(root, broker, symbol, 'latest_decision.csv')
  let text: string
  let modified: Date

  try {
    modified = (await stat(path)).mtime
  } catch (error) {
    return fileErrorCode(error) === 'ENOENT' ? noDecisionSummary(broker, symbol) : unreadableSummary(broker, symbol, null)
  }

  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    return fileErrorCode(error) === 'ENOENT' ? noDecisionSummary(broker, symbol) : unreadableSummary(broker, symbol, modified.toISOString())
  }

  try {
    const decision = parseLatestDecisionCsv(text)
    const ageMinutes = Math.round((now.getTime() - modified.getTime()) / 60_000)
    const state = decision.mode === 'demo_blocked' ? 'demo_blocked' : decision.mode === 'shadow' || decision.mode === 'skipped' ? 'shadow' : 'error'

    return {
      state,
      label: decision.mode === 'demo_blocked' ? 'Demo blocked by gates' : 'Shadow decision logged',
      detail: `Latest ${decision.mode} decision is ${ageMinutes} minutes old.`,
      broker,
      symbol,
      lastUpdated: modified.toISOString(),
      decision,
    }
  } catch {
    return unreadableSummary(broker, symbol, modified.toISOString())
  }
}
