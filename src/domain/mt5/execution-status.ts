import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type JmbExecutionLifecycleState =
  | 'disabled'
  | 'paused'
  | 'blocked'
  | 'ready'
  | 'order_requesting'
  | 'order_rejected'
  | 'reconciliation_required'
  | 'filled_protected'
  | 'close_requesting'
  | 'closed'
  | 'stopped'
  | 'emergency_close'
  | 'error'

export type JmbExecutionRolloutStage = 'status_only' | 'hfm_canary' | 'ic_canary' | 'both_demo'
export type JmbResearchExecutionState = JmbExecutionLifecycleState | 'demo_blocked' | 'missing' | 'malformed' | 'stale'
export type JmbExecutionBroker = 'hfmarkets' | 'icmarkets'
export type JmbExecutionSymbol = 'XAUUSD' | 'EURUSD'

export interface JmbExecutionStatusSummary {
  state: JmbResearchExecutionState
  label: string
  detail: string
  capturedAt: string | null
  broker: JmbExecutionBroker
  server: string | null
  accountMode: 'demo' | null
  symbol: JmbExecutionSymbol
  rolloutStage: JmbExecutionRolloutStage
  executionEnabled: boolean
  killSwitch: boolean
  decisionId: string | null
  observationId: string | null
  latestEvent: { id: string; type: string; at: string; resultCode: string; detail: string } | null
  stopProtectionConfirmed: boolean
  position: { direction: 'buy' | 'sell'; volume: number; openPrice: number; stopLoss: number; id: string } | null
  reconciliationState: string
  dailyLossCount: number
  dailyRealizedLoss: number
  blockingGate: string | null
  nextSafeAction: string
}

const STATUS_HEADER = [
  'schema_version',
  'captured_at',
  'broker',
  'server',
  'account_mode',
  'symbol',
  'state',
  'detail',
  'rollout_stage',
  'execution_enabled',
  'kill_switch',
  'decision_id',
  'observation_id',
  'event_id',
  'event_type',
  'event_time',
  'result_code',
  'result_detail',
  'stop_protection_confirmed',
  'position_direction',
  'position_volume',
  'position_open_price',
  'position_stop_loss',
  'position_id',
  'reconciliation_state',
  'daily_loss_count',
  'daily_realized_loss',
  'blocking_gate',
  'next_safe_action',
] as const

const LIFECYCLE_STATES = new Set<JmbExecutionLifecycleState>([
  'disabled',
  'paused',
  'blocked',
  'ready',
  'order_requesting',
  'order_rejected',
  'reconciliation_required',
  'filled_protected',
  'close_requesting',
  'closed',
  'stopped',
  'emergency_close',
  'error',
])
const ROLLOUT_STAGES = new Set<JmbExecutionRolloutStage>(['status_only', 'hfm_canary', 'ic_canary', 'both_demo'])
const MAX_STATUS_AGE_MS = 2 * 60_000
const MAX_CLOCK_SKEW_MS = 60_000

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      record.push(field)
      field = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      record.push(field)
      records.push(record)
      field = ''
      record = []
      if (character === '\r' && text[index + 1] === '\n') index += 1
    } else {
      field += character
    }
  }

  if (quoted) throw new Error('Execution status CSV contains an unterminated quoted field.')
  if (field !== '' || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  return records
}

function requiredFinite(value: string, field: string): number {
  if (value === '') throw new Error(`Execution status ${field} is required.`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Execution status ${field} must be finite.`)
  return parsed
}

function binary(value: string, field: string): boolean {
  if (value !== '0' && value !== '1') throw new Error(`Execution status ${field} must be 0 or 1.`)
  return value === '1'
}

function nullable(value: string): string | null {
  return value === '' ? null : value
}

function assertExactGroup(values: string[], label: string): boolean {
  const populated = values.filter((value) => value !== '').length
  if (populated !== 0 && populated !== values.length) throw new Error(`Execution status ${label} is incomplete.`)
  return populated === values.length
}

function labelFor(state: JmbResearchExecutionState, executionEnabled: boolean): string {
  if (state === 'disabled') return 'EXECUTION DISABLED'
  if (state === 'ready') return 'CANARY READY'
  if (state === 'filled_protected') return executionEnabled ? 'DEMO ENABLED' : 'EXECUTION DISABLED'
  if (state === 'paused') return 'PAUSED'
  if (state === 'reconciliation_required') return 'RECONCILIATION REQUIRED'
  if (state === 'demo_blocked') return 'DEMO BLOCKED'
  if (state === 'missing') return 'STATUS MISSING'
  if (state === 'malformed') return 'STATUS MALFORMED'
  if (state === 'stale') return 'STATUS STALE'
  if (state === 'order_requesting' || state === 'close_requesting') return 'DEMO ENABLED'
  return 'BLOCKED'
}

export function parseExecutionStatusCsv(text: string): JmbExecutionStatusSummary {
  const records = parseCsvRecords(text)
  if (records.length !== 2) throw new Error('Execution status CSV schema requires one header and one row.')
  const [header, values] = records
  if (header.length !== STATUS_HEADER.length
    || values.length !== STATUS_HEADER.length
    || !header.every((field, index) => field === STATUS_HEADER[index])) {
    throw new Error('Execution status CSV schema mismatch.')
  }

  const row = Object.fromEntries(STATUS_HEADER.map((field, index) => [field, values[index] ?? '']))
  if (row['schema_version'] !== '1') throw new Error('Execution status schema_version must be 1.')
  if (!Number.isFinite(Date.parse(row['captured_at']!))) throw new Error('Execution status captured_at is invalid.')
  if (row['broker'] !== 'hfmarkets' && row['broker'] !== 'icmarkets') throw new Error('Execution status broker is not allowlisted.')
  if (row['account_mode'] !== 'demo') throw new Error('Execution status must describe a demo account.')
  if (row['symbol'] !== 'XAUUSD' && row['symbol'] !== 'EURUSD') throw new Error('Execution status symbol is not allowlisted.')
  if (!LIFECYCLE_STATES.has(row['state'] as JmbExecutionLifecycleState)) throw new Error('Execution status lifecycle state is invalid.')
  if (!ROLLOUT_STAGES.has(row['rollout_stage'] as JmbExecutionRolloutStage)) throw new Error('Execution status rollout stage is invalid.')
  if (!row['server'] || !row['detail'] || !row['reconciliation_state'] || !row['next_safe_action']) {
    throw new Error('Execution status required operational detail is missing.')
  }

  const hasEvent = assertExactGroup([row['event_id']!, row['event_type']!, row['event_time']!], 'latest event identity')
  if (!hasEvent && (row['result_code'] !== '' || row['result_detail'] !== '')) {
    throw new Error('Execution status event result has no event identity.')
  }
  if (hasEvent && !Number.isFinite(Date.parse(row['event_time']!))) throw new Error('Execution status event_time is invalid.')

  const hasPosition = assertExactGroup([
    row['position_direction']!, row['position_volume']!, row['position_open_price']!, row['position_stop_loss']!, row['position_id']!,
  ], 'position')
  if (hasPosition && row['position_direction'] !== 'buy' && row['position_direction'] !== 'sell') {
    throw new Error('Execution status position direction is invalid.')
  }

  const dailyLossCount = requiredFinite(row['daily_loss_count']!, 'daily_loss_count')
  if (!Number.isInteger(dailyLossCount) || dailyLossCount < 0) throw new Error('Execution status daily_loss_count must be a non-negative integer.')
  const state = row['state'] as JmbExecutionLifecycleState
  const rolloutStage = row['rollout_stage'] as JmbExecutionRolloutStage
  const executionEnabled = binary(row['execution_enabled']!, 'execution_enabled')
  const killSwitch = binary(row['kill_switch']!, 'kill_switch')
  const stopProtectionConfirmed = binary(row['stop_protection_confirmed']!, 'stop_protection_confirmed')
  const position = hasPosition ? {
    direction: row['position_direction'] as 'buy' | 'sell',
    volume: requiredFinite(row['position_volume']!, 'position_volume'),
    openPrice: requiredFinite(row['position_open_price']!, 'position_open_price'),
    stopLoss: requiredFinite(row['position_stop_loss']!, 'position_stop_loss'),
    id: row['position_id']!,
  } : null

  if (position && (position.volume <= 0 || position.openPrice <= 0 || position.id.trim() === '')) {
    throw new Error('Execution status position must have a positive volume and open price with a nonempty opaque id.')
  }
  const hasProtectiveStop = position !== null
    && position.stopLoss > 0
    && (position.direction === 'buy' ? position.stopLoss < position.openPrice : position.stopLoss > position.openPrice)
  if (stopProtectionConfirmed && !hasProtectiveStop) {
    throw new Error('Execution status stop protection requires a complete position with a valid protective stop.')
  }
  if (state === 'filled_protected' && (!stopProtectionConfirmed || !hasProtectiveStop)) {
    throw new Error('Execution status filled_protected requires a confirmed protected position.')
  }
  if (rolloutStage === 'status_only' && executionEnabled) {
    throw new Error('Execution status status_only rollout cannot enable execution.')
  }

  return {
    state,
    label: labelFor(state, executionEnabled),
    detail: row['detail']!,
    capturedAt: row['captured_at']!,
    broker: row['broker'] as JmbExecutionBroker,
    server: row['server']!,
    accountMode: 'demo',
    symbol: row['symbol'] as JmbExecutionSymbol,
    rolloutStage,
    executionEnabled,
    killSwitch,
    decisionId: nullable(row['decision_id']!),
    observationId: nullable(row['observation_id']!),
    latestEvent: hasEvent ? {
      id: row['event_id']!,
      type: row['event_type']!,
      at: row['event_time']!,
      resultCode: row['result_code']!,
      detail: row['result_detail']!,
    } : null,
    stopProtectionConfirmed,
    position,
    reconciliationState: row['reconciliation_state']!,
    dailyLossCount,
    dailyRealizedLoss: requiredFinite(row['daily_realized_loss']!, 'daily_realized_loss'),
    blockingGate: nullable(row['blocking_gate']!),
    nextSafeAction: row['next_safe_action']!,
  }
}

function safeSummary(
  state: 'missing' | 'malformed' | 'stale',
  broker: JmbExecutionBroker,
  symbol: JmbExecutionSymbol,
  capturedAt: string | null = null,
): JmbExecutionStatusSummary {
  const detail = state === 'missing'
    ? 'No broker-local MT5 demo execution status is available.'
    : state === 'malformed'
      ? 'The broker-local execution status failed strict validation and is treated as blocked.'
      : 'The broker-local execution status is stale and cannot be trusted for operational monitoring.'
  return {
    state,
    label: labelFor(state, false),
    detail,
    capturedAt,
    broker,
    server: null,
    accountMode: null,
    symbol,
    rolloutStage: 'status_only',
    executionEnabled: false,
    killSwitch: true,
    decisionId: null,
    observationId: null,
    latestEvent: null,
    stopProtectionConfirmed: false,
    position: null,
    reconciliationState: 'unverified',
    dailyLossCount: 0,
    dailyRealizedLoss: 0,
    blockingGate: 'execution_status',
    nextSafeAction: 'Inspect the broker-local MT5 demo EA and restore a fresh, valid status artifact.',
  }
}

export function createDemoBlockedExecutionSummary(
  broker: JmbExecutionBroker,
  symbol: 'EURUSD',
): JmbExecutionStatusSummary {
  return {
    ...safeSummary('missing', broker, symbol),
    state: 'demo_blocked',
    label: labelFor('demo_blocked', false),
    detail: 'EURUSD remains shadow-only and is not eligible for Plan 3 demo execution.',
    blockingGate: 'instrument_allowlist',
    nextSafeAction: 'Continue read-only shadow observation; no execution action is available.',
  }
}

function fileErrorCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : null
}

export async function summarizeLatestJmbExecutionStatus(
  root: string,
  broker: JmbExecutionBroker,
  symbol: JmbExecutionSymbol,
  now = new Date(),
): Promise<JmbExecutionStatusSummary> {
  let text: string
  try {
    text = await readFile(join(root, broker, symbol, 'latest_status.csv'), 'utf8')
  } catch (error) {
    return safeSummary(fileErrorCode(error) === 'ENOENT' ? 'missing' : 'malformed', broker, symbol)
  }

  let summary: JmbExecutionStatusSummary
  try {
    summary = parseExecutionStatusCsv(text)
  } catch {
    return safeSummary('malformed', broker, symbol)
  }
  if (summary.broker !== broker || summary.symbol !== symbol) return safeSummary('malformed', broker, symbol)

  const ageMs = now.getTime() - Date.parse(summary.capturedAt!)
  if (ageMs > MAX_STATUS_AGE_MS || ageMs < -MAX_CLOCK_SKEW_MS) {
    return safeSummary('stale', broker, symbol, summary.capturedAt)
  }
  return summary
}
