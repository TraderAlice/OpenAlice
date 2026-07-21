import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface BrokerCostModel {
  schemaVersion: 1
  version: string
  broker: 'hfmarkets' | 'icmarkets'
  server: string
  symbol: 'XAUUSD'
  state: 'canary_ready' | 'blocked'
  observedFrom: string
  observedTo: string
  expiresAt: string
  spreadSampleCount: number
  observedMaxSpread: number
  configuredMaxSpread: number
  configuredMaxDeviation: number
  commissionObserved: boolean
  swapObserved: boolean
  contractFingerprint: string
  evidence: string[]
}

export interface BrokerCostSpreadSample {
  capturedAt: string
  spread: number
  contractFingerprint: string
}

export interface BrokerCostClosedDeal {
  accountMode: string
  symbol: string
  closed: boolean
  commission: string | number
  swap: string | number
}

export interface BrokerCostModelInput {
  version: string
  broker: 'hfmarkets' | 'icmarkets'
  server: string
  symbol: 'XAUUSD'
  now: string
  bridge: {
    state: string
    capturedAt: string
    contractFingerprint: string
  }
  spreadSamples: BrokerCostSpreadSample[]
  closedDeals: BrokerCostClosedDeal[]
  expectedContractFingerprint: string
  configuredMaxSpread: number
  configuredMaxDeviation: number
}

const COST_MODEL_HEADER = 'schema_version,version,broker,server,symbol,state,observed_from,observed_to,expires_at,spread_sample_count,observed_max_spread,configured_max_spread,configured_max_deviation,commission_observed,swap_observed,contract_fingerprint,evidence_json'
const BRIDGE_MAX_AGE_MS = 2 * 60_000
const OBSERVATION_MAX_AGE_MS = 24 * 60 * 60_000

const BROKER_CEILINGS = {
  hfmarkets: { server: 'HFMarketsGlobal-Demo4', maxSpread: 0.75, maxDeviation: 0.5 },
  icmarkets: { server: 'ICMarketsSC-Demo', maxSpread: 0.3, maxDeviation: 0.3 },
} as const

function finiteAtLeastZero(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function parseFiniteCost(value: string | number): number | null {
  if ((typeof value === 'string' && value.trim() === '') || (typeof value !== 'string' && typeof value !== 'number')) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function timestamp(value: string): number | null {
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function buildBrokerCostModel(input: BrokerCostModelInput): BrokerCostModel {
  const failures: string[] = []
  const nowMs = timestamp(input.now)
  const ceilings = BROKER_CEILINGS[input.broker]
  if (nowMs === null) failures.push('The cost-model build time is invalid.')
  if (input.version.trim() === '') failures.push('The cost-model version is missing.')
  if (input.symbol !== 'XAUUSD' || input.server !== ceilings.server) {
    failures.push('The broker, server, and Gold symbol identity must match the exact demo allowlist.')
  }

  const bridgeCapturedAt = timestamp(input.bridge.capturedAt)
  const bridgeAgeMs = nowMs === null || bridgeCapturedAt === null ? null : nowMs - bridgeCapturedAt
  if (input.bridge.state !== 'ready' || bridgeAgeMs === null || bridgeAgeMs < 0 || bridgeAgeMs > BRIDGE_MAX_AGE_MS) {
    failures.push('A fresh ready bridge observation from the last two minutes is required.')
  }

  const expectedFingerprint = input.expectedContractFingerprint
  if (expectedFingerprint.trim() === '' || input.bridge.contractFingerprint !== expectedFingerprint) {
    failures.push('The bridge contract fingerprint does not match the configured fingerprint.')
  }

  const recentCandidates = input.spreadSamples.filter((sample) => {
    const capturedAt = timestamp(sample.capturedAt)
    const ageMs = nowMs === null || capturedAt === null ? null : nowMs - capturedAt
    return ageMs !== null && ageMs >= 0 && ageMs <= OBSERVATION_MAX_AGE_MS
  })
  if (recentCandidates.some((sample) => sample.contractFingerprint !== expectedFingerprint)) {
    failures.push('Recent spread evidence contains a mismatched contract fingerprint.')
  }
  if (recentCandidates.some((sample) => !finiteAtLeastZero(sample.spread))) {
    failures.push('Recent spread evidence contains an invalid spread value.')
  }
  const recentSamples = recentCandidates.filter((sample) => {
    return finiteAtLeastZero(sample.spread)
      && sample.contractFingerprint === expectedFingerprint
  })
  if (recentSamples.length < 100) failures.push('At least 100 recent spread samples with the matching contract fingerprint are required.')

  const orderedSampleTimes = recentSamples
    .map((sample) => sample.capturedAt)
    .sort((left, right) => Date.parse(left) - Date.parse(right))
  const observedFrom = orderedSampleTimes[0] ?? input.now
  const observedTo = orderedSampleTimes.at(-1) ?? input.now
  const observedMaxSpread = recentSamples.length === 0
    ? 0
    : Math.max(...recentSamples.map((sample) => sample.spread))

  if (!finiteAtLeastZero(input.configuredMaxSpread)
    || input.configuredMaxSpread === 0
    || input.configuredMaxSpread > ceilings.maxSpread
    || observedMaxSpread > input.configuredMaxSpread) {
    failures.push('The configured spread ceiling is not conservative for the broker observations.')
  }
  if (!finiteAtLeastZero(input.configuredMaxDeviation)
    || input.configuredMaxDeviation === 0
    || input.configuredMaxDeviation > ceilings.maxDeviation) {
    failures.push('The configured deviation ceiling exceeds the immutable broker ceiling.')
  }

  const observedDeal = input.closedDeals.find((deal) => deal.accountMode === 'demo'
    && deal.symbol === 'XAUUSD'
    && deal.closed
    && parseFiniteCost(deal.commission) !== null
    && parseFiniteCost(deal.swap) !== null)
  const commissionObserved = observedDeal !== undefined
  const swapObserved = observedDeal !== undefined
  if (!observedDeal) failures.push('A closed demo Gold deal with parseable commission and swap fields is required.')

  const expiresAt = nowMs === null
    ? input.now
    : new Date(nowMs + OBSERVATION_MAX_AGE_MS).toISOString()
  const evidence = failures.length > 0
    ? failures
    : [
        `Fresh bridge observed at ${input.bridge.capturedAt}.`,
        `${recentSamples.length} recent spread samples matched the contract fingerprint.`,
        'Commission and swap fields were observed on a closed demo Gold deal.',
      ]

  return {
    schemaVersion: 1,
    version: input.version,
    broker: input.broker,
    server: input.server,
    symbol: input.symbol,
    state: failures.length === 0 ? 'canary_ready' : 'blocked',
    observedFrom,
    observedTo,
    expiresAt,
    spreadSampleCount: recentSamples.length,
    observedMaxSpread,
    configuredMaxSpread: input.configuredMaxSpread,
    configuredMaxDeviation: input.configuredMaxDeviation,
    commissionObserved,
    swapObserved,
    contractFingerprint: expectedFingerprint,
    evidence,
  }
}

function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export function serializeBrokerCostModelCsv(model: BrokerCostModel): string {
  const row = [
    model.schemaVersion,
    model.version,
    model.broker,
    model.server,
    model.symbol,
    model.state,
    model.observedFrom,
    model.observedTo,
    model.expiresAt,
    model.spreadSampleCount,
    model.observedMaxSpread,
    model.configuredMaxSpread,
    model.configuredMaxDeviation,
    model.commissionObserved ? 1 : 0,
    model.swapObserved ? 1 : 0,
    model.contractFingerprint,
    csvCell(JSON.stringify(model.evidence)),
  ].join(',')
  return `${COST_MODEL_HEADER}\n${row}\n`
}

async function renameReplacing(temporary: string, destination: string): Promise<void> {
  await rename(temporary, destination)
}

export async function writeBrokerCostModel(root: string, model: BrokerCostModel): Promise<void> {
  const destination = join(root, model.broker, model.symbol, 'cost_model.csv')
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, serializeBrokerCostModelCsv(model), { encoding: 'utf8', flag: 'wx' })
  try {
    await renameReplacing(temporary, destination)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
}
