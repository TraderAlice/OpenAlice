import { describe, expect, it } from 'vitest'
import { buildShadowDecision } from './shadow-decision-engine.js'

const baseInput = {
  createdAt: '2026-07-13T10:00:00.000Z',
  broker: 'hfmarkets',
  server: 'HFMarketsGlobal-Demo4',
  accountMode: 'demo',
  symbol: 'XAUUSD',
  canonicalInstrument: 'Gold / USD',
  strategyVersion: 'daily-trend-v1',
  bridgeState: 'ready',
  learningState: 'learning',
  latestDirection: 'uptrend',
  bid: 2410,
  ask: 2410.36,
  spread: 0.36,
  maxSpread: 0.75,
  volume: 0.01,
  maxVolume: 0.01,
  stopLoss: 2402,
  riskAmount: 0.8,
  maxAllowedRisk: 1,
  demoCandidateApproved: true,
} as const

describe('buildShadowDecision', () => {
  it('logs a Gold buy shadow decision when gates pass', () => {
    const decision = buildShadowDecision(baseInput)

    expect(decision.mode).toBe('shadow')
    expect(decision.direction).toBe('buy')
    expect(decision.reasonCode).toBe('daily_trend_shadow')
    expect(decision.gateResults.every((gate) => gate.state === 'pass')).toBe(true)
  })

  it('keeps EURUSD demo-blocked when its candidate gate is not approved', () => {
    const decision = buildShadowDecision({
      ...baseInput,
      symbol: 'EURUSD',
      canonicalInstrument: 'Euro / USD',
      demoCandidateApproved: false,
    })

    expect(decision.mode).toBe('demo_blocked')
    expect(decision.direction).toBe('buy')
    expect(decision.gateResults.some((gate) => gate.gate === 'candidate_gate' && gate.state === 'fail')).toBe(true)
  })

  it('skips flat when bridge is stale', () => {
    const decision = buildShadowDecision({ ...baseInput, bridgeState: 'stale' })

    expect(decision.mode).toBe('skipped')
    expect(decision.direction).toBe('flat')
    expect(decision.reasonCode).toBe('gate_blocked')
  })

  it('blocks when stop loss is missing', () => {
    const decision = buildShadowDecision({ ...baseInput, stopLoss: null })

    expect(decision.mode).toBe('skipped')
    expect(decision.direction).toBe('flat')
    expect(decision.gateResults.some((gate) => gate.gate === 'stop_loss' && gate.state === 'fail')).toBe(true)
  })
})
