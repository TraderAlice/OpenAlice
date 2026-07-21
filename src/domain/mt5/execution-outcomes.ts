import { open, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import type { JmbDemoInstrumentConfig } from './demo-decision-service.js'

export interface JmbExecutionOutcomeRecord {
  schemaVersion: 1
  outcomeEventId: string
  outcomeAt: string
  broker: 'hfmarkets' | 'icmarkets'
  server: 'HFMarketsGlobal-Demo4' | 'ICMarketsSC-Demo'
  accountMode: 'demo'
  symbol: 'XAUUSD'
  strategyVersion: 'daily-trend-v1'
  decisionId: string
  observationId: string
  positionId: string
  result: 'win' | 'loss' | 'breakeven'
  netResult: number
  commission: number
  swap: number
  fee: number
  requestedPrice: number | null
  acceptedPrice: number | null
  slippage: number | null
  maxAdverseExcursion: number | null
  maxFavorableExcursion: number | null
  source: 'ea_demo'
}

export interface ExecutionOutcomeImportOptions {
  executionRoot: string
  learningRoot: string
  instruments: readonly Pick<JmbDemoInstrumentConfig, 'broker' | 'server' | 'symbol'>[]
}

export interface ExecutionOutcomeImportResult {
  broker: 'hfmarkets' | 'icmarkets'
  symbol: 'XAUUSD'
  state: 'imported' | 'no_new_outcome' | 'blocked' | 'error'
  imported: number
  detail: string
}

const EXECUTION_EVENT_FIELDS = [
  'schema_version', 'event_id', 'event_type', 'event_time', 'broker', 'server', 'account_mode',
  'account_identity_masked', 'symbol', 'strategy_version', 'magic_number', 'decision_id', 'observation_id',
  'gate_results', 'calculated_risk', 'requested_volume', 'requested_price', 'requested_stop_loss',
  'accepted_volume', 'accepted_price', 'accepted_stop_loss', 'result_code', 'result_detail', 'order_ticket',
  'deal_ticket', 'position_id', 'reconciliation_state', 'daily_loss_count', 'daily_realized_loss',
  'commission', 'swap', 'fee', 'net_result', 'max_adverse_excursion', 'max_favorable_excursion',
] as const

const OUTCOME_RECORD_FIELDS = [
  'schemaVersion', 'outcomeEventId', 'outcomeAt', 'broker', 'server', 'accountMode', 'symbol',
  'strategyVersion', 'decisionId', 'observationId', 'positionId', 'result', 'netResult', 'commission',
  'swap', 'fee', 'requestedPrice', 'acceptedPrice', 'slippage', 'maxAdverseExcursion',
  'maxFavorableExcursion', 'source',
] as const

const LIFECYCLE_STATES = new Set([
  'disabled', 'paused', 'blocked', 'ready', 'order_requesting', 'order_rejected',
  'reconciliation_required', 'filled_protected', 'close_requesting', 'closed', 'stopped',
  'emergency_close', 'error',
])

type Broker = JmbExecutionOutcomeRecord['broker']
type Server = JmbExecutionOutcomeRecord['server']

export interface JmbExecutionEvent {
  schemaVersion: 1
  eventId: string
  eventType: string
  eventTime: string
  broker: Broker
  server: Server
  accountMode: 'demo'
  symbol: 'XAUUSD'
  strategyVersion: 'daily-trend-v1'
  decisionId: string
  observationId: string
  positionId: string
  reconciliationState: string
  requestedPrice: number | null
  acceptedPrice: number | null
  commission: number | null
  swap: number | null
  fee: number | null
  netResult: number | null
  maxAdverseExcursion: number | null
  maxFavorableExcursion: number | null
}

export class ExecutionOutcomeValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionOutcomeValidationError'
  }
}

function validationError(message: string): never {
  throw new ExecutionOutcomeValidationError(message)
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    validationError('Execution event must be a JSON object.')
  }
  return value as Record<string, unknown>
}

function stringValue(value: unknown, field: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    validationError(`Execution event ${field} must be a ${allowEmpty ? '' : 'nonempty '}string.`)
  }
  return value
}

function finiteValue(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    validationError(`Execution event ${field} must be finite.`)
  }
  return value
}

function nullableFiniteValue(value: unknown, field: string): number | null {
  if (value === null) return null
  return finiteValue(value, field)
}

function assertExactFields(value: Record<string, unknown>): void {
  const actual = Object.keys(value).sort()
  const expected = [...EXECUTION_EVENT_FIELDS].sort()
  if (actual.length !== expected.length || !actual.every((field, index) => field === expected[index])) {
    validationError('Execution event schema fields do not match version 1.')
  }
}

function validateGateResults(value: unknown): void {
  if (!Array.isArray(value)) validationError('Execution event gate_results must be an array.')
  for (const gate of value) {
    if (typeof gate !== 'object' || gate === null || Array.isArray(gate)) {
      validationError('Execution event gate result must be an object.')
    }
    const candidate = gate as Record<string, unknown>
    if (Object.keys(candidate).sort().join(',') !== 'detail,name,state') {
      validationError('Execution event gate result fields do not match the Task 8 contract.')
    }
    const name = stringValue(candidate['name'], 'gate name')
    const detail = stringValue(candidate['detail'], 'gate detail')
    if (name.trim() !== name || detail.trim() !== detail
      || (candidate['state'] !== 'pass' && candidate['state'] !== 'block')) {
      validationError('Execution event gate result has an invalid semantic value.')
    }
  }
}

export function parseExecutionEventJsonLine(line: string): JmbExecutionEvent {
  let decoded: unknown
  try {
    decoded = JSON.parse(line)
  } catch {
    validationError('Execution event line is not valid JSON.')
  }
  const value = objectValue(decoded)
  assertExactFields(value)

  if (value['schema_version'] !== 1) validationError('Execution event schema_version must be 1.')
  const eventId = stringValue(value['event_id'], 'event_id')
  const eventType = stringValue(value['event_type'], 'event_type')
  if (!LIFECYCLE_STATES.has(eventType)) validationError('Execution event lifecycle is not allowlisted.')
  const eventTime = stringValue(value['event_time'], 'event_time')
  if (!Number.isFinite(Date.parse(eventTime))) validationError('Execution event event_time is invalid.')

  const broker = stringValue(value['broker'], 'broker')
  if (broker !== 'hfmarkets' && broker !== 'icmarkets') validationError('Execution event broker is not allowlisted.')
  const server = stringValue(value['server'], 'server')
  const expectedServer = broker === 'hfmarkets' ? 'HFMarketsGlobal-Demo4' : 'ICMarketsSC-Demo'
  if (server !== expectedServer) validationError('Execution event server does not match the broker demo server.')
  if (value['account_mode'] !== 'demo') validationError('Execution event must come from a demo account.')
  stringValue(value['account_identity_masked'], 'account_identity_masked')
  if (value['symbol'] !== 'XAUUSD') validationError('Execution event must describe XAUUSD.')
  if (value['strategy_version'] !== 'daily-trend-v1') validationError('Execution event strategy_version is invalid.')
  const expectedMagicNumber = broker === 'hfmarkets' ? 880101 : 880201
  if (value['magic_number'] !== expectedMagicNumber) validationError('Execution event magic_number does not match the broker.')

  const decisionId = stringValue(value['decision_id'], 'decision_id')
  const observationId = stringValue(value['observation_id'], 'observation_id')
  validateGateResults(value['gate_results'])
  nullableFiniteValue(value['calculated_risk'], 'calculated_risk')
  nullableFiniteValue(value['requested_volume'], 'requested_volume')
  const requestedPrice = nullableFiniteValue(value['requested_price'], 'requested_price')
  nullableFiniteValue(value['requested_stop_loss'], 'requested_stop_loss')
  nullableFiniteValue(value['accepted_volume'], 'accepted_volume')
  const acceptedPrice = nullableFiniteValue(value['accepted_price'], 'accepted_price')
  nullableFiniteValue(value['accepted_stop_loss'], 'accepted_stop_loss')
  stringValue(value['result_code'], 'result_code', true)
  stringValue(value['result_detail'], 'result_detail', true)
  stringValue(value['order_ticket'], 'order_ticket', true)
  stringValue(value['deal_ticket'], 'deal_ticket', true)
  const positionId = stringValue(value['position_id'], 'position_id', true)
  const reconciliationState = stringValue(value['reconciliation_state'], 'reconciliation_state')
  const dailyLossCount = finiteValue(value['daily_loss_count'], 'daily_loss_count')
  if (!Number.isInteger(dailyLossCount) || dailyLossCount < 0) {
    validationError('Execution event daily_loss_count must be a non-negative integer.')
  }
  finiteValue(value['daily_realized_loss'], 'daily_realized_loss')
  const commission = nullableFiniteValue(value['commission'], 'commission')
  const swap = nullableFiniteValue(value['swap'], 'swap')
  const fee = nullableFiniteValue(value['fee'], 'fee')
  const netResult = nullableFiniteValue(value['net_result'], 'net_result')
  const maxAdverseExcursion = nullableFiniteValue(value['max_adverse_excursion'], 'max_adverse_excursion')
  const maxFavorableExcursion = nullableFiniteValue(value['max_favorable_excursion'], 'max_favorable_excursion')

  if (eventType === 'closed' || eventType === 'stopped') {
    if (!positionId) {
      validationError('Terminal execution event correlation identifiers are required.')
    }
    if (commission === null || swap === null || fee === null || netResult === null) {
      validationError('Terminal execution event money fields must be finite.')
    }
  }

  return {
    schemaVersion: 1,
    eventId,
    eventType,
    eventTime,
    broker,
    server,
    accountMode: 'demo',
    symbol: 'XAUUSD',
    strategyVersion: 'daily-trend-v1',
    decisionId,
    observationId,
    positionId,
    reconciliationState,
    requestedPrice,
    acceptedPrice,
    commission,
    swap,
    fee,
    netResult,
    maxAdverseExcursion,
    maxFavorableExcursion,
  }
}

export function executionEventToOutcome(event: JmbExecutionEvent): JmbExecutionOutcomeRecord | null {
  if ((event.eventType !== 'closed' && event.eventType !== 'stopped') || event.reconciliationState !== 'reconciled') {
    return null
  }
  if (event.commission === null || event.swap === null || event.fee === null || event.netResult === null) {
    validationError('Reconciled terminal execution event is missing finite outcome money fields.')
  }

  return {
    schemaVersion: 1,
    outcomeEventId: event.eventId,
    outcomeAt: event.eventTime,
    broker: event.broker,
    server: event.server,
    accountMode: 'demo',
    symbol: 'XAUUSD',
    strategyVersion: 'daily-trend-v1',
    decisionId: event.decisionId,
    observationId: event.observationId,
    positionId: event.positionId,
    result: event.netResult > 0 ? 'win' : event.netResult < 0 ? 'loss' : 'breakeven',
    netResult: event.netResult,
    commission: event.commission,
    swap: event.swap,
    fee: event.fee,
    requestedPrice: event.requestedPrice,
    acceptedPrice: event.acceptedPrice,
    slippage: event.requestedPrice === null || event.acceptedPrice === null
      ? null
      : event.acceptedPrice - event.requestedPrice,
    maxAdverseExcursion: event.maxAdverseExcursion,
    maxFavorableExcursion: event.maxFavorableExcursion,
    source: 'ea_demo',
  }
}

function physicalJsonLines(text: string, label: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines.map((physicalLine, index) => {
    const line = physicalLine.endsWith('\r') ? physicalLine.slice(0, -1) : physicalLine
    if (line === '') validationError(`${label} physical line ${index + 1} is empty.`)
    return line
  })
}

export async function readExecutionEvents(
  executionRoot: string,
  broker: Broker,
  symbol: 'XAUUSD',
): Promise<JmbExecutionEvent[]> {
  const text = await readFile(join(executionRoot, broker, symbol, 'events.jsonl'), 'utf8')
  return physicalJsonLines(text, 'Execution event').map(parseExecutionEventJsonLine)
}

function learningDirectory(root: string, broker: Broker, symbol: 'XAUUSD'): string {
  return join(root, broker, symbol)
}

export function outcomeJournalPath(root: string, broker: Broker, symbol: 'XAUUSD'): string {
  return join(learningDirectory(root, broker, symbol), 'outcomes.jsonl')
}

export function outcomeSummaryPath(root: string, broker: Broker, symbol: 'XAUUSD'): string {
  return join(learningDirectory(root, broker, symbol), 'summary.json')
}

function validateOutcomeRecord(value: unknown): JmbExecutionOutcomeRecord {
  const candidate = objectValue(value)
  const actualFields = Reflect.ownKeys(candidate)
  if (actualFields.some((field) => typeof field !== 'string')
    || actualFields.map(String).sort().join(',') !== [...OUTCOME_RECORD_FIELDS].sort().join(',')) {
    validationError('Execution learning record fields do not match the exact outcome contract.')
  }

  const broker = candidate['broker']
  const server = candidate['server']
  const result = candidate['result']
  if (candidate['schemaVersion'] !== 1
    || (broker !== 'hfmarkets' && broker !== 'icmarkets')
    || (server !== 'HFMarketsGlobal-Demo4' && server !== 'ICMarketsSC-Demo')
    || candidate['accountMode'] !== 'demo'
    || candidate['symbol'] !== 'XAUUSD'
    || candidate['strategyVersion'] !== 'daily-trend-v1'
    || candidate['source'] !== 'ea_demo'
    || (result !== 'win' && result !== 'loss' && result !== 'breakeven')) {
    validationError('Execution learning record contract is invalid.')
  }
  if (server !== (broker === 'hfmarkets' ? 'HFMarketsGlobal-Demo4' : 'ICMarketsSC-Demo')) {
    validationError('Execution learning broker and server pair is inconsistent.')
  }
  const outcomeEventId = stringValue(candidate['outcomeEventId'], 'outcomeEventId')
  const outcomeAt = stringValue(candidate['outcomeAt'], 'outcomeAt')
  const decisionId = stringValue(candidate['decisionId'], 'decisionId')
  const observationId = stringValue(candidate['observationId'], 'observationId')
  const positionId = stringValue(candidate['positionId'], 'positionId')
  for (const [field, item] of [
    ['outcomeEventId', outcomeEventId], ['outcomeAt', outcomeAt], ['decisionId', decisionId],
    ['observationId', observationId], ['positionId', positionId],
  ] as const) {
    if (item.trim() !== item) validationError(`Execution learning ${field} must be canonical text.`)
  }
  if (!Number.isFinite(Date.parse(outcomeAt))) validationError('Execution learning outcomeAt is invalid.')
  const netResult = finiteValue(candidate['netResult'], 'netResult')
  const commission = finiteValue(candidate['commission'], 'commission')
  const swap = finiteValue(candidate['swap'], 'swap')
  const fee = finiteValue(candidate['fee'], 'fee')
  const requestedPrice = nullableFiniteValue(candidate['requestedPrice'], 'requestedPrice')
  const acceptedPrice = nullableFiniteValue(candidate['acceptedPrice'], 'acceptedPrice')
  const slippage = nullableFiniteValue(candidate['slippage'], 'slippage')
  const maxAdverseExcursion = nullableFiniteValue(candidate['maxAdverseExcursion'], 'maxAdverseExcursion')
  const maxFavorableExcursion = nullableFiniteValue(candidate['maxFavorableExcursion'], 'maxFavorableExcursion')
  const expectedResult = netResult > 0 ? 'win' : netResult < 0 ? 'loss' : 'breakeven'
  if (result !== expectedResult) validationError('Execution learning result is inconsistent with netResult.')
  const expectedSlippage = requestedPrice === null || acceptedPrice === null
    ? null
    : acceptedPrice - requestedPrice
  if (slippage !== expectedSlippage) {
    validationError('Execution learning slippage is inconsistent with requested and accepted prices.')
  }

  return {
    schemaVersion: 1,
    outcomeEventId,
    outcomeAt,
    broker,
    server,
    accountMode: 'demo',
    symbol: 'XAUUSD',
    strategyVersion: 'daily-trend-v1',
    decisionId,
    observationId,
    positionId,
    result,
    netResult,
    commission,
    swap,
    fee,
    requestedPrice,
    acceptedPrice,
    slippage,
    maxAdverseExcursion,
    maxFavorableExcursion,
    source: 'ea_demo',
  }
}

export async function readExecutionLearningRecords(
  root: string,
  broker: Broker,
  symbol: 'XAUUSD',
): Promise<JmbExecutionOutcomeRecord[]> {
  let text: string
  try {
    text = await readFile(outcomeJournalPath(root, broker, symbol), 'utf8')
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return []
    throw error
  }
  return physicalJsonLines(text, 'Execution learning record').map((line) => {
    try {
      return validateOutcomeRecord(JSON.parse(line))
    } catch (error) {
      if (error instanceof ExecutionOutcomeValidationError) throw error
      validationError('Execution learning record line is not valid JSON.')
    }
  })
}

function summarizeOutcomes(records: readonly JmbExecutionOutcomeRecord[]): Record<string, unknown> {
  const slippages = records.flatMap((record) => record.slippage === null ? [] : [record.slippage])
  const latest = records.reduce<string | null>((current, record) => (
    current === null || Date.parse(record.outcomeAt) > Date.parse(current) ? record.outcomeAt : current
  ), null)
  return {
    schemaVersion: 1,
    evidenceOnly: true,
    count: records.length,
    totalNetResult: records.reduce((total, record) => total + record.netResult, 0),
    winCount: records.filter((record) => record.result === 'win').length,
    lossCount: records.filter((record) => record.result === 'loss').length,
    breakevenCount: records.filter((record) => record.result === 'breakeven').length,
    totalCommission: records.reduce((total, record) => total + record.commission, 0),
    totalSwap: records.reduce((total, record) => total + record.swap, 0),
    totalFee: records.reduce((total, record) => total + record.fee, 0),
    averageSlippage: slippages.length === 0 ? null : slippages.reduce((total, value) => total + value, 0) / slippages.length,
    latestOutcomeAt: latest,
  }
}

async function appendDurableJsonLine(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'a')
  try {
    await handle.appendFile(`${JSON.stringify(value)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

const appendLocks = new Map<string, Promise<void>>()

async function withAppendLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = appendLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const current = previous.then(() => gate)
  appendLocks.set(key, current)
  await previous
  try {
    return await operation()
  } finally {
    release()
    if (appendLocks.get(key) === current) appendLocks.delete(key)
  }
}

export async function appendOutcomeOnce(root: string, record: JmbExecutionOutcomeRecord): Promise<boolean> {
  const normalizedRecord = validateOutcomeRecord(record)
  const journalPath = outcomeJournalPath(root, normalizedRecord.broker, normalizedRecord.symbol)
  return withAppendLock(journalPath, async () => {
    const records = await readExecutionLearningRecords(root, normalizedRecord.broker, normalizedRecord.symbol)
    const alreadyJournaled = records.some((item) => item.outcomeEventId === normalizedRecord.outcomeEventId)
    const authoritativeRecords = alreadyJournaled ? records : [...records, normalizedRecord]
    if (!alreadyJournaled) await appendDurableJsonLine(journalPath, normalizedRecord)
    await writeJsonAtomically(
      outcomeSummaryPath(root, normalizedRecord.broker, normalizedRecord.symbol),
      summarizeOutcomes(authoritativeRecords),
    )
    return !alreadyJournaled
  })
}
