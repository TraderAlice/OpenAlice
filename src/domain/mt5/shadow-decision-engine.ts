import { createJmbDecisionId, type JmbDecisionDirection, type JmbDecisionRecord, type JmbGateResult } from './decision-record.js'

export interface BuildShadowDecisionInput {
  createdAt: string
  broker: string
  server: string | null
  accountMode: string | null
  symbol: string
  canonicalInstrument: string
  strategyVersion: string
  bridgeState: string
  learningState: string
  latestDirection: 'uptrend' | 'downtrend' | 'flat'
  bid: number | null
  ask: number | null
  spread: number | null
  maxSpread: number
  volume: number
  maxVolume: number
  stopLoss: number | null
  riskAmount: number | null
  maxAllowedRisk: number
  demoCandidateApproved: boolean
}

function gate(gateName: string, state: JmbGateResult['state'], detail: string): JmbGateResult {
  return { gate: gateName, state, detail }
}

function directionFor(latestDirection: BuildShadowDecisionInput['latestDirection']): JmbDecisionDirection {
  if (latestDirection === 'uptrend') return 'buy'
  if (latestDirection === 'downtrend') return 'sell'
  return 'flat'
}

export function buildShadowDecision(input: BuildShadowDecisionInput): JmbDecisionRecord {
  const direction = directionFor(input.latestDirection)
  const gateResults: JmbGateResult[] = [
    gate(
      'account_demo',
      input.accountMode === 'demo' ? 'pass' : 'fail',
      input.accountMode === 'demo' ? 'MT5 reports demo mode' : 'Account mode is not confirmed demo',
    ),
    gate('bridge_ready', input.bridgeState === 'ready' ? 'pass' : 'fail', `Bridge state is ${input.bridgeState}`),
    gate('learning_ready', input.learningState === 'learning' ? 'pass' : 'warn', `Learning state is ${input.learningState}`),
    gate(
      'spread',
      input.spread != null && input.spread <= input.maxSpread ? 'pass' : 'fail',
      input.spread == null ? 'Spread is unavailable' : `${input.spread} <= ${input.maxSpread}`,
    ),
    gate('volume', input.volume > 0 && input.volume <= input.maxVolume ? 'pass' : 'fail', `${input.volume} <= ${input.maxVolume}`),
    gate('stop_loss', input.stopLoss != null ? 'pass' : 'fail', input.stopLoss == null ? 'Stop loss is required' : `Stop loss ${input.stopLoss}`),
    gate(
      'risk_amount',
      input.riskAmount != null && input.riskAmount <= input.maxAllowedRisk ? 'pass' : 'fail',
      input.riskAmount == null ? 'Risk amount unavailable' : `${input.riskAmount} <= ${input.maxAllowedRisk}`,
    ),
    gate(
      'candidate_gate',
      input.demoCandidateApproved ? 'pass' : 'fail',
      input.demoCandidateApproved ? 'Candidate gate approved for shadow review' : 'Broker/symbol is not approved for demo execution',
    ),
    gate('shadow_only', 'pass', 'Plan 2 logs decisions only and submits no orders'),
  ]
  const hardFailure = gateResults.some((item) => item.state === 'fail' && item.gate !== 'candidate_gate')
  const mode = hardFailure ? 'skipped' : input.demoCandidateApproved ? 'shadow' : 'demo_blocked'
  const finalDirection = hardFailure ? 'flat' : direction
  const record: JmbDecisionRecord = {
    schemaVersion: 1,
    decisionId: 'pending',
    createdAt: input.createdAt,
    broker: input.broker,
    server: input.server,
    accountMode: input.accountMode,
    symbol: input.symbol,
    canonicalInstrument: input.canonicalInstrument,
    strategyVersion: input.strategyVersion,
    mode,
    direction: finalDirection,
    reasonCode: hardFailure ? 'gate_blocked' : 'daily_trend_shadow',
    reasonDetail: hardFailure
      ? 'One or more hard gates failed; no order can be requested.'
      : `Completed trend state is ${input.latestDirection}; decision logged for learning only.`,
    entryReferencePrice: finalDirection === 'buy' ? input.ask : finalDirection === 'sell' ? input.bid : null,
    stopLoss: input.stopLoss,
    takeProfit: null,
    volume: input.volume,
    spread: input.spread,
    riskAmount: input.riskAmount,
    maxAllowedRisk: input.maxAllowedRisk,
    gateResults,
    orderTicket: null,
    positionId: null,
    outcome: null,
  }
  return { ...record, decisionId: createJmbDecisionId(record) }
}
