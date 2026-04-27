import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'

import Decimal from 'decimal.js'
import { Order } from '@traderalice/ibkr'

import { IndicatorCalculator } from '../../../../src/domain/analysis/indicator/calculator.js'
import type { IndicatorContext, OhlcvData } from '../../../../src/domain/analysis/indicator/types.js'
import { calculate as calculateThinking } from '../../../../src/domain/thinking/tools/calculate.tool.js'
import { createEventLog } from '../../../../src/core/event-log.js'
import { NewsCollectorStore } from '../../../../src/domain/news/store.js'
import { globNews, grepNews, readNews } from '../../../../src/domain/news/query/archive.js'
import { createGuardPipeline } from '../../../../src/domain/trading/guards/guard-pipeline.js'
import { MaxPositionSizeGuard } from '../../../../src/domain/trading/guards/max-position-size.js'
import { CooldownGuard } from '../../../../src/domain/trading/guards/cooldown.js'
import { SymbolWhitelistGuard } from '../../../../src/domain/trading/guards/symbol-whitelist.js'
import { MockBroker, makeContract, makePosition } from '../../../../src/domain/trading/brokers/mock/index.js'
import { UnifiedTradingAccount } from '../../../../src/domain/trading/UnifiedTradingAccount.js'
import { buildSnapshot } from '../../../../src/domain/trading/snapshot/builder.js'
import '../../../../src/domain/trading/contract-ext.js'

type ModuleId = 'analysis_core' | 'trading_core' | 'store_core'

interface BenchmarkResult {
  moduleId: ModuleId
  scenario: string
  fixture: string
  warmupIterations: number
  measuredIterations: number
  totalMs: number
  meanMs: number
  medianMs: number
  p95Ms: number
  worstMs: number
  minMs: number
  opsPerSecond: number
  heapDeltaBytes: number
  notes?: string
}

interface BenchmarkRun {
  metadata: Record<string, unknown>
  results: BenchmarkResult[]
}

const repoRoot = process.cwd()
const outputPath = join(repoRoot, 'docs/autonomous-refactor/reports/benchmarks/phase-1-baseline-benchmark-results.json')
const tmpRoot = await mkdtemp(join(tmpdir(), 'openalice-phase1-bench-'))
const results: BenchmarkResult[] = []

let sink: unknown

try {
  await runAnalysisBenchmarks()
  await runTradingBenchmarks()
  await runStoreBenchmarks()

  const run: BenchmarkRun = {
    metadata: buildMetadata(),
    results,
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, 'utf-8')
  console.log(`wrote ${outputPath}`)
  printSummary(results)
} finally {
  await rm(tmpRoot, { recursive: true, force: true })
  if (sink === 'never') console.log(sink)
}

function buildMetadata(): Record<string, unknown> {
  return {
    runDateUtc: new Date().toISOString(),
    cwd: repoRoot,
    gitCommit: commandText('git', ['rev-parse', 'HEAD']),
    gitStatusShort: commandText('git', ['status', '--short']),
    node: process.version,
    pnpm: commandText('pnpm', ['-v']),
    rustc: commandText('rustc', ['--version']),
    cargo: commandText('cargo', ['--version']),
    os: {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpuModel: os.cpus()[0]?.model ?? 'unknown',
      cpuCount: os.cpus().length,
      totalMemBytes: os.totalmem(),
    },
    benchmarkHarness: 'docs/autonomous-refactor/reports/benchmarks/phase-1-baseline-benchmark-harness.ts',
    output: 'docs/autonomous-refactor/reports/benchmarks/phase-1-baseline-benchmark-results.json',
    tempRoot: tmpRoot,
  }
}

function commandText(command: string, args: string[]): string {
  try {
    return execFileSync(command, args, { cwd: repoRoot, encoding: 'utf-8' }).trim()
  } catch (error) {
    return `unavailable: ${error instanceof Error ? error.message : String(error)}`
  }
}

function printSummary(items: BenchmarkResult[]): void {
  for (const item of items) {
    console.log([
      item.moduleId,
      item.scenario,
      `median=${item.medianMs.toFixed(4)}ms`,
      `p95=${item.p95Ms.toFixed(4)}ms`,
      `worst=${item.worstMs.toFixed(4)}ms`,
      `ops/s=${item.opsPerSecond.toFixed(1)}`,
    ].join('\t'))
  }
}

async function measure(
  moduleId: ModuleId,
  scenario: string,
  fixture: string,
  warmupIterations: number,
  measuredIterations: number,
  fn: (index: number) => unknown | Promise<unknown>,
  notes?: string,
): Promise<void> {
  for (let i = 0; i < warmupIterations; i++) {
    sink = await fn(i)
  }

  const heapBefore = process.memoryUsage().heapUsed
  const durations: number[] = []
  const startAll = performance.now()
  for (let i = 0; i < measuredIterations; i++) {
    const start = performance.now()
    sink = await fn(i)
    durations.push(performance.now() - start)
  }
  const totalMs = performance.now() - startAll
  const heapAfter = process.memoryUsage().heapUsed
  const sorted = [...durations].sort((a, b) => a - b)
  const sum = durations.reduce((acc, value) => acc + value, 0)

  results.push({
    moduleId,
    scenario,
    fixture,
    warmupIterations,
    measuredIterations,
    totalMs,
    meanMs: sum / durations.length,
    medianMs: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    worstMs: sorted[sorted.length - 1] ?? 0,
    minMs: sorted[0] ?? 0,
    opsPerSecond: measuredIterations / (totalMs / 1000),
    heapDeltaBytes: heapAfter - heapBefore,
    notes,
  })
}

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1))
  return sorted[index]
}

function makeOhlcvFixture(size: number, symbol: string): OhlcvData[] {
  const rows: OhlcvData[] = []
  const base = Date.UTC(2025, 0, 1)
  for (let i = 0; i < size; i++) {
    const seasonal = Math.sin(i / 11) * 3 + Math.cos(i / 29) * 1.5
    const close = 100 + i * 0.03 + seasonal
    rows.push({
      date: new Date(base + i * 86_400_000).toISOString().slice(0, 10),
      open: close - 0.7,
      high: close + 1.3,
      low: close - 1.6,
      close,
      volume: 1_000_000 + (i % 251) * 100,
      symbol,
    })
  }
  return rows
}

async function runAnalysisBenchmarks(): Promise<void> {
  const fixtures = new Map<string, OhlcvData[]>([
    ['SMALL', makeOhlcvFixture(128, 'SMALL')],
    ['MEDIUM', makeOhlcvFixture(2_048, 'MEDIUM')],
    ['LARGE', makeOhlcvFixture(10_000, 'LARGE')],
  ])
  const context: IndicatorContext = {
    getHistoricalData: async (symbol: string) => {
      const data = fixtures.get(symbol)
      if (!data) throw new Error(`missing fixture for ${symbol}`)
      return {
        data,
        meta: {
          symbol,
          from: data[0].date,
          to: data[data.length - 1].date,
          bars: data.length,
        },
      }
    },
  }

  const calculator = new IndicatorCalculator(context)

  await measure(
    'analysis_core',
    'thinking.calculate simple arithmetic expression',
    'expression="((1 + 2.5) * 3 - 4) / 2"; no I/O',
    500,
    5_000,
    () => calculateThinking('((1 + 2.5) * 3 - 4) / 2'),
  )

  await measure(
    'analysis_core',
    'IndicatorCalculator nested formula evaluation',
    'MEDIUM OHLCV fixture: 2,048 bars; formula uses SMA, EMA, CLOSE, binary ops',
    20,
    300,
    () => calculator.calculate("(SMA(CLOSE('MEDIUM', '1d'), 20) - EMA(CLOSE('MEDIUM', '1d'), 10)) / EMA(CLOSE('MEDIUM', '1d'), 10) * 100"),
  )

  await measure(
    'analysis_core',
    'IndicatorCalculator invalid formula rejection',
    'SMALL OHLCV fixture: 128 bars; SMA period intentionally exceeds fixture size',
    20,
    500,
    async () => {
      try {
        await calculator.calculate("SMA(CLOSE('SMALL', '1d'), 999999)")
        return false
      } catch (error) {
        return error instanceof Error ? error.message.length : 0
      }
    },
  )

  for (const [symbol, size, iterations] of [
    ['SMALL', 128, 1_000],
    ['MEDIUM', 2_048, 500],
    ['LARGE', 10_000, 150],
  ] as const) {
    await measure(
      'analysis_core',
      `IndicatorCalculator RSI over ${size} OHLCV bars`,
      `${symbol} synthetic OHLCV fixture: ${size} bars`,
      20,
      iterations,
      () => calculator.calculate(`RSI(CLOSE('${symbol}', '1d'), 14)`),
    )
  }

  await measure(
    'analysis_core',
    'IndicatorCalculator cross-series ATR over 2,048 OHLCV bars',
    'MEDIUM OHLCV fixture: 2,048 aligned high/low/close bars',
    20,
    300,
    () => calculator.calculate("ATR(HIGH('MEDIUM', '1d'), LOW('MEDIUM', '1d'), CLOSE('MEDIUM', '1d'), 14)"),
  )
}

function makePlaceOrderOp(symbol: string, cashQty: number) {
  const contract = makeContract({ symbol, aliceId: `mock-paper|${symbol}` })
  const order = new Order()
  order.action = 'BUY'
  order.orderType = 'MKT'
  order.totalQuantity = new Decimal(1)
  order.cashQty = new Decimal(cashQty)
  return { action: 'placeOrder' as const, contract, order }
}

async function runTradingBenchmarks(): Promise<void> {
  const guardBroker = new MockBroker({
    accountInfo: {
      baseCurrency: 'USD',
      netLiquidation: '100000',
      totalCashValue: '100000',
      unrealizedPnL: '0',
      realizedPnL: '0',
    },
  })
  guardBroker.setPositions([
    makePosition({
      contract: makeContract({ symbol: 'AAPL', aliceId: 'mock-paper|AAPL' }),
      marketValue: '10000',
      marketPrice: '100',
      avgCost: '100',
      quantity: new Decimal(100),
    }),
  ])

  const allowOp = makePlaceOrderOp('AAPL', 5_000)
  const rejectOp = makePlaceOrderOp('AAPL', 25_000)
  const guardPipeline = createGuardPipeline(
    async () => ({ success: true }),
    guardBroker,
    [
      new SymbolWhitelistGuard({ symbols: ['AAPL', 'MSFT', 'GOOG'] }),
      new MaxPositionSizeGuard({ maxPercentOfEquity: 25 }),
      new CooldownGuard({ minIntervalMs: 0 }),
    ],
  )

  await measure(
    'trading_core',
    'guard pipeline allow path with three guards',
    'MockBroker account: $100k net liquidation; one AAPL position; placeOrder cashQty=$5k',
    50,
    2_000,
    () => guardPipeline(allowOp),
  )

  await measure(
    'trading_core',
    'guard pipeline rejection path at max-position-size',
    'MockBroker account: $100k net liquidation; one AAPL position; placeOrder cashQty=$25k',
    50,
    2_000,
    () => guardPipeline(rejectOp),
  )

  const accountingBroker = new MockBroker({ cash: 250_000 })
  const accountingPositions = []
  for (let i = 0; i < 200; i++) {
    const symbol = `SYM${i}`
    accountingBroker.setQuote(symbol, 90 + (i % 17))
    accountingPositions.push(makePosition({
      contract: makeContract({ symbol, aliceId: `mock-paper|${symbol}` }),
      quantity: new Decimal(1 + (i % 9)),
      avgCost: String(80 + (i % 13)),
    }))
  }
  accountingBroker.setPositions(accountingPositions)

  await measure(
    'trading_core',
    'MockBroker deterministic account aggregation over 200 positions',
    '200 synthetic positions with Decimal quantities and controlled quotes',
    20,
    1_000,
    () => accountingBroker.getAccount(),
  )

  const snapshotBroker = new MockBroker({ cash: 100_000 })
  const snapshotPositions = []
  for (let i = 0; i < 25; i++) {
    const symbol = `SNAP${i}`
    snapshotBroker.setQuote(symbol, 120 + i)
    snapshotPositions.push(makePosition({
      contract: makeContract({ symbol, aliceId: `mock-paper|${symbol}` }),
      quantity: new Decimal(10 + i),
      avgCost: String(100 + i),
    }))
  }
  snapshotBroker.setPositions(snapshotPositions)
  const uta = new UnifiedTradingAccount(snapshotBroker)
  await uta.waitForConnect()
  uta.stagePlaceOrder({
    aliceId: 'mock-paper|SNAP0',
    symbol: 'SNAP0',
    action: 'BUY',
    orderType: 'LMT',
    totalQuantity: '5',
    lmtPrice: '115',
  })
  uta.commit('benchmark pending order')
  await uta.push()

  await measure(
    'trading_core',
    'buildSnapshot over 25 positions and one pending order',
    'UnifiedTradingAccount backed by MockBroker; 25 positions; one submitted limit order',
    20,
    1_000,
    () => buildSnapshot(uta, 'manual'),
  )
  await uta.close()
}

async function runStoreBenchmarks(): Promise<void> {
  await runEventLogBenchmarks()
  await runSessionBenchmarks()
  await runNewsBenchmarks()
}

async function runEventLogBenchmarks(): Promise<void> {
  const smallLogPath = join(tmpRoot, 'event-small.jsonl')
  const smallLog = await createEventLog({ logPath: smallLogPath, bufferSize: 1_000 })
  await measure(
    'store_core',
    'event-log append throughput for small payloads',
    'append 300 measured records; payload approx 80 bytes; temp JSONL file',
    20,
    300,
    (index) => smallLog.append('benchmark.small', { index, side: index % 2 === 0 ? 'bid' : 'ask', price: 100 + index }),
  )
  await smallLog.close()

  const largeLogPath = join(tmpRoot, 'event-large.jsonl')
  const largeLog = await createEventLog({ logPath: largeLogPath, bufferSize: 1_000 })
  const largeText = 'x'.repeat(4_096)
  await measure(
    'store_core',
    'event-log append throughput for large payloads',
    'append 150 measured records; payload string 4 KiB; temp JSONL file',
    10,
    150,
    (index) => largeLog.append('benchmark.large', { index, text: largeText }),
  )
  await largeLog.close()

  const recoveryPath = join(tmpRoot, 'event-recovery-5000.jsonl')
  await writeFile(recoveryPath, makeEventLogJsonl(5_000, 256), 'utf-8')
  await measure(
    'store_core',
    'event-log cold recovery from 5,000-record events.jsonl',
    '5,000 synthetic JSONL records; temp file generated by TypeScript harness',
    5,
    50,
    async () => {
      const log = await createEventLog({ logPath: recoveryPath, bufferSize: 500 })
      const seq = log.lastSeq()
      await log.close()
      return seq
    },
  )

  const queryLog = await createEventLog({ logPath: recoveryPath, bufferSize: 500 })
  await measure(
    'store_core',
    'event-log disk read with afterSeq filter',
    '5,000-record JSONL; read entries after seq 4,500',
    10,
    200,
    () => queryLog.read({ afterSeq: 4_500 }),
  )
  await measure(
    'store_core',
    'event-log disk read with type filter',
    '5,000-record JSONL; type=benchmark.typeA',
    10,
    200,
    () => queryLog.read({ type: 'benchmark.typeA' }),
  )
  await measure(
    'store_core',
    'event-log paginated newest-first query',
    '5,000-record JSONL; page=3, pageSize=50, type=benchmark.typeB',
    10,
    200,
    () => queryLog.query({ page: 3, pageSize: 50, type: 'benchmark.typeB' }),
  )
  await queryLog.close()
}

function makeEventLogJsonl(count: number, payloadBytes: number): string {
  const payloadText = 'e'.repeat(payloadBytes)
  let out = ''
  for (let i = 1; i <= count; i++) {
    out += `${JSON.stringify({
      seq: i,
      ts: 1_700_000_000_000 + i,
      type: i % 3 === 0 ? 'benchmark.typeA' : 'benchmark.typeB',
      payload: { index: i, text: payloadText },
    })}\n`
  }
  return out
}

async function runSessionBenchmarks(): Promise<void> {
  const sessionCwd = join(tmpRoot, 'session-cwd')
  await mkdir(sessionCwd, { recursive: true })
  process.chdir(sessionCwd)
  const sessionModule = await import('../../../../src/core/session.js')
  process.chdir(repoRoot)
  const {
    SessionStore,
    toModelMessages,
    toTextHistory,
    toResponsesInput,
    toChatHistory,
  } = sessionModule

  const appendStore = new SessionStore('append-throughput')
  await measure(
    'store_core',
    'session append throughput for short text entries',
    'SessionStore in temp cwd; alternating appendUser/appendAssistant text entries',
    20,
    300,
    (index) => index % 2 === 0
      ? appendStore.appendUser(`user message ${index}`, 'human')
      : appendStore.appendAssistant(`assistant message ${index}`, 'codex'),
  )

  const restoreId = 'restore-long-session'
  const restoreStore = new SessionStore(restoreId)
  for (const entry of makeSessionEntries(1_000, restoreId)) {
    await restoreStore.appendRaw(entry)
  }
  await measure(
    'store_core',
    'session restore and readAll for 1,000-entry history',
    'SessionStore JSONL in temp cwd; 1,000 mixed user/assistant/tool/system entries',
    5,
    50,
    async () => {
      const store = new SessionStore(restoreId)
      await store.restore()
      return store.readAll()
    },
  )

  const conversionEntries = makeSessionEntries(1_000, 'conversion-session')
  await measure(
    'store_core',
    'session conversion to ModelMessage array',
    '1,000 generated session entries with text, tool_use/tool_result, image, and compact boundary records',
    20,
    300,
    () => toModelMessages(conversionEntries),
  )
  await measure(
    'store_core',
    'session conversion to text history',
    '1,000 generated session entries with text, tool_use/tool_result, image, and compact boundary records',
    20,
    300,
    () => toTextHistory(conversionEntries),
  )
  await measure(
    'store_core',
    'session conversion to Responses API input',
    '1,000 generated session entries with text, tool_use/tool_result, image, and compact boundary records',
    20,
    300,
    () => toResponsesInput(conversionEntries),
  )
  await measure(
    'store_core',
    'session conversion to chat history',
    '1,000 generated session entries with text, tool_use/tool_result, image, and compact boundary records',
    20,
    300,
    () => toChatHistory(conversionEntries),
  )
}

function makeSessionEntries(count: number, sessionId: string) {
  const entries = []
  for (let i = 0; i < count; i++) {
    const parentUuid = i === 0 ? null : `${sessionId}-${i - 1}`
    const base = {
      uuid: `${sessionId}-${i}`,
      parentUuid,
      sessionId,
      timestamp: new Date(Date.UTC(2025, 0, 1, 0, 0, i)).toISOString(),
    }
    if (i % 25 === 0) {
      entries.push({
        ...base,
        type: 'system',
        subtype: 'compact_boundary',
        compactMetadata: { trigger: 'manual', preTokens: 40_000 + i },
        message: { role: 'system', content: 'Conversation compacted' },
        provider: 'compaction',
      })
    } else if (i % 5 === 1) {
      entries.push({
        ...base,
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: `assistant text ${i}` },
            { type: 'tool_use', id: `tool-${i}`, name: 'mcp__open-alice__grepNews', input: { pattern: 'BTC|ETH', limit: 5 } },
          ],
        },
        provider: 'codex',
      })
    } else if (i % 5 === 2) {
      entries.push({
        ...base,
        type: 'user',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: `tool-${i - 1}`, content: `result payload ${i}` },
          ],
        },
        provider: 'codex',
      })
    } else if (i % 5 === 3) {
      entries.push({
        ...base,
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: `chart answer ${i}` },
            { type: 'image', url: `media://chart/${i}.png` },
          ],
        },
        provider: 'agent-sdk',
      })
    } else {
      entries.push({
        ...base,
        type: 'user',
        message: { role: 'user', content: `user text ${i}` },
        provider: 'human',
      })
    }
  }
  return entries
}

async function runNewsBenchmarks(): Promise<void> {
  const ingestPath = join(tmpRoot, 'news-ingest.jsonl')
  const ingestStore = new NewsCollectorStore({ logPath: ingestPath, maxInMemory: 2_000, retentionDays: 3650 })
  await ingestStore.init()
  await measure(
    'store_core',
    'news ingest throughput for non-duplicate records',
    'NewsCollectorStore temp JSONL; 500 unique records; measured one ingest per iteration',
    20,
    500,
    (index) => ingestStore.ingest(makeNewsItem(index)),
  )
  await measure(
    'store_core',
    'news ingest duplicate rejection throughput',
    'NewsCollectorStore temp JSONL; re-ingest existing 500 dedup keys',
    20,
    500,
    (index) => ingestStore.ingest(makeNewsItem(index)),
  )
  await ingestStore.close()

  const recoveryPath = join(tmpRoot, 'news-recovery-5000.jsonl')
  await writeFile(recoveryPath, makeNewsJsonl(5_000), 'utf-8')
  await measure(
    'store_core',
    'news recovery from 5,000-record archive',
    '5,000 synthetic NewsRecord JSONL lines; retentionDays=3650; temp file',
    5,
    50,
    async () => {
      const store = new NewsCollectorStore({ logPath: recoveryPath, maxInMemory: 10_000, retentionDays: 3650 })
      await store.init()
      const count = store.count + store.dedupCount
      await store.close()
      return count
    },
  )

  const archiveStore = new NewsCollectorStore({ logPath: recoveryPath, maxInMemory: 10_000, retentionDays: 3650 })
  await archiveStore.init()
  const context = {
    getNews: () => archiveStore.getNewsV2({ endTime: new Date('2026-01-02T00:00:00.000Z'), lookback: '30d', limit: 5_000 }),
  }
  await measure(
    'store_core',
    'news archive glob title search latency',
    '5,000-record archive; pattern="BTC|ETH"; lookback=30d',
    20,
    300,
    () => globNews(context, { pattern: 'BTC|ETH', limit: 100 }),
  )
  await measure(
    'store_core',
    'news archive grep content search latency',
    '5,000-record archive; pattern="interest rate"; contextChars=80; lookback=30d',
    20,
    300,
    () => grepNews(context, { pattern: 'interest rate', contextChars: 80, limit: 100 }),
  )
  await measure(
    'store_core',
    'news archive metadata-filtered grep latency',
    '5,000-record archive; pattern="liquidity"; metadataFilter source=benchmark-a; lookback=30d',
    20,
    300,
    () => grepNews(context, { pattern: 'liquidity', metadataFilter: { source: 'benchmark-a' }, limit: 100 }),
  )
  await measure(
    'store_core',
    'news archive read-by-index latency',
    '5,000-record archive; read index 2,500 after lookback fetch',
    20,
    300,
    () => readNews(context, { index: 2_500 }),
  )
  await archiveStore.close()
}

function makeNewsItem(index: number) {
  return {
    title: index % 2 === 0 ? `BTC liquidity update ${index}` : `Equity market note ${index}`,
    content: `Benchmark article ${index}. The interest rate backdrop and market liquidity are monitored for archive search latency.`,
    pubTime: new Date(Date.UTC(2025, 11, 1, 0, index % 60, 0)),
    dedupKey: `bench-news-${index}`,
    metadata: {
      source: index % 3 === 0 ? 'benchmark-a' : 'benchmark-b',
      symbol: index % 2 === 0 ? 'BTC' : 'SPY',
    },
  }
}

function makeNewsJsonl(count: number): string {
  let out = ''
  for (let i = 0; i < count; i++) {
    const item = makeNewsItem(i)
    out += `${JSON.stringify({
      seq: i + 1,
      ts: Date.UTC(2025, 11, 1, 0, 0, 0) + i,
      pubTs: item.pubTime.getTime(),
      dedupKey: item.dedupKey,
      title: item.title,
      content: item.content,
      metadata: item.metadata,
    })}\n`
  }
  return out
}
