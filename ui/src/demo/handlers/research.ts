import { http, HttpResponse } from 'msw'
import type { JmbExecutionStatusSummary, ResearchDashboard, ResearchInstrument } from '../../api/research'

const DEMO_NOW = '2026-07-13T09:10:00.000Z'

function execution(
  broker: 'hfmarkets' | 'icmarkets',
  symbol: 'XAUUSD' | 'EURUSD',
  state: JmbExecutionStatusSummary['state'],
): JmbExecutionStatusSummary {
  const blocked = symbol === 'EURUSD'
  const protectedFill = state === 'filled_protected'
  return {
    state,
    label: blocked ? 'DEMO BLOCKED' : protectedFill ? 'DEMO ENABLED' : 'CANARY READY',
    detail: blocked
      ? 'EURUSD remains shadow-only and is not eligible for Plan 3 demo execution.'
      : protectedFill
        ? 'Broker confirms the EA-owned demo position and protective stop.'
        : 'The broker-local EA reports that canary gates are ready for operator review.',
    capturedAt: DEMO_NOW,
    broker,
    server: broker === 'hfmarkets' ? 'HFMarketsGlobal-Demo4' : 'ICMarketsSC-Demo',
    accountMode: 'demo',
    symbol,
    rolloutStage: broker === 'hfmarkets' ? 'hfm_canary' : 'status_only',
    executionEnabled: protectedFill,
    killSwitch: !protectedFill,
    decisionId: protectedFill ? 'demo-decision-7f31' : null,
    observationId: protectedFill ? 'demo-observation-2026-07-12' : null,
    latestEvent: protectedFill ? {
      id: 'demo-event-a92c',
      type: 'fill_confirmed',
      at: DEMO_NOW,
      resultCode: '10009',
      detail: 'Demo request completed; stop confirmed.',
    } : null,
    stopProtectionConfirmed: protectedFill,
    position: protectedFill ? { direction: 'sell', volume: 0.01, openPrice: 3334.25, stopLoss: 3344.25, id: 'demo-position-4d18' } : null,
    reconciliationState: protectedFill ? 'reconciled' : 'not_required',
    dailyLossCount: 1,
    dailyRealizedLoss: -8.75,
    blockingGate: blocked ? 'instrument_allowlist' : null,
    nextSafeAction: blocked ? 'Continue read-only shadow observation; no execution action is available.' : 'Monitor broker-side protection and reconciliation.',
  }
}

function instrument(
  broker: 'hfmarkets' | 'icmarkets',
  symbol: 'XAUUSDb' | 'EURUSDb' | 'XAUUSD' | 'EURUSD',
  localSymbol: 'XAUUSD' | 'EURUSD',
  executionStatus: JmbExecutionStatusSummary,
): ResearchInstrument {
  return {
    broker,
    symbol,
    ...(symbol !== localSymbol ? { bridgeSymbol: localSymbol } : {}),
    label: localSymbol === 'XAUUSD' ? 'Gold / USD' : 'Euro / USD',
    export: { available: false, files: 0, firstFile: null, lastFile: null, totalBytes: 0, lastUpdated: null },
    quality: { label: 'Awaiting export', tone: 'muted', inspectedFiles: 0, likelyM1Files: 0, fallbackFiles: 0, badRows: 0, duplicateRows: 0 },
    report: null,
    walkForward: null,
    bridge: {
      state: 'ready',
      label: 'Demo bridge connected',
      detail: 'Read-only telemetry is current. This bridge has no order-submission code.',
      broker,
      symbol: localSymbol,
      server: broker === 'hfmarkets' ? 'HFMarketsGlobal-Demo4' : 'ICMarketsSC-Demo',
      capturedAt: DEMO_NOW,
      lastUpdated: DEMO_NOW,
      bid: localSymbol === 'XAUUSD' ? 3334.2 : 1.14267,
      ask: localSymbol === 'XAUUSD' ? 3334.3 : 1.14284,
      spread: localSymbol === 'XAUUSD' ? 0.1 : 0.00017,
      openPositions: executionStatus.position ? 1 : 0,
      openOrders: 0,
    },
    learning: {
      state: 'no_data', label: 'Awaiting trade history', detail: 'No demo trade history is included in this static preview.',
      broker, symbol: localSymbol, accountMode: 'demo', server: executionStatus.server, lastDealTime: null, lastUpdated: null,
      totalDeals: 0, manualDeals: 0, eaDeals: 0, otherDeals: 0, unknownDeals: 0, netProfit: 0,
    },
    decision: {
      state: localSymbol === 'EURUSD' ? 'demo_blocked' : 'shadow',
      label: localSymbol === 'EURUSD' ? 'Demo blocked by gates' : 'Shadow decision logged',
      detail: 'Static demo decision evidence for the read-only Research Desk preview.',
      broker,
      symbol: localSymbol,
      lastUpdated: DEMO_NOW,
      decision: null,
    },
    execution: executionStatus,
    evidence: { label: 'Waiting for baseline', tone: 'muted', score: 0 },
  }
}

const dashboard: ResearchDashboard = {
  asOf: DEMO_NOW,
  mode: 'research_only',
  tradingEnabled: false,
  summary: {
    exportRoot: 'Local MT5 demo history',
    tradeLedgerRoot: 'Local MT5 demo trade ledger',
    decisionRoot: 'Local JMB decision log',
    executionRoot: 'Local MT5 broker execution status',
    instrumentsWithData: 0,
    completedBaselines: 0,
    completedWalkForwards: 0,
    readyDemoBridges: 4,
    learningInstruments: 0,
    shadowDecisions: 4,
    validatedInstruments: 0,
    hfmReady: false,
    experimentRuns: 0,
  },
  stages: [
    { key: 'data', label: 'Broker data inspected', state: 'waiting', detail: 'Static preview: local export evidence is not included.' },
    { key: 'baseline', label: 'Baseline trend study', state: 'waiting', detail: 'Holdout results remain separate from training.' },
    { key: 'walkforward', label: 'Rolling walk-forward', state: 'waiting', detail: 'Required before a candidate can advance.' },
    { key: 'costs', label: 'Broker cost model', state: 'next', detail: 'Broker-local costs require operator review.' },
    { key: 'bridge', label: 'MT5 demo bridge', state: 'complete', detail: 'Static read-only demo telemetry is shown.' },
    { key: 'learning', label: 'Trade-history learning', state: 'waiting', detail: 'No trade history is included in this preview.' },
    { key: 'shadow', label: 'JMB shadow decisions', state: 'complete', detail: 'EURUSD remains shadow-only.' },
    { key: 'demo', label: 'Demo forward test', state: 'next', detail: 'Broker-local demo lifecycle status is visible; Research Desk remains read-only.' },
  ],
  instruments: [
    instrument('hfmarkets', 'XAUUSDb', 'XAUUSD', execution('hfmarkets', 'XAUUSD', 'filled_protected')),
    instrument('hfmarkets', 'EURUSDb', 'EURUSD', execution('hfmarkets', 'EURUSD', 'demo_blocked')),
    instrument('icmarkets', 'XAUUSD', 'XAUUSD', execution('icmarkets', 'XAUUSD', 'ready')),
    instrument('icmarkets', 'EURUSD', 'EURUSD', execution('icmarkets', 'EURUSD', 'demo_blocked')),
  ],
  experiments: [],
  news: [],
  disclaimer: 'Demo status is operational evidence, not live approval, a probability of profit, or a trade recommendation.',
}

export const researchHandlers = [
  http.get('/api/research', () => HttpResponse.json<ResearchDashboard>(dashboard)),
]
