import { readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import { dataPath } from '../../core/paths.js'
import { summarizeLatestJmbDecision } from '../../domain/mt5/decision-record.js'
import {
  createDemoBlockedExecutionSummary,
  summarizeLatestJmbExecutionStatus,
  type JmbExecutionBroker,
  type JmbExecutionSymbol,
} from '../../domain/mt5/execution-status.js'
import { readMt5ReadOnlyBridge } from '../../domain/mt5/read-only-bridge.js'
import { summarizeMt5TradeLedger } from '../../domain/mt5/trade-ledger.js'
import type { EngineContext } from '../../core/types.js'

type TrendReport = {
  symbol: string
  data: { daily_bars: number; first_day: string; last_day: string }
  selected_on_training_sharpe: { lookback_days: number; sharpe: number | null; max_drawdown: number | null }
  untouched_holdout: { total_return: number | null; sharpe: number | null; max_drawdown: number | null }
  latest_observation?: { as_of: string; direction: 'uptrend' | 'downtrend' | 'flat'; lookback_return: number; lookback_days: number }
}

type WalkForwardReport = {
  method: { training_months: number; test_months: number }
  windows: Array<unknown>
  out_of_sample_aggregate: { total_return: number | null; sharpe: number | null; max_drawdown: number | null }
}

type ExperimentScenario = {
  id: string
  lookback_set: string
  lookbacks: number[]
  one_way_cost_bps: number
  unseen_windows: number
  out_of_sample: { total_return: number | null; sharpe: number | null; max_drawdown: number | null; win_rate: number | null }
  review_flags: string[]
}

type ExperimentRun = {
  id: string
  created_at: string
  broker: string
  symbol: string
  data: { first_eligible_day: string; last_day: string; daily_bars: number; effective_train_start: string }
  method: { training_months: number; test_months: number; drawdown_review_alert: number }
  scenarios: ExperimentScenario[]
  warning: string
}

type ExperimentLedger = { runs: ExperimentRun[] }

type ValidationFile = {
  file: string
  rows: number
  bad_rows: number
  duplicates: number
  gaps_over_three_minutes: number
  likely_m1: boolean
}

type ValidationReport = {
  files: ValidationFile[]
}

type DataQuality = {
  label: string
  tone: 'muted' | 'green' | 'amber' | 'red'
  inspectedFiles: number
  likelyM1Files: number
  fallbackFiles: number
  badRows: number
  duplicateRows: number
}

const ARTIFACTS_DIR = process.env['OPENALICE_RESEARCH_ARTIFACTS_DIR'] ?? dataPath('research')
const LEGACY_ARTIFACTS_DIR = join(process.cwd(), '.codex-run')
const MT5_EXPORT_ROOT = process.env['OPENALICE_MT5_EXPORT_ROOT'] ?? join(
  process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'),
  'MetaQuotes', 'Terminal', 'Common', 'Files', 'OpenAliceMt5HistoryV2',
)
const MT5_BRIDGE_ROOT = process.env['OPENALICE_MT5_BRIDGE_ROOT'] ?? join(
  process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'),
  'MetaQuotes', 'Terminal', 'Common', 'Files', 'OpenAliceMt5BridgeV1',
)
const MT5_TRADE_LEDGER_ROOT = process.env['OPENALICE_MT5_TRADE_LEDGER_ROOT'] ?? join(
  process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'),
  'MetaQuotes', 'Terminal', 'Common', 'Files', 'OpenAliceMt5TradeLedgerV1',
)
const MT5_DECISION_ROOT = process.env['OPENALICE_MT5_DECISION_ROOT'] ?? join(
  process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'),
  'MetaQuotes', 'Terminal', 'Common', 'Files', 'OpenAliceMt5DecisionLogV1',
)
const MT5_EXECUTION_ROOT = process.env['OPENALICE_MT5_EXECUTION_ROOT'] ?? join(
  process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'),
  'MetaQuotes', 'Terminal', 'Common', 'Files', 'OpenAliceMt5ExecutionV1',
)

type ResearchInstrumentConfig = {
  broker: JmbExecutionBroker
  symbol: string
  bridgeSymbol?: JmbExecutionSymbol
  label: string
  artifact: string
  walkForwardArtifact: string
}

const INSTRUMENTS: readonly ResearchInstrumentConfig[] = [
  { broker: 'hfmarkets', symbol: 'XAUUSDb', bridgeSymbol: 'XAUUSD', label: 'Gold / USD', artifact: 'xauusd-trend-baseline.json', walkForwardArtifact: 'xauusd-walk-forward.json' },
  { broker: 'hfmarkets', symbol: 'EURUSDb', bridgeSymbol: 'EURUSD', label: 'Euro / USD', artifact: 'eurusd-trend-baseline.json', walkForwardArtifact: 'eurusd-walk-forward.json' },
  { broker: 'icmarkets', symbol: 'XAUUSD', label: 'Gold / USD', artifact: 'icmarkets-xauusd-trend-baseline.json', walkForwardArtifact: 'icmarkets-xauusd-walk-forward.json' },
  { broker: 'icmarkets', symbol: 'EURUSD', label: 'Euro / USD', artifact: 'icmarkets-eurusd-trend-baseline.json', walkForwardArtifact: 'icmarkets-eurusd-walk-forward.json' },
] as const

function localMt5Symbol(instrument: ResearchInstrumentConfig): JmbExecutionSymbol {
  const symbol = instrument.bridgeSymbol ?? instrument.symbol
  if (symbol !== 'XAUUSD' && symbol !== 'EURUSD') {
    throw new Error(`Unsupported local MT5 symbol mapping: ${instrument.broker}/${symbol}`)
  }
  return symbol
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as T
  } catch {
    return null
  }
}

async function readReport<T>(fileName: string): Promise<T | null> {
  const primary = await readJson<T>(join(ARTIFACTS_DIR, fileName))
  if (primary || ARTIFACTS_DIR === LEGACY_ARTIFACTS_DIR) return primary
  return readJson<T>(join(LEGACY_ARTIFACTS_DIR, fileName))
}

async function inspectExport(broker: string, symbol: string) {
  const directory = join(MT5_EXPORT_ROOT, broker, symbol)
  try {
    const files = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^m1_\d{4}_\d{2}\.csv$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
    const sizes = await Promise.all(files.map((file) => stat(join(directory, file))))
    return {
      available: files.length > 0,
      files: files.length,
      firstFile: files[0] ?? null,
      lastFile: files.at(-1) ?? null,
      totalBytes: sizes.reduce((total, item) => total + item.size, 0),
      lastUpdated: sizes.reduce<Date | null>((latest, item) => !latest || item.mtime > latest ? item.mtime : latest, null)?.toISOString() ?? null,
    }
  } catch {
    return { available: false, files: 0, firstFile: null, lastFile: null, totalBytes: 0, lastUpdated: null }
  }
}

function qualityFor(
  report: ValidationReport | null,
  broker: string,
  symbol: string,
  hasExport: boolean,
): DataQuality {
  if (!report) {
    return {
      label: hasExport ? 'Needs validation' : 'Awaiting export',
      tone: hasExport ? 'amber' : 'muted',
      inspectedFiles: 0,
      likelyM1Files: 0,
      fallbackFiles: 0,
      badRows: 0,
      duplicateRows: 0,
    }
  }

  const marker = `/${broker}/${symbol}/`.toLowerCase()
  const files = report.files.filter((item) => item.file.replace(/\\/g, '/').toLowerCase().includes(marker))
  const likelyM1Files = files.filter((item) => item.likely_m1).length
  const fallbackFiles = files.length - likelyM1Files
  const badRows = files.reduce((total, item) => total + item.bad_rows, 0)
  const duplicateRows = files.reduce((total, item) => total + item.duplicates, 0)

  if (files.length === 0) {
    return { label: hasExport ? 'Not included in validation report' : 'Awaiting export', tone: hasExport ? 'amber' : 'muted', inspectedFiles: 0, likelyM1Files: 0, fallbackFiles: 0, badRows: 0, duplicateRows: 0 }
  }
  if (badRows > 0 || duplicateRows > 0) {
    return { label: 'Data issue needs review', tone: 'red', inspectedFiles: files.length, likelyM1Files, fallbackFiles, badRows, duplicateRows }
  }
  if (fallbackFiles > 0) {
    return { label: 'Mixed M1 and fallback history', tone: 'amber', inspectedFiles: files.length, likelyM1Files, fallbackFiles, badRows, duplicateRows }
  }
  return { label: 'M1 files validated', tone: 'green', inspectedFiles: files.length, likelyM1Files, fallbackFiles, badRows, duplicateRows }
}

function evidenceFor(report: TrendReport | null) {
  if (!report) return { label: 'Waiting for baseline', tone: 'muted' as const, score: 0 }
  const holdout = report.untouched_holdout
  if (holdout.total_return == null || holdout.total_return <= 0 || (holdout.sharpe ?? 0) <= 0) {
    return { label: 'Rejected by holdout', tone: 'red' as const, score: 1 }
  }
  return { label: 'Early research candidate', tone: 'amber' as const, score: 2 }
}

export function createResearchRoutes(ctx: EngineContext, overrides: { executionRoot?: string } = {}) {
  const app = new Hono()
  const executionRoot = overrides.executionRoot ?? MT5_EXECUTION_ROOT

  app.get('/', async (c) => {
    const [validationReport, experimentLedger] = await Promise.all([
      readReport<ValidationReport>('mt5-history-report.json'),
      readReport<ExperimentLedger>('daily-trend-experiment-ledger.json'),
    ])
    const instruments = await Promise.all(INSTRUMENTS.map(async (instrument) => {
      const bridgeSymbol = localMt5Symbol(instrument)
      const [exportData, report, walkForward, bridge, learning, decision, execution] = await Promise.all([
        inspectExport(instrument.broker, instrument.symbol),
        readReport<TrendReport>(instrument.artifact),
        readReport<WalkForwardReport>(instrument.walkForwardArtifact),
        readMt5ReadOnlyBridge(MT5_BRIDGE_ROOT, instrument.broker, bridgeSymbol),
        summarizeMt5TradeLedger(MT5_TRADE_LEDGER_ROOT, instrument.broker, bridgeSymbol),
        summarizeLatestJmbDecision(MT5_DECISION_ROOT, instrument.broker, bridgeSymbol),
        bridgeSymbol === 'XAUUSD'
          ? summarizeLatestJmbExecutionStatus(executionRoot, instrument.broker, bridgeSymbol)
          : Promise.resolve(createDemoBlockedExecutionSummary(instrument.broker, bridgeSymbol)),
      ])
      return {
        ...instrument,
        export: exportData,
        report,
        walkForward,
        bridge,
        learning,
        decision,
        execution,
        quality: qualityFor(validationReport, instrument.broker, instrument.symbol, exportData.available),
        evidence: evidenceFor(report),
      }
    }))

    const news = ctx.newsProvider
      ? (await ctx.newsProvider.getNewsV2({ endTime: new Date(), lookback: '24h', limit: 8 })).slice(-8).reverse().map((item) => ({
        time: item.time.toISOString(),
        title: item.title,
        source: item.metadata.source ?? null,
        link: item.metadata.link ?? null,
      }))
      : []

    const hfmReady = instruments.some((instrument) => instrument.broker === 'hfmarkets' && instrument.quality.tone !== 'muted')
    const completedBaselines = instruments.filter((instrument) => instrument.report != null).length
    const completedWalkForwards = instruments.filter((instrument) => instrument.walkForward != null).length
    const readyDemoBridges = instruments.filter((instrument) => instrument.bridge.state === 'ready').length
    const learningInstruments = instruments.filter((instrument) => instrument.learning.state === 'learning').length
    const shadowDecisions = instruments.filter((instrument) => instrument.decision.state === 'shadow' || instrument.decision.state === 'demo_blocked').length
    const goldExecutions = instruments.filter((instrument) => instrument.execution.symbol === 'XAUUSD')
    const brokerLocalExecutionStatuses = goldExecutions.filter((instrument) => !['missing', 'malformed', 'stale'].includes(instrument.execution.state)).length
    const protectedDemoPositions = goldExecutions.filter((instrument) => instrument.execution.state === 'filled_protected').length
    const validatedInstruments = instruments.filter((instrument) => instrument.quality.tone === 'green' || instrument.quality.tone === 'amber').length
    return c.json({
      asOf: new Date().toISOString(),
      mode: 'research_only',
      tradingEnabled: false,
      summary: {
        exportRoot: MT5_EXPORT_ROOT,
        tradeLedgerRoot: MT5_TRADE_LEDGER_ROOT,
        decisionRoot: MT5_DECISION_ROOT,
        executionRoot,
        instrumentsWithData: instruments.filter((instrument) => instrument.export.available).length,
        completedBaselines,
        completedWalkForwards,
        readyDemoBridges,
        learningInstruments,
        shadowDecisions,
        validatedInstruments,
        hfmReady,
        experimentRuns: experimentLedger?.runs.length ?? 0,
      },
      stages: [
        { key: 'data', label: 'Broker data inspected', state: validatedInstruments === INSTRUMENTS.length ? 'complete' : hfmReady ? 'next' : 'waiting', detail: validationReport ? 'All current exports have a validation record; fallback-resolution files remain visibly labelled.' : 'Run the local MT5 validator before trusting a backtest.' },
        { key: 'baseline', label: 'Baseline trend study', state: completedBaselines > 0 ? 'complete' : 'waiting', detail: 'Holdout results are recorded separately from training.' },
        { key: 'walkforward', label: 'Rolling walk-forward', state: completedWalkForwards === INSTRUMENTS.length ? 'complete' : completedWalkForwards > 0 ? 'next' : 'waiting', detail: completedWalkForwards === INSTRUMENTS.length ? 'Sequential unseen windows were recorded for every configured instrument; review is still required.' : 'Required before a candidate can advance.' },
        { key: 'costs', label: 'Broker cost model', state: 'next', detail: 'Commission, financing, spread, and slippage still need verification.' },
        { key: 'bridge', label: 'MT5 demo bridge', state: readyDemoBridges === INSTRUMENTS.length ? 'complete' : readyDemoBridges > 0 ? 'next' : 'waiting', detail: readyDemoBridges > 0 ? `${readyDemoBridges}/${INSTRUMENTS.length} terminals report a fresh, demo-only read-only heartbeat.` : 'Attach the read-only MT5 bridge before any paper-execution work.' },
        { key: 'learning', label: 'Trade-history learning', state: learningInstruments === INSTRUMENTS.length ? 'complete' : learningInstruments > 0 ? 'next' : 'waiting', detail: learningInstruments > 0 ? `${learningInstruments}/${INSTRUMENTS.length} broker-symbol ledgers are fresh and demo-only.` : 'Run the MT5 trade ledger exporter so manual and demo trades can be reviewed.' },
        { key: 'shadow', label: 'JMB shadow decisions', state: shadowDecisions === INSTRUMENTS.length ? 'complete' : shadowDecisions > 0 ? 'next' : 'waiting', detail: shadowDecisions > 0 ? `${shadowDecisions}/${INSTRUMENTS.length} broker-symbol pairs have logged JMB decisions.` : 'Run the shadow decision runner before enabling the demo risk shell.' },
        {
          key: 'demo',
          label: 'Demo forward test',
          state: protectedDemoPositions === goldExecutions.length ? 'complete' : brokerLocalExecutionStatuses > 0 ? 'next' : 'blocked',
          detail: `${brokerLocalExecutionStatuses}/${goldExecutions.length} Gold broker-local MT5 lifecycle statuses are valid. Research Desk remains read-only; demo results are not live approval.`,
        },
      ],
      instruments,
      experiments: [...(experimentLedger?.runs ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 24),
      news,
      disclaimer: 'Evidence grades measure completed validation steps, not a probability of profit or a trade recommendation.',
    })
  })

  return app
}
