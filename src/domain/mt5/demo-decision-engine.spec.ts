import { describe, expect, it } from 'vitest'

import type { BrokerCostModel } from './broker-cost-model.js'
import type { DemoExecutionPolicy, DemoExecutionPolicySummary } from './demo-execution-policy.js'
import { buildDemoExecutionDecision, type BuildDemoExecutionDecisionInput } from './demo-decision-engine.js'

const policy: DemoExecutionPolicy = {
  schemaVersion: 1,
  policyVersion: 'hfm-canary-v1',
  broker: 'hfmarkets',
  server: 'HFMarketsGlobal-Demo4',
  symbol: 'XAUUSD',
  strategyVersion: 'daily-trend-v1',
  rolloutStage: 'hfm_canary',
  candidateApproved: true,
  completedObservationMaxAgeHours: 72,
  maxSpread: 0.75,
  maxDeviation: 0.5,
  maxRiskAmount: 10,
  maxDailyLoss: 40,
  maxDailyLosingTrades: 4,
  maxVolume: 0.01,
  magicNumber: 880101,
}

const costModel: BrokerCostModel = {
  schemaVersion: 1,
  version: 'hfm-cost-0900',
  broker: 'hfmarkets',
  server: 'HFMarketsGlobal-Demo4',
  symbol: 'XAUUSD',
  state: 'canary_ready',
  observedFrom: '2026-07-12T10:00:00.000Z',
  observedTo: '2026-07-13T09:59:00.000Z',
  expiresAt: '2026-07-14T10:00:00.000Z',
  spreadSampleCount: 100,
  observedMaxSpread: 0.3,
  configuredMaxSpread: 0.75,
  configuredMaxDeviation: 0.5,
  commissionObserved: true,
  swapObserved: true,
  contractFingerprint: 'contract-fingerprint',
  evidence: ['complete'],
}

function readyInput(overrides: Partial<BuildDemoExecutionDecisionInput> = {}): BuildDemoExecutionDecisionInput {
  return {
    createdAt: '2026-07-13T10:00:00.000Z',
    leaseIssuedAt: '2026-07-13T10:00:00.000Z',
    leaseExpiresAt: '2026-07-13T10:10:00.000Z',
    broker: 'hfmarkets',
    server: 'HFMarketsGlobal-Demo4',
    symbol: 'XAUUSD',
    bridge: {
      state: 'ready',
      broker: 'hfmarkets',
      server: 'HFMarketsGlobal-Demo4',
      symbol: 'XAUUSD',
    },
    completedObservation: {
      state: 'ready',
      detail: 'Fresh completed D1 evidence.',
      observation: {
        asOf: '2026-07-12',
        direction: 'uptrend',
        lookbackReturn: 0.02,
        lookbackDays: 120,
        latestClose: 2400,
        referenceClose: 2352.94,
      },
    },
    policy: { state: 'ready', detail: 'Policy approved.', policy },
    costModel,
    learning: {
      state: 'learning',
      accountMode: 'demo',
      server: 'HFMarketsGlobal-Demo4',
    },
    quote: { bid: 2399.9, ask: 2400.1, spread: 0.2 },
    stopLoss: 2392.1,
    ...overrides,
  }
}

describe('demo execution decision engine', () => {
  it('creates an executable HFM Gold lease when every hard gate passes', () => {
    const result = buildDemoExecutionDecision(readyInput())
    expect(result.state).toBe('ready')
    expect(result.decision).toMatchObject({
      broker: 'hfmarkets',
      symbol: 'XAUUSD',
      direction: 'buy',
      entryReferencePrice: 2400.1,
      stopLoss: 2392.1,
      volume: 0.01,
      maxRiskAmount: 10,
    })
    expect(result.decision?.gateResults.map((gate) => gate.name)).toEqual([
      'bridge',
      'completed_observation',
      'candidate_policy',
      'cost_model',
      'learning',
      'quote',
      'spread',
      'direction',
      'stop_loss',
    ])
    expect(result.decision?.gateResults.every((gate) => gate.state === 'pass')).toBe(true)
  })

  it('blocks IC Gold while policy remains at the HFM canary stage', () => {
    const icPolicy = {
      ...policy,
      policyVersion: 'ic-hfm-stage-v1',
      broker: 'icmarkets',
      server: 'ICMarketsSC-Demo',
      rolloutStage: 'hfm_canary',
      maxSpread: 0.3,
      maxDeviation: 0.3,
      magicNumber: 880201,
    } as DemoExecutionPolicy
    const policySummary: DemoExecutionPolicySummary = {
      state: 'blocked',
      detail: 'The rollout stage does not authorize this broker.',
      policy: icPolicy,
    }
    const result = buildDemoExecutionDecision(readyInput({
      broker: 'icmarkets',
      server: 'ICMarketsSC-Demo',
      bridge: { state: 'ready', broker: 'icmarkets', server: 'ICMarketsSC-Demo', symbol: 'XAUUSD' },
      policy: policySummary,
      costModel: { ...costModel, version: 'ic-cost-0900', broker: 'icmarkets', server: 'ICMarketsSC-Demo', configuredMaxSpread: 0.3, configuredMaxDeviation: 0.3 },
      learning: { state: 'learning', accountMode: 'demo', server: 'ICMarketsSC-Demo' },
    }))
    expect(result.state).toBe('blocked')
    expect(result.decision?.gateResults).toContainEqual(expect.objectContaining({ name: 'candidate_policy', state: 'block' }))
  })

  it('blocks EURUSD without creating a persistable execution decision', () => {
    const result = buildDemoExecutionDecision(readyInput({
      symbol: 'EURUSD',
      bridge: { state: 'ready', broker: 'hfmarkets', server: 'HFMarketsGlobal-Demo4', symbol: 'EURUSD' },
    }))
    expect(result).toMatchObject({ state: 'blocked', decision: null })
    expect(result.detail).toMatch(/EURUSD.*shadow/i)
  })

  it.each([
    ['stale completed observation', { completedObservation: { ...readyInput().completedObservation, state: 'stale' } }, 'completed_observation'],
    ['blocked cost model', { costModel: { ...costModel, state: 'blocked' } }, 'cost_model'],
    ['missing stop', { stopLoss: null }, 'stop_loss'],
    ['spread breach', { quote: { bid: 2399, ask: 2400, spread: 1 } }, 'spread'],
    ['flat direction', { completedObservation: { ...readyInput().completedObservation, observation: { ...readyInput().completedObservation.observation!, direction: 'flat' } } }, 'direction'],
  ] as const)('never returns ready for %s', (_name, override, blockedGate) => {
    const result = buildDemoExecutionDecision(readyInput(override as Partial<BuildDemoExecutionDecisionInput>))
    expect(result.state).toBe('blocked')
    expect(result.decision?.gateResults).toContainEqual(expect.objectContaining({ name: blockedGate, state: 'block' }))
  })
})
