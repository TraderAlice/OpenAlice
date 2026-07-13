import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type DemoRolloutStage = 'status_only' | 'hfm_canary' | 'ic_canary' | 'both_demo'

export interface DemoExecutionPolicy {
  schemaVersion: 1
  policyVersion: string
  broker: 'hfmarkets' | 'icmarkets'
  server: 'HFMarketsGlobal-Demo4' | 'ICMarketsSC-Demo'
  symbol: 'XAUUSD'
  strategyVersion: 'daily-trend-v1'
  rolloutStage: DemoRolloutStage
  candidateApproved: boolean
  completedObservationMaxAgeHours: number
  maxSpread: number
  maxDeviation: number
  maxRiskAmount: number
  maxDailyLoss: number
  maxDailyLosingTrades: number
  maxVolume: number
  magicNumber: 880101 | 880201
}

export interface DemoExecutionPolicySummary {
  state: 'ready' | 'blocked' | 'missing' | 'malformed'
  detail: string
  policy: DemoExecutionPolicy | null
}

const POLICY_HEADER = 'schema_version,policy_version,broker,server,symbol,strategy_version,rollout_stage,candidate_approved,completed_observation_max_age_hours,max_spread,max_deviation,max_risk_amount,max_daily_loss,max_daily_losing_trades,max_volume,magic_number'

const BROKER_RULES = {
  hfmarkets: {
    server: 'HFMarketsGlobal-Demo4',
    magicNumber: 880101,
    maxSpread: 0.75,
    maxDeviation: 0.5,
    stages: ['hfm_canary', 'both_demo'],
  },
  icmarkets: {
    server: 'ICMarketsSC-Demo',
    magicNumber: 880201,
    maxSpread: 0.3,
    maxDeviation: 0.3,
    stages: ['ic_canary', 'both_demo'],
  },
} as const

const SHARED_CEILINGS = {
  completedObservationMaxAgeHours: 72,
  maxRiskAmount: 10,
  maxDailyLoss: 40,
  maxDailyLosingTrades: 4,
  maxVolume: 0.01,
} as const

function blocked(detail: string, policy: DemoExecutionPolicy | null = null): DemoExecutionPolicySummary {
  return { state: 'blocked', detail, policy }
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

export function validateDemoExecutionPolicy(input: unknown): DemoExecutionPolicySummary {
  if (typeof input !== 'object' || input === null) return blocked('The demo execution policy is not an object.')
  const candidate = input as Record<string, unknown>
  const broker = candidate['broker']
  if (broker !== 'hfmarkets' && broker !== 'icmarkets') return blocked('The policy broker is not allowlisted.')
  const rules = BROKER_RULES[broker]

  const exactIdentity = candidate['schemaVersion'] === 1
    && candidate['policyVersion'] !== ''
    && typeof candidate['policyVersion'] === 'string'
    && candidate['server'] === rules.server
    && candidate['symbol'] === 'XAUUSD'
    && candidate['strategyVersion'] === 'daily-trend-v1'
    && candidate['magicNumber'] === rules.magicNumber
  if (!exactIdentity) return blocked('The policy identity does not match the immutable demo allowlist.')

  const rolloutStage = candidate['rolloutStage']
  if (rolloutStage === 'status_only') return blocked('The status-only rollout stage is never executable.', input as DemoExecutionPolicy)
  if (!rules.stages.some((stage) => stage === rolloutStage)) {
    return blocked('The rollout stage does not authorize this broker.', input as DemoExecutionPolicy)
  }
  if (candidate['candidateApproved'] !== true) {
    return blocked('The demo candidate is not operator-approved.', input as DemoExecutionPolicy)
  }

  const limits = {
    completedObservationMaxAgeHours: SHARED_CEILINGS.completedObservationMaxAgeHours,
    maxSpread: rules.maxSpread,
    maxDeviation: rules.maxDeviation,
    maxRiskAmount: SHARED_CEILINGS.maxRiskAmount,
    maxDailyLoss: SHARED_CEILINGS.maxDailyLoss,
    maxDailyLosingTrades: SHARED_CEILINGS.maxDailyLosingTrades,
    maxVolume: SHARED_CEILINGS.maxVolume,
  }
  for (const [field, ceiling] of Object.entries(limits)) {
    const value = candidate[field]
    if (!isPositiveFinite(value) || value > ceiling) {
      return blocked(`The policy ${field} exceeds or invalidates its immutable hard ceiling.`, input as DemoExecutionPolicy)
    }
  }
  if (!Number.isInteger(candidate['maxDailyLosingTrades'])) {
    return blocked('The policy maxDailyLosingTrades must be a positive integer.', input as DemoExecutionPolicy)
  }

  return {
    state: 'ready',
    detail: 'The operator policy matches the immutable demo execution ceilings.',
    policy: input as DemoExecutionPolicy,
  }
}

function parseNumber(value: string | undefined, field: string): number {
  if (value === undefined || value.trim() === '') throw new Error(`Policy ${field} is empty.`)
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Policy ${field} must be finite.`)
  return parsed
}

function parseDemoExecutionPolicyCsv(text: string): DemoExecutionPolicy {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length !== 2 || lines[0] !== POLICY_HEADER) throw new Error('The policy CSV header or row count is invalid.')
  const values = lines[1]!.split(',')
  if (values.length !== 16) throw new Error('The policy CSV row must contain exactly 16 columns.')
  if (values.some((value) => value.trim() !== value)) throw new Error('The policy CSV contains unexpected whitespace.')
  if (values[7] !== '0' && values[7] !== '1') throw new Error('Policy candidate_approved must be 0 or 1.')

  return {
    schemaVersion: parseNumber(values[0], 'schema_version') as 1,
    policyVersion: values[1]!,
    broker: values[2] as DemoExecutionPolicy['broker'],
    server: values[3] as DemoExecutionPolicy['server'],
    symbol: values[4] as 'XAUUSD',
    strategyVersion: values[5] as 'daily-trend-v1',
    rolloutStage: values[6] as DemoRolloutStage,
    candidateApproved: values[7] === '1',
    completedObservationMaxAgeHours: parseNumber(values[8], 'completed_observation_max_age_hours'),
    maxSpread: parseNumber(values[9], 'max_spread'),
    maxDeviation: parseNumber(values[10], 'max_deviation'),
    maxRiskAmount: parseNumber(values[11], 'max_risk_amount'),
    maxDailyLoss: parseNumber(values[12], 'max_daily_loss'),
    maxDailyLosingTrades: parseNumber(values[13], 'max_daily_losing_trades'),
    maxVolume: parseNumber(values[14], 'max_volume'),
    magicNumber: parseNumber(values[15], 'magic_number') as DemoExecutionPolicy['magicNumber'],
  }
}

export async function readDemoExecutionPolicy(root: string, broker: string, symbol: string): Promise<DemoExecutionPolicySummary> {
  let text: string
  try {
    text = await readFile(join(root, broker, symbol, 'policy.csv'), 'utf8')
  } catch {
    return { state: 'missing', detail: 'The operator-managed demo execution policy is missing or unreadable.', policy: null }
  }

  let policy: DemoExecutionPolicy
  try {
    policy = parseDemoExecutionPolicyCsv(text)
  } catch (error) {
    return {
      state: 'malformed',
      detail: error instanceof Error ? error.message : 'The demo execution policy is malformed.',
      policy: null,
    }
  }

  if (policy.broker !== broker || policy.symbol !== symbol) {
    return blocked('The policy identity does not match the requested broker and symbol.', policy)
  }
  return validateDemoExecutionPolicy(policy)
}
