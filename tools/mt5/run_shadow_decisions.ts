import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { appendJmbDecisionRecord, writeLatestJmbDecision } from '../../src/domain/mt5/decision-record.js'
import { readMt5ReadOnlyBridge } from '../../src/domain/mt5/read-only-bridge.js'
import { buildShadowDecision } from '../../src/domain/mt5/shadow-decision-engine.js'
import { summarizeMt5TradeLedger } from '../../src/domain/mt5/trade-ledger.js'

type TrendReport = {
  latest_observation?: { direction: 'uptrend' | 'downtrend' | 'flat' }
}

const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming')
const commonFiles = join(appData, 'MetaQuotes', 'Terminal', 'Common', 'Files')
const bridgeRoot = process.env['OPENALICE_MT5_BRIDGE_ROOT'] ?? join(commonFiles, 'OpenAliceMt5BridgeV1')
const tradeLedgerRoot = process.env['OPENALICE_MT5_TRADE_LEDGER_ROOT'] ?? join(commonFiles, 'OpenAliceMt5TradeLedgerV1')
const decisionRoot = process.env['OPENALICE_MT5_DECISION_ROOT'] ?? join(commonFiles, 'OpenAliceMt5DecisionLogV1')
const researchRoot = process.env['OPENALICE_RESEARCH_ARTIFACTS_DIR'] ?? join(homedir(), '.openalice', 'data', 'research')

const instruments = [
  {
    broker: 'hfmarkets',
    symbol: 'XAUUSD',
    report: 'xauusd-trend-baseline.json',
    canonical: 'Gold / USD',
    demoCandidateApproved: true,
    maxSpread: 0.75,
    stopDistance: 8,
    maxRisk: 1,
  },
  {
    broker: 'hfmarkets',
    symbol: 'EURUSD',
    report: 'eurusd-trend-baseline.json',
    canonical: 'Euro / USD',
    demoCandidateApproved: false,
    maxSpread: 0.00025,
    stopDistance: 0.002,
    maxRisk: 1,
  },
  {
    broker: 'icmarkets',
    symbol: 'XAUUSD',
    report: 'icmarkets-xauusd-trend-baseline.json',
    canonical: 'Gold / USD',
    demoCandidateApproved: true,
    maxSpread: 0.3,
    stopDistance: 8,
    maxRisk: 1,
  },
  {
    broker: 'icmarkets',
    symbol: 'EURUSD',
    report: 'icmarkets-eurusd-trend-baseline.json',
    canonical: 'Euro / USD',
    demoCandidateApproved: false,
    maxSpread: 0.00015,
    stopDistance: 0.002,
    maxRisk: 1,
  },
] as const

async function readTrendDirection(fileName: string): Promise<'uptrend' | 'downtrend' | 'flat'> {
  try {
    const report = JSON.parse(await readFile(join(researchRoot, fileName), 'utf8')) as TrendReport
    return report.latest_observation?.direction ?? 'flat'
  } catch {
    return 'flat'
  }
}

for (const instrument of instruments) {
  const [bridge, learning, latestDirection] = await Promise.all([
    readMt5ReadOnlyBridge(bridgeRoot, instrument.broker, instrument.symbol),
    summarizeMt5TradeLedger(tradeLedgerRoot, instrument.broker, instrument.symbol),
    readTrendDirection(instrument.report),
  ])
  const referencePrice = latestDirection === 'downtrend' ? bridge.bid : bridge.ask
  const stopLoss =
    referencePrice == null
      ? null
      : latestDirection === 'downtrend'
        ? Number((referencePrice + instrument.stopDistance).toFixed(instrument.symbol === 'XAUUSD' ? 2 : 5))
        : latestDirection === 'uptrend'
          ? Number((referencePrice - instrument.stopDistance).toFixed(instrument.symbol === 'XAUUSD' ? 2 : 5))
          : null
  const decision = buildShadowDecision({
    createdAt: new Date().toISOString(),
    broker: instrument.broker,
    server: bridge.server,
    accountMode: bridge.state === 'ready' ? 'demo' : null,
    symbol: instrument.symbol,
    canonicalInstrument: instrument.canonical,
    strategyVersion: 'daily-trend-v1',
    bridgeState: bridge.state,
    learningState: learning.state,
    latestDirection,
    bid: bridge.bid,
    ask: bridge.ask,
    spread: bridge.spread,
    maxSpread: instrument.maxSpread,
    volume: 0.01,
    maxVolume: 0.01,
    stopLoss,
    riskAmount: instrument.maxRisk,
    maxAllowedRisk: instrument.maxRisk,
    demoCandidateApproved: instrument.demoCandidateApproved,
  })

  await appendJmbDecisionRecord(decisionRoot, decision)
  await writeLatestJmbDecision(decisionRoot, decision)
  console.log(`${decision.broker} ${decision.symbol}: ${decision.mode} ${decision.direction} ${decision.reasonCode}`)
}
