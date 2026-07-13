import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

import {
  buildBrokerCostModel,
  writeBrokerCostModel,
  type BrokerCostClosedDeal,
  type BrokerCostSpreadSample,
} from './broker-cost-model.js'
import { deriveCompletedTrendObservation, readMt5CompletedD1 } from './completed-d1.js'
import { buildDemoExecutionDecision } from './demo-decision-engine.js'
import { readDemoExecutionPolicy } from './demo-execution-policy.js'
import { writeExecutionDecision } from './execution-decision.js'
import type { JmbMt5Roots } from './local-paths.js'
import { readMt5ReadOnlyBridge } from './read-only-bridge.js'
import { parseMt5TradeLedgerCsv, summarizeMt5TradeLedger, type Mt5TradeLedgerRow } from './trade-ledger.js'

export interface JmbDemoInstrumentConfig {
  broker: 'hfmarkets' | 'icmarkets'
  server: 'HFMarketsGlobal-Demo4' | 'ICMarketsSC-Demo'
  symbol: 'XAUUSD' | 'EURUSD'
  researchArtifactSymbol: 'XAUUSDb' | 'EURUSDb' | 'XAUUSD' | 'EURUSD'
  maxSpread: number
  maxDeviation: number
  /** Required for Gold; null for non-persistable shadow-only instruments. */
  stopDistance: number | null
}

export interface DemoDecisionCycleOptions {
  roots: JmbMt5Roots
  now?: () => Date
  instruments?: readonly JmbDemoInstrumentConfig[]
}

export interface DemoDecisionCycleResult {
  broker: string
  symbol: string
  state: 'published' | 'blocked' | 'error'
  observationId: string | null
  decisionId: string | null
  detail: string
}

export const JMB_GOLD_STOP_DISTANCE = 8 as const

export const DEFAULT_JMB_DEMO_INSTRUMENTS = [
  { broker: 'hfmarkets', server: 'HFMarketsGlobal-Demo4', symbol: 'XAUUSD', researchArtifactSymbol: 'XAUUSDb', maxSpread: 0.75, maxDeviation: 0.5, stopDistance: JMB_GOLD_STOP_DISTANCE },
  { broker: 'hfmarkets', server: 'HFMarketsGlobal-Demo4', symbol: 'EURUSD', researchArtifactSymbol: 'EURUSDb', maxSpread: 0.00025, maxDeviation: 0.0002, stopDistance: null },
  { broker: 'icmarkets', server: 'ICMarketsSC-Demo', symbol: 'XAUUSD', researchArtifactSymbol: 'XAUUSD', maxSpread: 0.3, maxDeviation: 0.3, stopDistance: JMB_GOLD_STOP_DISTANCE },
  { broker: 'icmarkets', server: 'ICMarketsSC-Demo', symbol: 'EURUSD', researchArtifactSymbol: 'EURUSD', maxSpread: 0.00015, maxDeviation: 0.0001, stopDistance: null },
] as const satisfies readonly JmbDemoInstrumentConfig[]

const SPREAD_HEADER = 'schema_version,captured_at,broker,server,account_mode,symbol,bid,ask,spread,point,digits,contract_size,volume_min,volume_step,stops_level,freeze_level'
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/

interface ResearchTrendReport {
  symbol: string
  selected_on_training_sharpe: { lookback_days: number }
}

interface ParsedSpreadEvidence {
  samples: BrokerCostSpreadSample[]
  expectedContractFingerprint: string
}

function fileCode(error: unknown): string | null {
  return typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : null
}

function finite(value: string | undefined, field: string): number {
  const parsed = Number(value)
  if (value === undefined || value.trim() === '' || !Number.isFinite(parsed)) throw new Error(`Spread evidence ${field} must be finite.`)
  return parsed
}

function contractFingerprint(values: readonly string[]): string {
  return createHash('sha256').update(values.join('|')).digest('hex')
}

function parseSpreadEvidenceCsv(
  text: string,
  instrument: JmbDemoInstrumentConfig,
): BrokerCostSpreadSample[] {
  const [header, ...rows] = text.trim().split(/\r?\n/)
  if (header !== SPREAD_HEADER || rows.length === 0) throw new Error('Spread evidence CSV has an invalid header or no samples.')
  return rows.map((row) => {
    const values = row.split(',')
    if (values.length !== 16 || values[0] !== '1') throw new Error('Spread evidence row does not match schema version 1.')
    if (values[2] !== instrument.broker
      || values[3] !== instrument.server
      || values[4] !== 'demo'
      || values[5] !== 'XAUUSD') {
      throw new Error('Spread evidence identity does not match the demo Gold instrument.')
    }
    if (!RFC3339_UTC.test(values[1]!) || !Number.isFinite(Date.parse(values[1]!))) {
      throw new Error('Spread evidence captured_at must be canonical RFC 3339 UTC.')
    }
    finite(values[6], 'bid')
    finite(values[7], 'ask')
    const spread = finite(values[8], 'spread')
    const fingerprintValues = values.slice(9, 16)
    fingerprintValues.forEach((value, index) => finite(value, `contract field ${index + 1}`))
    return {
      capturedAt: values[1]!,
      spread,
      contractFingerprint: contractFingerprint(fingerprintValues),
    }
  })
}

async function readSpreadEvidence(root: string, instrument: JmbDemoInstrumentConfig): Promise<ParsedSpreadEvidence> {
  const directory = join(root, instrument.broker, instrument.symbol)
  let names: string[]
  try {
    names = (await readdir(directory)).filter((name) => /^spread_samples_\d{8}\.csv$/.test(name)).sort()
  } catch (error) {
    if (fileCode(error) === 'ENOENT') return { samples: [], expectedContractFingerprint: '' }
    throw error
  }
  const samples = (await Promise.all(names.map(async (name) => {
    return parseSpreadEvidenceCsv(await readFile(join(directory, name), 'utf8'), instrument)
  }))).flat().sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt))
  return {
    samples,
    expectedContractFingerprint: samples.at(-1)?.contractFingerprint ?? '',
  }
}

async function readLedgerRows(root: string, instrument: JmbDemoInstrumentConfig): Promise<Mt5TradeLedgerRow[]> {
  try {
    return parseMt5TradeLedgerCsv(await readFile(join(root, instrument.broker, instrument.symbol, 'deals.csv'), 'utf8'))
      .filter((row) => row.broker === instrument.broker && row.symbol === instrument.symbol)
  } catch (error) {
    if (fileCode(error) === 'ENOENT') return []
    throw error
  }
}

function closedDeals(rows: readonly Mt5TradeLedgerRow[]): BrokerCostClosedDeal[] {
  return rows.map((row) => ({
    accountMode: row.accountMode,
    symbol: row.symbol,
    closed: row.entry === 'out' || row.entry === 'out_by',
    commission: row.commission,
    swap: row.swap,
  }))
}

function costModelVersion(
  instrument: JmbDemoInstrumentConfig,
  spreadEvidence: ParsedSpreadEvidence,
  rows: readonly Mt5TradeLedgerRow[],
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ spreadEvidence, deals: closedDeals(rows) }))
    .digest('hex')
    .slice(0, 16)
  return `${instrument.broker}-observed-${digest}`
}

function researchFileName(instrument: JmbDemoInstrumentConfig): string {
  const canonical = instrument.researchArtifactSymbol.replace(/b$/, '').toLowerCase()
  return `${instrument.broker === 'icmarkets' ? 'icmarkets-' : ''}${canonical}-trend-baseline.json`
}

async function readSelectedLookback(root: string, instrument: JmbDemoInstrumentConfig): Promise<number> {
  const path = join(root, researchFileName(instrument))
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    throw new Error(`Research artifact is missing or malformed: ${error instanceof Error ? error.message : 'unknown error'}`)
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Research artifact must be an object.')
  const report = parsed as Partial<ResearchTrendReport>
  const lookback = report.selected_on_training_sharpe?.lookback_days
  if (report.symbol !== instrument.researchArtifactSymbol || !Number.isInteger(lookback) || (lookback ?? 0) <= 0) {
    throw new Error('Research artifact identity or frozen selected lookback is invalid.')
  }
  return lookback!
}

function protectiveStop(
  direction: 'uptrend' | 'downtrend' | 'flat',
  bid: number | null,
  ask: number | null,
  distance: number | null,
): number | null {
  if (distance === null || !Number.isFinite(distance) || distance <= 0) return null
  if (direction === 'uptrend' && ask !== null && Number.isFinite(ask)) return Number((ask - distance).toFixed(2))
  if (direction === 'downtrend' && bid !== null && Number.isFinite(bid)) return Number((bid + distance).toFixed(2))
  return null
}

function blockedEurUsd(instrument: JmbDemoInstrumentConfig): DemoDecisionCycleResult {
  return {
    broker: instrument.broker,
    symbol: instrument.symbol,
    state: 'blocked',
    observationId: null,
    decisionId: null,
    detail: 'EURUSD remains shadow-only; its existing shadow journal remains the durable decision record.',
  }
}

async function runInstrumentCycle(
  roots: JmbMt5Roots,
  instrument: JmbDemoInstrumentConfig,
  now: Date,
): Promise<DemoDecisionCycleResult> {
  if (instrument.symbol === 'EURUSD') return blockedEurUsd(instrument)
  if (instrument.stopDistance !== JMB_GOLD_STOP_DISTANCE) {
    throw new Error(`Gold execution stop distance must be exactly ${JMB_GOLD_STOP_DISTANCE}; caller overrides are not permitted.`)
  }

  const policy = await readDemoExecutionPolicy(roots.policyRoot, instrument.broker, instrument.symbol)
  const [bridge, completed, learning, rows, spreadEvidence, lookback] = await Promise.all([
    readMt5ReadOnlyBridge(roots.bridgeRoot, instrument.broker, instrument.symbol, now),
    readMt5CompletedD1(roots.bridgeRoot, instrument.broker, instrument.symbol, {
      now,
      maxAgeHours: policy.policy?.completedObservationMaxAgeHours ?? 72,
      expectedServer: instrument.server,
    }),
    summarizeMt5TradeLedger(roots.ledgerRoot, instrument.broker, instrument.symbol, now),
    readLedgerRows(roots.ledgerRoot, instrument),
    readSpreadEvidence(roots.bridgeRoot, instrument),
    readSelectedLookback(roots.researchRoot, instrument),
  ])

  const nowIso = now.toISOString()
  const model = buildBrokerCostModel({
    version: costModelVersion(instrument, spreadEvidence, rows),
    broker: instrument.broker,
    server: instrument.server,
    symbol: 'XAUUSD',
    now: nowIso,
    bridge: {
      state: bridge.state,
      capturedAt: bridge.lastUpdated ?? '',
      contractFingerprint: spreadEvidence.expectedContractFingerprint,
    },
    spreadSamples: spreadEvidence.samples,
    closedDeals: closedDeals(rows),
    expectedContractFingerprint: spreadEvidence.expectedContractFingerprint,
    configuredMaxSpread: instrument.maxSpread,
    configuredMaxDeviation: instrument.maxDeviation,
  })
  await writeBrokerCostModel(roots.costModelRoot, model)

  const observation = completed.parsed === null ? null : deriveCompletedTrendObservation(completed.parsed, lookback)
  const result = buildDemoExecutionDecision({
    createdAt: nowIso,
    leaseIssuedAt: nowIso,
    leaseExpiresAt: new Date(now.getTime() + 10 * 60_000).toISOString(),
    broker: instrument.broker,
    server: instrument.server,
    symbol: instrument.symbol,
    bridge: {
      state: bridge.state,
      broker: bridge.broker,
      server: bridge.server,
      symbol: bridge.symbol,
    },
    completedObservation: { state: completed.state, detail: completed.detail, observation },
    policy,
    costModel: model,
    learning: { state: learning.state, accountMode: learning.accountMode, server: learning.server },
    quote: { bid: bridge.bid, ask: bridge.ask, spread: bridge.spread },
    stopLoss: observation === null ? null : protectiveStop(observation.direction, bridge.bid, bridge.ask, JMB_GOLD_STOP_DISTANCE),
  })

  if (result.decision === null) {
    return {
      broker: instrument.broker,
      symbol: instrument.symbol,
      state: 'blocked',
      observationId: null,
      decisionId: null,
      detail: result.detail,
    }
  }
  const persisted = await writeExecutionDecision(roots.executionDecisionRoot, result.decision)
  if (persisted.state === 'regressed') {
    return {
      broker: instrument.broker,
      symbol: instrument.symbol,
      state: 'blocked',
      observationId: result.decision.observationId,
      decisionId: result.decision.decisionId,
      detail: 'A newer completed observation is already published; the regressed lease was ignored.',
    }
  }
  return {
    broker: instrument.broker,
    symbol: instrument.symbol,
    state: result.state === 'ready' ? 'published' : 'blocked',
    observationId: result.decision.observationId,
    decisionId: result.decision.decisionId,
    detail: result.detail,
  }
}

export async function runDemoDecisionCycle(options: DemoDecisionCycleOptions): Promise<DemoDecisionCycleResult[]> {
  const now = (options.now ?? (() => new Date()))()
  const instruments = options.instruments ?? DEFAULT_JMB_DEMO_INSTRUMENTS
  return Promise.all(instruments.map(async (instrument) => {
    try {
      return await runInstrumentCycle(options.roots, instrument, now)
    } catch (error) {
      return {
        broker: instrument.broker,
        symbol: instrument.symbol,
        state: 'error',
        observationId: null,
        decisionId: null,
        detail: error instanceof Error ? error.message : 'Unknown demo decision cycle error.',
      }
    }
  }))
}
