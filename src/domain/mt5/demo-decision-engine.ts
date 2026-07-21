import type { BrokerCostModel } from './broker-cost-model.js'
import type { CompletedD1State, CompletedTrendObservation } from './completed-d1.js'
import type { DemoExecutionPolicySummary } from './demo-execution-policy.js'
import {
  createExecutionDecisionId,
  createObservationId,
  type JmbExecutionDecision,
  type JmbGateResult,
} from './execution-decision.js'
import type { Mt5BridgeState } from './read-only-bridge.js'
import type { Mt5TradeLedgerState } from './trade-ledger.js'

type JmbBroker = JmbExecutionDecision['broker']
type JmbServer = JmbExecutionDecision['server']

export interface BuildDemoExecutionDecisionInput {
  createdAt: string
  leaseIssuedAt: string
  leaseExpiresAt: string
  broker: JmbBroker
  server: JmbServer
  symbol: 'XAUUSD' | 'EURUSD'
  bridge: {
    state: Mt5BridgeState
    broker: string
    server: string | null
    symbol: string
  }
  completedObservation: {
    state: CompletedD1State
    detail: string
    observation: CompletedTrendObservation | null
  }
  policy: DemoExecutionPolicySummary
  costModel: BrokerCostModel
  learning: {
    state: Mt5TradeLedgerState
    accountMode: string | null
    server: string | null
  }
  quote: {
    bid: number | null
    ask: number | null
    spread: number | null
  }
  stopLoss: number | null
}

export interface DemoExecutionDecisionBuildResult {
  state: 'ready' | 'blocked'
  decision: JmbExecutionDecision | null
  detail: string
}

function gate(name: string, passed: boolean, passDetail: string, blockDetail: string): JmbGateResult {
  return { name, state: passed ? 'pass' : 'block', detail: passed ? passDetail : blockDetail }
}

function finitePositive(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0
}

function finiteAtLeastZero(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0
}

function expectedDirection(observation: CompletedTrendObservation): JmbExecutionDecision['direction'] {
  return observation.direction === 'uptrend' ? 'buy' : observation.direction === 'downtrend' ? 'sell' : 'flat'
}

export function buildDemoExecutionDecision(input: BuildDemoExecutionDecisionInput): DemoExecutionDecisionBuildResult {
  if (input.symbol === 'EURUSD') {
    return {
      state: 'blocked',
      decision: null,
      detail: 'EURUSD remains shadow-only and cannot produce an execution-decision lease.',
    }
  }

  const observation = input.completedObservation.observation
  const policy = input.policy.policy
  if (observation === null || policy === null) {
    return {
      state: 'blocked',
      decision: null,
      detail: observation === null
        ? `No persistable Gold decision was built: ${input.completedObservation.detail}`
        : `No persistable Gold decision was built: ${input.policy.detail}`,
    }
  }

  const direction = expectedDirection(observation)
  const entryReferencePrice = direction === 'buy' ? input.quote.ask : direction === 'sell' ? input.quote.bid : null
  const bridgeReady = input.bridge.state === 'ready'
    && input.bridge.broker === input.broker
    && input.bridge.server === input.server
    && input.bridge.symbol === 'XAUUSD'
  const completedReady = input.completedObservation.state === 'ready'
  const policyReady = input.policy.state === 'ready'
    && policy.broker === input.broker
    && policy.server === input.server
    && policy.symbol === 'XAUUSD'
    && policy.strategyVersion === 'daily-trend-v1'
    && policy.candidateApproved
  const costReady = input.costModel.state === 'canary_ready'
    && input.costModel.broker === input.broker
    && input.costModel.server === input.server
    && input.costModel.symbol === 'XAUUSD'
    && Date.parse(input.costModel.expiresAt) >= Date.parse(input.leaseIssuedAt)
  const learningReady = input.learning.state === 'learning'
    && input.learning.accountMode === 'demo'
    && input.learning.server === input.server
  const quoteReady = finitePositive(input.quote.bid)
    && finitePositive(input.quote.ask)
    && input.quote.ask >= input.quote.bid
    && finiteAtLeastZero(input.quote.spread)
  const spreadReady = finiteAtLeastZero(input.quote.spread) && input.quote.spread <= policy.maxSpread
  const directionReady = direction !== 'flat'
  const stopReady = finitePositive(input.stopLoss)
    && finitePositive(entryReferencePrice)
    && (direction === 'buy' ? input.stopLoss < entryReferencePrice : direction === 'sell' && input.stopLoss > entryReferencePrice)

  const gateResults: JmbGateResult[] = [
    gate('bridge', bridgeReady, 'The read-only demo bridge identity is current.', 'The read-only demo bridge is not ready or its identity does not match.'),
    gate('completed_observation', completedReady, input.completedObservation.detail, input.completedObservation.detail),
    gate('candidate_policy', policyReady, 'The operator policy approves this broker at the current rollout stage.', input.policy.detail),
    gate('cost_model', costReady, 'The observed broker cost model is canary-ready.', 'The observed broker cost model is blocked, expired, or mismatched.'),
    gate('learning', learningReady, 'Fresh demo trade history is available for learning.', 'Demo trade history is missing, stale, blocked, or mismatched.'),
    gate('quote', quoteReady, 'The broker quote is finite and internally ordered.', 'The broker quote is missing or invalid.'),
    gate('spread', spreadReady, 'The current spread is within the operator policy ceiling.', 'The current spread exceeds the operator policy ceiling.'),
    gate('direction', directionReady, 'The completed D1 observation has an actionable trend.', 'A flat completed D1 observation cannot produce an entry.'),
    gate('stop_loss', stopReady, 'The stop loss is present on the protective side of the quote.', 'The stop loss is missing, invalid, or on the wrong side of the quote.'),
  ]

  const observationIdentity = {
    broker: input.broker,
    symbol: 'XAUUSD' as const,
    strategyVersion: 'daily-trend-v1' as const,
    observationAsOf: observation.asOf,
  }
  const observationId = createObservationId(observationIdentity)
  const decision: JmbExecutionDecision = {
    schemaVersion: 1,
    decisionId: createExecutionDecisionId({ observationId }),
    observationId,
    observationAsOf: observation.asOf,
    createdAt: input.createdAt,
    leaseIssuedAt: input.leaseIssuedAt,
    leaseExpiresAt: input.leaseExpiresAt,
    broker: input.broker,
    server: input.server,
    accountMode: 'demo',
    symbol: 'XAUUSD',
    strategyVersion: 'daily-trend-v1',
    direction,
    entryReferencePrice: finitePositive(entryReferencePrice) ? entryReferencePrice : null,
    volume: 0.01,
    stopLoss: input.stopLoss,
    maxRiskAmount: policy.maxRiskAmount,
    candidatePolicyVersion: policy.policyVersion,
    costModelVersion: input.costModel.version,
    gateResults,
  }
  const blockingGate = gateResults.find((result) => result.state === 'block')
  return blockingGate === undefined
    ? { state: 'ready', decision, detail: 'All application-side demo execution gates passed.' }
    : { state: 'blocked', decision, detail: `${blockingGate.name}: ${blockingGate.detail}` }
}
