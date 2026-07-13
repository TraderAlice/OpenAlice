import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface JmbGateResult {
  name: string
  state: 'pass' | 'block'
  detail: string
}

export interface JmbExecutionDecision {
  schemaVersion: 1
  decisionId: string
  observationId: string
  observationAsOf: string
  createdAt: string
  leaseIssuedAt: string
  leaseExpiresAt: string
  broker: 'hfmarkets' | 'icmarkets'
  server: 'HFMarketsGlobal-Demo4' | 'ICMarketsSC-Demo'
  accountMode: 'demo'
  symbol: 'XAUUSD'
  strategyVersion: 'daily-trend-v1'
  direction: 'buy' | 'sell' | 'flat'
  entryReferencePrice: number | null
  volume: 0.01
  stopLoss: number | null
  maxRiskAmount: number
  candidatePolicyVersion: string
  costModelVersion: string
  gateResults: JmbGateResult[]
}

export interface WriteExecutionDecisionResult {
  state: 'published' | 'regressed'
  journalAppended: boolean
}

const HEADER = [
  'schema_version',
  'decision_id',
  'observation_id',
  'observation_as_of',
  'created_at',
  'lease_issued_at',
  'lease_expires_at',
  'broker',
  'server',
  'account_mode',
  'symbol',
  'strategy_version',
  'direction',
  'entry_reference_price',
  'volume',
  'stop_loss',
  'max_risk_amount',
  'candidate_policy_version',
  'cost_model_version',
  'gate_results_json',
] as const

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const FORBIDDEN_TEXT = /[\r\n]/

function hash(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 24)
}

export function createObservationId(
  input: Pick<JmbExecutionDecision, 'broker' | 'symbol' | 'strategyVersion' | 'observationAsOf'>,
): string {
  return hash([input.broker, input.symbol, input.strategyVersion, input.observationAsOf])
}

export function createExecutionDecisionId(input: Pick<JmbExecutionDecision, 'observationId'>): string {
  return hash(['daily-trend-v1', input.observationId])
}

function csvEscape(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
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
  if (quoted) throw new Error('Execution decision CSV has an unterminated quoted field.')
  if (current !== '' || record.length > 0) {
    record.push(current)
    records.push(record)
  }
  return records
}

function requiredFinite(value: string, field: string): number {
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isFinite(parsed)) throw new Error(`Execution decision ${field} must be finite.`)
  return parsed
}

function optionalFinite(value: string, field: string): number | null {
  return value === '' ? null : requiredFinite(value, field)
}

function requireTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) throw new Error(`Execution decision ${field} must be a valid timestamp.`)
  return parsed
}

function requireCanonicalText(value: string, field: string): void {
  if (value === '' || value.trim() !== value || FORBIDDEN_TEXT.test(value)) {
    throw new Error(`Execution decision ${field} must be non-empty canonical text.`)
  }
}

function validateGateResults(value: unknown): asserts value is JmbGateResult[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error('Execution decision gate results must be a non-empty array.')
  for (const gate of value) {
    if (typeof gate !== 'object' || gate === null) throw new Error('Execution decision gate result is malformed.')
    const candidate = gate as Record<string, unknown>
    if (Object.keys(candidate).sort().join(',') !== 'detail,name,state'
      || typeof candidate['name'] !== 'string'
      || typeof candidate['detail'] !== 'string'
      || (candidate['state'] !== 'pass' && candidate['state'] !== 'block')) {
      throw new Error('Execution decision gate result has an invalid semantic value.')
    }
    requireCanonicalText(candidate['name'], 'gate name')
    requireCanonicalText(candidate['detail'], 'gate detail')
  }
}

function validateDecision(decision: JmbExecutionDecision): void {
  if (decision.schemaVersion !== 1) throw new Error('Execution decision schema version must be 1.')
  if (!ISO_DATE.test(decision.observationAsOf) || !Number.isFinite(Date.parse(`${decision.observationAsOf}T00:00:00Z`))) {
    throw new Error('Execution decision observation date is invalid.')
  }
  const createdAt = requireTimestamp(decision.createdAt, 'created_at')
  const leaseIssuedAt = requireTimestamp(decision.leaseIssuedAt, 'lease_issued_at')
  const leaseExpiresAt = requireTimestamp(decision.leaseExpiresAt, 'lease_expires_at')
  if (createdAt > leaseIssuedAt || leaseIssuedAt >= leaseExpiresAt) throw new Error('Execution decision lease ordering is invalid.')
  if (decision.broker !== 'hfmarkets' && decision.broker !== 'icmarkets') throw new Error('Execution decision broker is not allowlisted.')
  const expectedServer = decision.broker === 'hfmarkets' ? 'HFMarketsGlobal-Demo4' : 'ICMarketsSC-Demo'
  if (decision.server !== expectedServer) throw new Error('Execution decision server does not match the broker allowlist.')
  if (decision.accountMode !== 'demo') throw new Error('Execution decision account mode must be demo.')
  if (decision.symbol !== 'XAUUSD') throw new Error('Execution decision symbol must be XAUUSD.')
  if (decision.strategyVersion !== 'daily-trend-v1') throw new Error('Execution decision strategy is not allowlisted.')
  if (!['buy', 'sell', 'flat'].includes(decision.direction)) throw new Error('Execution decision direction is invalid.')
  if (decision.volume !== 0.01) throw new Error('Execution decision volume must be exactly 0.01.')
  if (decision.entryReferencePrice !== null && (!Number.isFinite(decision.entryReferencePrice) || decision.entryReferencePrice <= 0)) {
    throw new Error('Execution decision entry reference price must be positive and finite.')
  }
  if (decision.stopLoss !== null && (!Number.isFinite(decision.stopLoss) || decision.stopLoss <= 0)) {
    throw new Error('Execution decision stop loss must be positive and finite.')
  }
  if (!Number.isFinite(decision.maxRiskAmount) || decision.maxRiskAmount <= 0) throw new Error('Execution decision maximum risk must be positive and finite.')
  requireCanonicalText(decision.candidatePolicyVersion, 'candidate policy version')
  requireCanonicalText(decision.costModelVersion, 'cost model version')
  validateGateResults(decision.gateResults)
  const expectedObservationId = createObservationId(decision)
  if (decision.observationId !== expectedObservationId) throw new Error('Execution decision observation ID does not match its immutable identity.')
  if (decision.decisionId !== createExecutionDecisionId(decision)) throw new Error('Execution decision ID does not match its observation ID.')
}

export function serializeExecutionDecisionCsv(decision: JmbExecutionDecision): string {
  validateDecision(decision)
  const values = [
    String(decision.schemaVersion),
    decision.decisionId,
    decision.observationId,
    decision.observationAsOf,
    decision.createdAt,
    decision.leaseIssuedAt,
    decision.leaseExpiresAt,
    decision.broker,
    decision.server,
    decision.accountMode,
    decision.symbol,
    decision.strategyVersion,
    decision.direction,
    decision.entryReferencePrice === null ? '' : String(decision.entryReferencePrice),
    String(decision.volume),
    decision.stopLoss === null ? '' : String(decision.stopLoss),
    String(decision.maxRiskAmount),
    decision.candidatePolicyVersion,
    decision.costModelVersion,
    JSON.stringify(decision.gateResults),
  ]
  return `${HEADER.join(',')}\n${values.map(csvEscape).join(',')}\n`
}

export function parseExecutionDecisionCsv(text: string): JmbExecutionDecision {
  const records = parseCsvRecords(text)
  if (records.length !== 2) throw new Error('Execution decision CSV must contain exactly one header and one row.')
  const [headers, values] = records as [string[], string[]]
  if (headers.join(',') !== HEADER.join(',') || values.length !== HEADER.length) throw new Error('Execution decision CSV schema mismatch.')
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  let gateResults: unknown
  try {
    gateResults = JSON.parse(row['gate_results_json']!)
  } catch {
    throw new Error('Execution decision gate results JSON is malformed.')
  }
  validateGateResults(gateResults)
  const decision: JmbExecutionDecision = {
    schemaVersion: row['schema_version'] === '1' ? 1 : (Number(row['schema_version']) as 1),
    decisionId: row['decision_id']!,
    observationId: row['observation_id']!,
    observationAsOf: row['observation_as_of']!,
    createdAt: row['created_at']!,
    leaseIssuedAt: row['lease_issued_at']!,
    leaseExpiresAt: row['lease_expires_at']!,
    broker: row['broker'] as JmbExecutionDecision['broker'],
    server: row['server'] as JmbExecutionDecision['server'],
    accountMode: row['account_mode'] as 'demo',
    symbol: row['symbol'] as 'XAUUSD',
    strategyVersion: row['strategy_version'] as 'daily-trend-v1',
    direction: row['direction'] as JmbExecutionDecision['direction'],
    entryReferencePrice: optionalFinite(row['entry_reference_price']!, 'entry_reference_price'),
    volume: requiredFinite(row['volume']!, 'volume') as 0.01,
    stopLoss: optionalFinite(row['stop_loss']!, 'stop_loss'),
    maxRiskAmount: requiredFinite(row['max_risk_amount']!, 'max_risk_amount'),
    candidatePolicyVersion: row['candidate_policy_version']!,
    costModelVersion: row['cost_model_version']!,
    gateResults,
  }
  validateDecision(decision)
  return decision
}

function materialEvidence(decision: JmbExecutionDecision): string {
  const { createdAt: _createdAt, leaseIssuedAt: _leaseIssuedAt, leaseExpiresAt: _leaseExpiresAt, ...evidence } = decision
  return JSON.stringify(evidence)
}

function fileCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : null
}

async function readLatest(path: string): Promise<JmbExecutionDecision | null> {
  try {
    return parseExecutionDecisionCsv(await readFile(path, 'utf8'))
  } catch (error) {
    if (fileCode(error) === 'ENOENT') return null
    throw error
  }
}

async function replaceAtomically(destination: string, contents: string): Promise<void> {
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, contents, { encoding: 'utf8', flag: 'wx' })
  try {
    await rename(temporary, destination)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}

export async function writeExecutionDecision(root: string, decision: JmbExecutionDecision): Promise<WriteExecutionDecisionResult> {
  const destination = join(root, decision.broker, decision.symbol, 'latest_decision.csv')
  await mkdir(dirname(destination), { recursive: true })
  const serialized = serializeExecutionDecisionCsv(decision)
  const latest = await readLatest(destination)
  if (latest !== null && (decision.observationAsOf < latest.observationAsOf
    || (decision.observationAsOf === latest.observationAsOf && Date.parse(decision.leaseIssuedAt) < Date.parse(latest.leaseIssuedAt)))) {
    return { state: 'regressed', journalAppended: false }
  }

  const journalAppended = latest === null || materialEvidence(latest) !== materialEvidence(decision)
  if (journalAppended) {
    await appendFile(join(dirname(destination), 'decisions.jsonl'), `${JSON.stringify(decision)}\n`, 'utf8')
  }
  await replaceAtomically(destination, serialized)
  return { state: 'published', journalAppended }
}
