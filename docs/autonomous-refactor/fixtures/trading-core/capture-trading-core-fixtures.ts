import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Decimal from 'decimal.js'
import { Order, UNSET_DECIMAL } from '@traderalice/ibkr'
import { AccountManager } from '../../../../src/domain/trading/account-manager.js'
import { UnifiedTradingAccount } from '../../../../src/domain/trading/UnifiedTradingAccount.js'
import { MockBroker, makeContract, makePosition } from '../../../../src/domain/trading/brokers/mock/index.js'
import type { AccountInfo, OpenOrder, Position } from '../../../../src/domain/trading/brokers/types.js'
import type {
  CommitLogEntry,
  GitCommit,
  GitExportState,
  GitState,
  GitStatus,
  Operation,
  OperationResult,
  PushResult,
} from '../../../../src/domain/trading/git/types.js'
import { buildSnapshot } from '../../../../src/domain/trading/snapshot/builder.js'
import type { UTASnapshot } from '../../../../src/domain/trading/snapshot/types.js'
import { CooldownGuard } from '../../../../src/domain/trading/guards/cooldown.js'
import { MaxPositionSizeGuard } from '../../../../src/domain/trading/guards/max-position-size.js'
import { SymbolWhitelistGuard } from '../../../../src/domain/trading/guards/symbol-whitelist.js'
import { resolveGuards } from '../../../../src/domain/trading/guards/registry.js'
import type { GuardContext, OperationGuard } from '../../../../src/domain/trading/guards/types.js'

const FIXED_NOW_ISO = '2026-01-02T03:04:05.678Z'
const FIXTURE_VERSION = 1
const outDir = dirname(fileURLToPath(import.meta.url))

type JsonRecord = Record<string, unknown>

async function main(): Promise<void> {
  await withFixedClock(async () => {
    await writeJson('stage-commit-push.fixture.json', await captureStageCommitPush())
    await writeJson('guard-outcomes.fixture.json', await captureGuardOutcomes())
    await writeJson('snapshot-accounting-precision.fixture.json', await captureSnapshotAccountingPrecision())
  })
}

async function withFixedClock<T>(fn: () => Promise<T>): Promise<T> {
  const RealDate = globalThis.Date
  const fixedMs = RealDate.parse(FIXED_NOW_ISO)

  class FixedDate extends RealDate {
    constructor(...args: unknown[]) {
      if (args.length === 0) {
        super(fixedMs)
      } else {
        super(...(args as [string | number | Date]))
      }
    }

    static now(): number {
      return fixedMs
    }

    static parse(value: string): number {
      return RealDate.parse(value)
    }

    static UTC(...args: Parameters<typeof Date.UTC>): number {
      return RealDate.UTC(...args)
    }
  }

  globalThis.Date = FixedDate as unknown as DateConstructor
  try {
    return await fn()
  } finally {
    globalThis.Date = RealDate
  }
}

async function captureStageCommitPush(): Promise<JsonRecord> {
  const market = await createConnectedUta(new MockBroker({ cash: 100_000 }))
  market.broker.setQuote('AAPL', 150)
  const accountBefore = await market.broker.getAccount()
  market.broker.resetCalls()

  const stageResult = market.uta.stagePlaceOrder({
    aliceId: 'mock-paper|AAPL',
    symbol: 'AAPL',
    action: 'BUY',
    orderType: 'MKT',
    totalQuantity: 10,
  })
  const statusAfterStage = normalizeGitStatus(market.uta.status())
  const accountAfterStage = await market.broker.getAccount()
  const placeOrderCallsAfterStage = market.broker.callCount('placeOrder')

  const commitResult = market.uta.commit('buy 10 AAPL')
  const statusAfterCommit = normalizeGitStatus(market.uta.status())
  const placeOrderCallsBeforePush = market.broker.callCount('placeOrder')

  const pushResult = await market.uta.push()
  const placeOrderCallsAfterPush = market.broker.callCount('placeOrder')
  const accountAfterPush = await market.broker.getAccount()
  const positionsAfterPush = await market.broker.getPositions()

  const limit = await createConnectedUta(new MockBroker({ cash: 100_000 }))
  limit.broker.setQuote('AAPL', 150)
  limit.uta.stagePlaceOrder({
    aliceId: 'mock-paper|AAPL',
    symbol: 'AAPL',
    action: 'BUY',
    orderType: 'LMT',
    totalQuantity: 5,
    lmtPrice: 145,
  })
  const limitCommit = limit.uta.commit('limit buy 5 AAPL')
  const limitPush = await limit.uta.push()
  const pendingBeforeFill = limit.uta.getPendingOrderIds()
  const syncBeforeFill = await limit.uta.sync()
  const limitOrderId = limitPush.submitted[0]?.orderId
  if (limitOrderId) {
    limit.broker.fillPendingOrder(limitOrderId, 144)
  }
  const syncAfterFill = await limit.uta.sync()
  const positionsAfterSync = await limit.broker.getPositions()

  const reject = await createConnectedUta(new MockBroker({ cash: 100_000 }))
  reject.uta.stagePlaceOrder({
    aliceId: 'mock-paper|AAPL',
    symbol: 'AAPL',
    action: 'BUY',
    orderType: 'MKT',
    totalQuantity: 1,
  })
  const rejectCommit = reject.uta.commit('buy 1 AAPL pending human review')
  const rejectResult = await reject.uta.reject('manual risk veto')

  const noCommit = await createConnectedUta(new MockBroker({ cash: 100_000 }))
  noCommit.uta.stagePlaceOrder({
    aliceId: 'mock-paper|AAPL',
    symbol: 'AAPL',
    action: 'BUY',
    orderType: 'MKT',
    totalQuantity: 1,
  })

  return {
    ...baseFixture('trading-core/stage-commit-push'),
    cases: {
      marketBuyStageCommitPush: {
        input: {
          stageParams: {
            aliceId: 'mock-paper|AAPL',
            symbol: 'AAPL',
            action: 'BUY',
            orderType: 'MKT',
            totalQuantity: 10,
          },
          quote: { symbol: 'AAPL', price: 150 },
        },
        before: { account: normalizeAccountInfo(accountBefore) },
        afterStage: {
          addResult: normalizeAddResult(stageResult),
          status: statusAfterStage,
          account: normalizeAccountInfo(accountAfterStage),
          brokerPlaceOrderCalls: placeOrderCallsAfterStage,
          note: 'stage records intent only; it does not call broker.placeOrder',
        },
        afterCommit: {
          commitResult,
          status: statusAfterCommit,
          brokerPlaceOrderCalls: placeOrderCallsBeforePush,
          note: 'commit prepares an auditable pending hash/message without broker side effects',
        },
        afterPush: {
          pushResult: normalizePushResult(pushResult),
          status: normalizeGitStatus(market.uta.status()),
          brokerPlaceOrderCalls: placeOrderCallsAfterPush,
          account: normalizeAccountInfo(accountAfterPush),
          positions: positionsAfterPush.map(normalizePosition),
          log: market.uta.log().map(normalizeLogEntry),
          showHead: normalizeCommit(market.uta.show(pushResult.hash)),
          exportState: normalizeExportState(market.uta.exportGitState()),
        },
      },
      limitOrderPushAndSync: {
        input: {
          stageParams: {
            aliceId: 'mock-paper|AAPL',
            symbol: 'AAPL',
            action: 'BUY',
            orderType: 'LMT',
            totalQuantity: 5,
            lmtPrice: 145,
          },
          fillPrice: 144,
        },
        afterCommit: { commitResult: limitCommit },
        afterPush: {
          pushResult: normalizePushResult(limitPush),
          pendingOrderIds: pendingBeforeFill,
          syncBeforeFill,
        },
        afterFillAndSync: {
          syncResult: syncAfterFill,
          pendingOrderIds: limit.uta.getPendingOrderIds(),
          positions: positionsAfterSync.map(normalizePosition),
          log: limit.uta.log().map(normalizeLogEntry),
          showSyncCommit: normalizeCommit(limit.uta.show(syncAfterFill.hash)),
        },
      },
      manualReject: {
        afterCommit: {
          commitResult: rejectCommit,
          status: normalizeGitStatus(reject.uta.status()),
        },
        afterReject: {
          rejectResult,
          status: normalizeGitStatus(reject.uta.status()),
          brokerPlaceOrderCalls: reject.broker.callCount('placeOrder'),
          showRejectedCommit: normalizeCommit(reject.uta.show(rejectResult.hash)),
        },
      },
      preconditionErrors: {
        commitWithoutStagedOperations: await captureError(() => market.uta.commit('empty follow-up')),
        pushWithoutCommit: await captureError(() => noCommit.uta.push()),
      },
    },
  }
}

async function captureGuardOutcomes(): Promise<JsonRecord> {
  const maxGuard = new MaxPositionSizeGuard({ maxPercentOfEquity: 25 })
  const whitelistGuard = new SymbolWhitelistGuard({ symbols: ['AAPL', 'GOOG'] })
  const cooldownGuard = new CooldownGuard({ minIntervalMs: 60_000 })

  const allowPipeline = await createConnectedUta(new MockBroker({ cash: 100_000 }), {
    guards: [{ type: 'symbol-whitelist', options: { symbols: ['AAPL'] } }],
  })
  allowPipeline.broker.setQuote('AAPL', 150)
  allowPipeline.uta.stagePlaceOrder({
    aliceId: 'mock-paper|AAPL',
    symbol: 'AAPL',
    action: 'BUY',
    orderType: 'MKT',
    totalQuantity: 1,
  })
  allowPipeline.uta.commit('guard allowed AAPL')
  const allowPush = await allowPipeline.uta.push()

  const rejectPipeline = await createConnectedUta(new MockBroker({ cash: 100_000 }), {
    guards: [{ type: 'symbol-whitelist', options: { symbols: ['AAPL'] } }],
  })
  rejectPipeline.uta.stagePlaceOrder({
    aliceId: 'mock-paper|TSLA',
    symbol: 'TSLA',
    action: 'BUY',
    orderType: 'MKT',
    totalQuantity: 1,
  })
  rejectPipeline.uta.commit('guard rejected TSLA')
  const rejectPush = await rejectPipeline.uta.push()

  const unknownGuardWarnings: string[] = []
  const originalWarn = console.warn
  console.warn = (message?: unknown) => {
    unknownGuardWarnings.push(String(message))
  }
  const resolvedWithUnknown = resolveGuards([{ type: 'nonexistent' }])
  console.warn = originalWarn

  const cooldownContext = guardContext({ symbol: 'AAPL' })
  const cooldownFirst = cooldownGuard.check(cooldownContext)
  const cooldownSecond = cooldownGuard.check(cooldownContext)

  return {
    ...baseFixture('trading-core/guard-outcomes'),
    cases: {
      directGuards: [
        guardCase('max-position-size allow below limit', maxGuard, guardContext({ cashQty: 20_000 })),
        guardCase('max-position-size reject above limit', maxGuard, guardContext({ cashQty: 30_000 })),
        guardCase('max-position-size reject existing-plus-new position', maxGuard, guardContext({
          cashQty: 10_000,
          positions: [makePosition({ contract: makeContract({ symbol: 'AAPL' }), marketValue: '20000' })],
        })),
        guardCase('symbol-whitelist allow listed symbol', whitelistGuard, guardContext({ symbol: 'AAPL' })),
        guardCase('symbol-whitelist reject unlisted symbol', whitelistGuard, guardContext({ symbol: 'TSLA' })),
        {
          name: 'cooldown first trade allowed and repeat rejected',
          guard: 'cooldown',
          options: { minIntervalMs: 60_000 },
          input: normalizeGuardContext(cooldownContext),
          outcomes: [
            normalizeGuardOutcome(cooldownFirst),
            normalizeGuardOutcome(cooldownSecond),
          ],
        },
      ],
      pipelineThroughUnifiedTradingAccount: {
        allowListedSymbol: {
          pushResult: normalizePushResult(allowPush),
          brokerPlaceOrderCalls: allowPipeline.broker.callCount('placeOrder'),
          positions: (await allowPipeline.broker.getPositions()).map(normalizePosition),
        },
        rejectUnlistedSymbol: {
          pushResult: normalizePushResult(rejectPush),
          brokerPlaceOrderCalls: rejectPipeline.broker.callCount('placeOrder'),
          positions: (await rejectPipeline.broker.getPositions()).map(normalizePosition),
          note: 'guard rejection returns a rejected operation result and skips broker.placeOrder',
        },
      },
      registry: {
        builtinNames: resolveGuards([
          { type: 'max-position-size', options: { maxPercentOfEquity: 25 } },
          { type: 'symbol-whitelist', options: { symbols: ['AAPL'] } },
          { type: 'cooldown', options: { minIntervalMs: 60_000 } },
        ]).map((guard) => guard.name),
        unknownGuardResolution: {
          resultCount: resolvedWithUnknown.length,
          warnings: unknownGuardWarnings,
        },
      },
    },
  }
}

async function captureSnapshotAccountingPrecision(): Promise<JsonRecord> {
  const snapshotSource = await createConnectedUta(new MockBroker({ cash: 100_000 }))
  snapshotSource.broker.setQuote('AAPL', 150)
  snapshotSource.uta.stagePlaceOrder({
    aliceId: 'mock-paper|AAPL',
    symbol: 'AAPL',
    action: 'BUY',
    orderType: 'MKT',
    totalQuantity: 10,
  })
  snapshotSource.uta.commit('buy 10 AAPL before snapshot')
  await snapshotSource.uta.push()
  snapshotSource.uta.stagePlaceOrder({
    aliceId: 'mock-paper|AAPL',
    symbol: 'AAPL',
    action: 'BUY',
    orderType: 'LMT',
    totalQuantity: 5,
    lmtPrice: 140,
  })
  snapshotSource.uta.commit('pending limit order in snapshot')
  await snapshotSource.uta.push()
  const snapshot = await buildSnapshot(snapshotSource.uta, 'manual')

  const buy = await createConnectedUta(new MockBroker({ cash: 100_000 }))
  buy.broker.setQuote('AAPL', 150)
  buy.uta.stagePlaceOrder({
    aliceId: 'mock-paper|AAPL',
    symbol: 'AAPL',
    action: 'BUY',
    orderType: 'MKT',
    totalQuantity: 10,
  })
  buy.uta.commit('buy cash string case')
  await buy.uta.push()
  const accountAfterBuy = await buy.broker.getAccount()

  const limitFill = await createConnectedUta(new MockBroker({ cash: 100_000 }))
  limitFill.uta.stagePlaceOrder({
    aliceId: 'mock-paper|AAPL',
    symbol: 'AAPL',
    action: 'BUY',
    orderType: 'LMT',
    totalQuantity: 5,
    lmtPrice: 145,
  })
  limitFill.uta.commit('limit fill avg cost string case')
  const limitFillPush = await limitFill.uta.push()
  const orderId = limitFillPush.submitted[0]?.orderId
  if (orderId) {
    limitFill.broker.fillPendingOrder(orderId, 144)
  }
  await limitFill.uta.sync()
  const positionsAfterLimitFill = await limitFill.broker.getPositions()

  const fullClose = await createConnectedUta(new MockBroker({ cash: 100_000 }))
  fullClose.broker.setQuote('AAPL', 150)
  fullClose.uta.stagePlaceOrder({
    aliceId: 'mock-paper|AAPL',
    symbol: 'AAPL',
    action: 'BUY',
    orderType: 'MKT',
    totalQuantity: 10,
  })
  fullClose.uta.commit('buy before full close')
  await fullClose.uta.push()
  fullClose.uta.stageClosePosition({ aliceId: 'mock-paper|AAPL' })
  fullClose.uta.commit('full close')
  await fullClose.uta.push()
  const accountAfterFullClose = await fullClose.broker.getAccount()

  const stagedPrecision = await createConnectedUta(new MockBroker({ cash: 100_000 }))
  stagedPrecision.uta.stagePlaceOrder({
    aliceId: 'mock-paper|AAPL',
    symbol: 'AAPL',
    action: 'BUY',
    orderType: 'LMT',
    totalQuantity: 10,
    lmtPrice: 145.25,
  })
  const stagedPrecisionWire = JSON.parse(JSON.stringify(stagedPrecision.uta.status()))

  const cryptoPrecision = await createConnectedUta(new MockBroker({ cash: 100_000 }))
  cryptoPrecision.uta.stagePlaceOrder({
    aliceId: 'mock-paper|ETH',
    symbol: 'ETH',
    action: 'BUY',
    orderType: 'LMT',
    totalQuantity: '0.12345678',
    lmtPrice: '0.00001234',
  })
  const cryptoPrecisionWire = JSON.parse(JSON.stringify(cryptoPrecision.uta.status()))
  cryptoPrecision.uta.commit('crypto scale limit precision')
  const cryptoPush = await cryptoPrecision.uta.push()
  const cryptoOrders = await cryptoPrecision.broker.getOrders([cryptoPush.submitted[0]?.orderId ?? ''])

  const cleanString = await createConnectedUta(new MockBroker({ cash: 100_000 }))
  cleanString.uta.stagePlaceOrder({
    aliceId: 'mock-paper|AAPL',
    symbol: 'AAPL',
    action: 'BUY',
    orderType: 'LMT',
    totalQuantity: 100,
    lmtPrice: '0.3',
  })
  cleanString.uta.commit('clean decimal string')
  const cleanPush = await cleanString.uta.push()
  const cleanOrders = await cleanString.broker.getOrders([cleanPush.submitted[0]?.orderId ?? ''])

  const manager = new AccountManager()
  const accountA = await createConnectedUta(new MockBroker({
    id: 'a1',
    label: 'Paper A',
    accountInfo: {
      netLiquidation: '50000',
      totalCashValue: '30000',
      unrealizedPnL: '2000',
      realizedPnL: '500',
    },
  }))
  const accountB = await createConnectedUta(new MockBroker({
    id: 'a2',
    label: 'Paper B',
    accountInfo: {
      netLiquidation: '75000',
      totalCashValue: '60000',
      unrealizedPnL: '3000',
      realizedPnL: '1000',
    },
  }))
  manager.add(accountA.uta)
  manager.add(accountB.uta)
  const aggregatedEquity = await manager.getAggregatedEquity()

  return {
    ...baseFixture('trading-core/snapshot-accounting-precision'),
    cases: {
      snapshotWithPositionAndPendingOrder: normalizeSnapshot(snapshot),
      lifecycleMonetaryStringBoundaries: {
        marketBuyCash: {
          totalCashValue: accountAfterBuy.totalCashValue,
          valueType: typeof accountAfterBuy.totalCashValue,
          expectedLegacyValue: '98500',
        },
        limitFillAverageCost: {
          avgCost: positionsAfterLimitFill[0]?.avgCost,
          valueType: typeof positionsAfterLimitFill[0]?.avgCost,
          expectedLegacyValue: '144',
        },
        fullCloseCash: {
          totalCashValue: accountAfterFullClose.totalCashValue,
          valueType: typeof accountAfterFullClose.totalCashValue,
          expectedLegacyValue: '100000',
        },
      },
      stagedOrderJsonPrecision: {
        lmtPriceFromNumberInput: {
          value: stagedPrecisionWire.staged[0].order.lmtPrice,
          valueType: typeof stagedPrecisionWire.staged[0].order.lmtPrice,
          totalQuantity: stagedPrecisionWire.staged[0].order.totalQuantity,
          totalQuantityType: typeof stagedPrecisionWire.staged[0].order.totalQuantity,
        },
        cryptoScaleStringInput: {
          wireTotalQuantity: cryptoPrecisionWire.staged[0].order.totalQuantity,
          wireTotalQuantityType: typeof cryptoPrecisionWire.staged[0].order.totalQuantity,
          wireLimitPrice: cryptoPrecisionWire.staged[0].order.lmtPrice,
          wireLimitPriceType: typeof cryptoPrecisionWire.staged[0].order.lmtPrice,
          brokerOrder: cryptoOrders[0] ? normalizeOpenOrder(cryptoOrders[0]) : null,
        },
        cleanDecimalString: {
          input: '0.3',
          brokerOrderLimitPrice: cleanOrders[0]?.order.lmtPrice?.toFixed(),
          decimalEqualsInput: cleanOrders[0]?.order.lmtPrice?.equals(new Decimal('0.3')) ?? false,
        },
      },
      accountManagerAggregation: {
        result: aggregatedEquity,
        fieldTypes: fieldTypes(aggregatedEquity, [
          'totalEquity',
          'totalCash',
          'totalUnrealizedPnL',
          'totalRealizedPnL',
        ]),
      },
    },
  }
}

function baseFixture(name: string): JsonRecord {
  return {
    fixtureVersion: FIXTURE_VERSION,
    fixture: name,
    module: 'trading_core',
    legacyRuntime: 'TypeScript',
    capturedAt: FIXED_NOW_ISO,
    fixedClock: FIXED_NOW_ISO,
    capturedBy: 'docs/autonomous-refactor/fixtures/trading-core/capture-trading-core-fixtures.ts',
    sourcePaths: [
      'src/domain/trading/git/**',
      'src/domain/trading/guards/**',
      'src/domain/trading/snapshot/**',
      'src/domain/trading/account-manager.ts',
      'src/domain/trading/UnifiedTradingAccount.ts',
      'src/domain/trading/brokers/mock/**',
    ],
  }
}

async function createConnectedUta(
  broker: MockBroker,
  options: ConstructorParameters<typeof UnifiedTradingAccount>[1] = {},
): Promise<{ uta: UnifiedTradingAccount; broker: MockBroker }> {
  const uta = new UnifiedTradingAccount(broker, options)
  await uta.waitForConnect()
  broker.resetCalls()
  return { uta, broker }
}

function makePlaceOrderOp(opts: {
  symbol?: string
  action?: 'BUY' | 'SELL'
  orderType?: string
  totalQuantity?: number | string
  cashQty?: number | string
} = {}): Operation {
  const symbol = opts.symbol ?? 'AAPL'
  const order = new Order()
  order.action = opts.action ?? 'BUY'
  order.orderType = opts.orderType ?? 'MKT'
  if (opts.totalQuantity != null) order.totalQuantity = new Decimal(String(opts.totalQuantity))
  if (opts.cashQty != null) order.cashQty = new Decimal(String(opts.cashQty))
  return {
    action: 'placeOrder',
    contract: makeContract({ symbol, aliceId: `mock-paper|${symbol}` }),
    order,
  }
}

function guardContext(opts: {
  symbol?: string
  cashQty?: number
  positions?: Position[]
  account?: Partial<AccountInfo>
} = {}): GuardContext {
  return {
    operation: makePlaceOrderOp({
      symbol: opts.symbol ?? 'AAPL',
      totalQuantity: 10,
      cashQty: opts.cashQty,
    }),
    positions: opts.positions ?? [],
    account: {
      baseCurrency: 'USD',
      netLiquidation: '100000',
      totalCashValue: '100000',
      unrealizedPnL: '0',
      realizedPnL: '0',
      ...opts.account,
    },
  }
}

function guardCase(name: string, guard: OperationGuard, ctx: GuardContext): JsonRecord {
  return {
    name,
    guard: guard.name,
    input: normalizeGuardContext(ctx),
    outcome: normalizeGuardOutcome(guard.check(ctx)),
  }
}

function normalizeGuardOutcome(reason: string | null | Promise<string | null>): JsonRecord {
  if (reason instanceof Promise) {
    throw new Error('fixture capture expects synchronous built-in guards')
  }
  return {
    allowed: reason === null,
    rejection: reason,
    rejectionType: reason === null ? 'null' : typeof reason,
  }
}

function normalizeGuardContext(ctx: GuardContext): JsonRecord {
  return {
    operation: normalizeOperation(ctx.operation),
    positions: ctx.positions.map(normalizePosition),
    account: normalizeAccountInfo(ctx.account),
  }
}

function normalizeAddResult(result: { staged: true; index: number; operation: Operation }): JsonRecord {
  return {
    staged: result.staged,
    index: result.index,
    operation: normalizeOperation(result.operation),
  }
}

function normalizeGitStatus(status: GitStatus): JsonRecord {
  return {
    staged: status.staged.map(normalizeOperation),
    pendingMessage: status.pendingMessage,
    pendingHash: status.pendingHash,
    head: status.head,
    commitCount: status.commitCount,
  }
}

function normalizePushResult(result: PushResult): JsonRecord {
  return {
    hash: result.hash,
    message: result.message,
    operationCount: result.operationCount,
    submitted: result.submitted.map(normalizeOperationResult),
    rejected: result.rejected.map(normalizeOperationResult),
  }
}

function normalizeOperationResult(result: OperationResult): JsonRecord {
  return omitUndefined({
    action: result.action,
    success: result.success,
    orderId: result.orderId,
    status: result.status,
    filledQty: result.filledQty,
    filledPrice: result.filledPrice,
    error: result.error,
    orderStateStatus: result.orderState?.status,
  })
}

function normalizeExportState(state: GitExportState): JsonRecord {
  return {
    head: state.head,
    commits: state.commits.map(normalizeCommit),
  }
}

function normalizeCommit(commit: GitCommit | null): JsonRecord | null {
  if (!commit) return null
  return omitUndefined({
    hash: commit.hash,
    parentHash: commit.parentHash,
    message: commit.message,
    operations: commit.operations.map(normalizeOperation),
    results: commit.results.map(normalizeOperationResult),
    stateAfter: normalizeGitState(commit.stateAfter),
    timestamp: commit.timestamp,
    round: commit.round,
  })
}

function normalizeLogEntry(entry: CommitLogEntry): JsonRecord {
  return omitUndefined({
    hash: entry.hash,
    parentHash: entry.parentHash,
    message: entry.message,
    timestamp: entry.timestamp,
    round: entry.round,
    operations: entry.operations,
  })
}

function normalizeGitState(state: GitState): JsonRecord {
  return {
    account: normalizeAccountInfo({
      baseCurrency: 'USD',
      netLiquidation: state.netLiquidation,
      totalCashValue: state.totalCashValue,
      unrealizedPnL: state.unrealizedPnL,
      realizedPnL: state.realizedPnL,
    }),
    positions: state.positions.map(normalizePosition),
    pendingOrders: state.pendingOrders.map(normalizeOpenOrder),
  }
}

function normalizeOperation(operation: Operation): JsonRecord {
  switch (operation.action) {
    case 'placeOrder':
      return omitUndefined({
        action: operation.action,
        contract: normalizeContract(operation.contract),
        order: normalizeOrder(operation.order),
        tpsl: operation.tpsl,
      })
    case 'modifyOrder':
      return {
        action: operation.action,
        orderId: operation.orderId,
        changes: normalizeOrder(operation.changes),
      }
    case 'closePosition':
      return omitUndefined({
        action: operation.action,
        contract: normalizeContract(operation.contract),
        quantity: decimalField(operation.quantity),
      })
    case 'cancelOrder':
      return omitUndefined({
        action: operation.action,
        orderId: operation.orderId,
        hasOrderCancel: operation.orderCancel != null,
      })
    case 'syncOrders':
      return { action: operation.action }
  }
}

function normalizeOrder(order: Partial<Order>): JsonRecord {
  return omitUndefined({
    action: order.action,
    orderType: order.orderType,
    tif: order.tif,
    orderId: order.orderId && order.orderId !== 0 ? order.orderId : undefined,
    parentId: order.parentId && order.parentId !== 0 ? order.parentId : undefined,
    ocaGroup: order.ocaGroup,
    outsideRth: order.outsideRth === true ? true : undefined,
    totalQuantity: decimalField(order.totalQuantity),
    cashQty: decimalField(order.cashQty),
    lmtPrice: decimalField(order.lmtPrice),
    auxPrice: decimalField(order.auxPrice),
    trailStopPrice: decimalField(order.trailStopPrice),
    trailingPercent: decimalField(order.trailingPercent),
  })
}

function normalizeContract(contract: { aliceId?: string; symbol?: string; secType?: string; exchange?: string; currency?: string; conId?: number }): JsonRecord {
  return omitUndefined({
    aliceId: contract.aliceId,
    symbol: contract.symbol,
    secType: contract.secType,
    exchange: contract.exchange,
    currency: contract.currency,
    conId: contract.conId && contract.conId !== 0 ? contract.conId : undefined,
  })
}

function normalizeAccountInfo(account: Readonly<Partial<AccountInfo>>): JsonRecord {
  const keys = [
    'baseCurrency',
    'netLiquidation',
    'totalCashValue',
    'unrealizedPnL',
    'realizedPnL',
    'buyingPower',
    'initMarginReq',
    'maintMarginReq',
  ] as const
  return omitUndefined({
    values: Object.fromEntries(keys.flatMap((key) => account[key] == null ? [] : [[key, account[key]]])),
    fieldTypes: fieldTypes(account, keys),
  })
}

function normalizePosition(position: Position): JsonRecord {
  return omitUndefined({
    contract: normalizeContract(position.contract),
    currency: position.currency,
    side: position.side,
    quantity: decimalField(position.quantity),
    avgCost: position.avgCost,
    marketPrice: position.marketPrice,
    marketValue: position.marketValue,
    unrealizedPnL: position.unrealizedPnL,
    realizedPnL: position.realizedPnL,
    fieldTypes: fieldTypes(position, [
      'avgCost',
      'marketPrice',
      'marketValue',
      'unrealizedPnL',
      'realizedPnL',
    ]),
  })
}

function normalizeOpenOrder(order: OpenOrder): JsonRecord {
  return omitUndefined({
    contract: normalizeContract(order.contract),
    order: normalizeOrder(order.order),
    orderStateStatus: order.orderState.status,
    avgFillPrice: order.avgFillPrice,
  })
}

function normalizeSnapshot(snapshot: UTASnapshot | null): JsonRecord | null {
  if (!snapshot) return null
  return {
    accountId: snapshot.accountId,
    timestamp: snapshot.timestamp,
    trigger: snapshot.trigger,
    account: {
      values: snapshot.account,
      fieldTypes: fieldTypes(snapshot.account, [
        'baseCurrency',
        'netLiquidation',
        'totalCashValue',
        'unrealizedPnL',
        'realizedPnL',
        'buyingPower',
        'initMarginReq',
        'maintMarginReq',
      ]),
    },
    positions: snapshot.positions.map((position) => ({
      ...position,
      fieldTypes: fieldTypes(position, [
        'quantity',
        'avgCost',
        'marketPrice',
        'marketValue',
        'unrealizedPnL',
        'realizedPnL',
      ]),
    })),
    openOrders: snapshot.openOrders.map((order) => ({
      ...order,
      fieldTypes: fieldTypes(order, [
        'orderId',
        'aliceId',
        'totalQuantity',
        'limitPrice',
        'avgFillPrice',
      ]),
    })),
    health: snapshot.health,
    headCommit: snapshot.headCommit,
    pendingCommits: snapshot.pendingCommits,
  }
}

function decimalField(value: unknown): JsonRecord | undefined {
  if (value == null) return undefined
  if (isDecimalLike(value)) {
    if (value.equals(UNSET_DECIMAL)) return undefined
    return {
      value: value.toFixed(),
      valueType: 'Decimal',
      jsonType: typeof JSON.parse(JSON.stringify(value)),
    }
  }
  return {
    value: String(value),
    valueType: typeof value,
    jsonType: typeof JSON.parse(JSON.stringify(value)),
  }
}

function isDecimalLike(value: unknown): value is Decimal {
  return Decimal.isDecimal(value)
}

function fieldTypes<T extends object>(record: T, keys: readonly (keyof T)[]): JsonRecord {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = record[key]
      return value == null ? [] : [[String(key), Decimal.isDecimal(value) ? 'Decimal' : typeof value]]
    }),
  )
}

function omitUndefined(record: JsonRecord): JsonRecord {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined))
}

async function captureError(fn: () => unknown | Promise<unknown>): Promise<JsonRecord> {
  try {
    await fn()
    return { threw: false }
  } catch (error) {
    return {
      threw: true,
      name: error instanceof Error ? error.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
    }
  }
}

async function writeJson(fileName: string, data: unknown): Promise<void> {
  await writeFile(join(outDir, fileName), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
