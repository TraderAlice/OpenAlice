import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFile, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import Decimal from 'decimal.js'
import { Order, OrderState } from '@traderalice/ibkr'
import { UnifiedTradingAccount } from '../UnifiedTradingAccount.js'
import type { UnifiedTradingAccountOptions } from '../UnifiedTradingAccount.js'
import { MockBroker, makeContract, makePosition, makeOpenOrder } from '../brokers/mock/index.js'
import { UTAManager } from '../uta-manager.js'
import { createEventLog, type EventLog } from '../../../core/event-log.js'
import { createListenerRegistry, type ListenerRegistry } from '../../../core/listener-registry.js'
import { createCronEngine, type CronEngine } from '../../../task/cron/engine.js'
import { buildSnapshot } from './builder.js'
import { createSnapshotStore, type SnapshotStore } from './store.js'
import { createSnapshotService, type SnapshotService } from './service.js'
import { createSnapshotScheduler, type SnapshotScheduler } from './scheduler.js'
import type { UTASnapshot, SnapshotIndex } from './types.js'
import '../contract-ext.js'

// ==================== Helpers ====================

function createUTA(broker?: MockBroker, options?: UnifiedTradingAccountOptions) {
  const b = broker ?? new MockBroker()
  const uta = new UnifiedTradingAccount(b, options)
  return { uta, broker: b }
}

function tempDir(): string {
  return join(tmpdir(), `snapshot-test-${randomUUID()}`)
}

function tempPath(ext: string): string {
  return join(tmpdir(), `snapshot-test-${randomUUID()}.${ext}`)
}

function makeSubmittedOrder(symbol = 'AAPL'): ReturnType<typeof makeOpenOrder> {
  const contract = makeContract({ symbol, aliceId: `mock-paper|${symbol}` })
  const order = new Order()
  order.orderId = 42
  order.action = 'BUY'
  order.orderType = 'LMT'
  order.totalQuantity = new Decimal(5)
  order.lmtPrice = new Decimal(150)
  const orderState = new OrderState()
  orderState.status = 'Submitted'
  return { contract, order, orderState }
}

function makeFilledOrder(symbol = 'AAPL'): ReturnType<typeof makeOpenOrder> {
  const o = makeSubmittedOrder(symbol)
  o.orderState.status = 'Filled'
  return o
}

/** Flush microtasks so fire-and-forget callbacks complete */
async function flush() { await vi.advanceTimersByTimeAsync(0) }

// ==================== Builder Tests ====================

describe('Snapshot Builder', () => {
  let uta: UnifiedTradingAccount
  let broker: MockBroker

  beforeEach(() => {
    ({ uta, broker } = createUTA())
  })

  // #1
  it('builds complete snapshot from healthy UTA', async () => {
    broker.setPositions([makePosition()])
    const snap = await buildSnapshot(uta, 'manual')
    expect(snap).not.toBeNull()

    expect(snap!.accountId).toBe(broker.id)
    expect(snap!.trigger).toBe('manual')
    expect(snap!.health).toBe('healthy')
    expect(snap!.positions).toHaveLength(1)
    expect(snap!.account.netLiquidation).toBeTruthy()
    expect(snap!.timestamp).toBeTruthy()
  })

  // #2
  it('stores all financial values as strings', async () => {
    const snap = await buildSnapshot(uta, 'manual')
    expect(snap).not.toBeNull()

    expect(typeof snap!.account.netLiquidation).toBe('string')
    expect(typeof snap!.account.totalCashValue).toBe('string')
    expect(typeof snap!.account.unrealizedPnL).toBe('string')
    expect(typeof snap!.account.realizedPnL).toBe('string')
  })

  // #3
  it('positions use aliceId, not full contract', async () => {
    const pos = makePosition({ contract: makeContract({ symbol: 'TSLA', aliceId: 'mock-paper|TSLA' }) })
    broker.setPositions([pos])
    const snap = await buildSnapshot(uta, 'manual')
    expect(snap).not.toBeNull()

    expect(snap!.positions[0].aliceId).toBe(`${broker.id}|TSLA`)
    expect(snap!.positions[0]).not.toHaveProperty('contract')
    expect(typeof snap!.positions[0].quantity).toBe('string')
    expect(typeof snap!.positions[0].avgCost).toBe('string')
  })

  // #4
  it('only includes Submitted/PreSubmitted orders', async () => {
    const contract = makeContract({ symbol: 'AAPL' })
    broker.setQuote('AAPL', 150)

    const order = new Order()
    order.action = 'BUY'
    order.orderType = 'LMT'
    order.totalQuantity = new Decimal(5)
    order.lmtPrice = new Decimal(140)
    order.tif = 'DAY'

    uta.git.add({ action: 'placeOrder', contract, order })
    uta.git.commit('buy limit')
    await uta.push()

    const snap = await buildSnapshot(uta, 'manual')
    expect(snap).not.toBeNull()

    expect(snap!.openOrders).toHaveLength(1)
    expect(snap!.openOrders[0].status).toBe('Submitted')
    expect(snap!.openOrders[0].orderType).toBe('LMT')
  })

  // #5
  it('returns null when UTA is disabled', async () => {
    broker.setPositions([makePosition()])
    ;(uta as any)._disabled = true

    const snap = await buildSnapshot(uta, 'scheduled')
    expect(snap).toBeNull()
  })

  // #6
  it('returns null when UTA is offline', async () => {
    ;(uta as any)._consecutiveFailures = 6

    const snap = await buildSnapshot(uta, 'scheduled')
    expect(snap).toBeNull()
  })

  // #7
  it('returns null when broker query throws', async () => {
    broker.setFailMode(3)

    const snap = await buildSnapshot(uta, 'manual')
    expect(snap).toBeNull()
  })

  // #8
  it('captures headCommit and pendingCommits from git status', async () => {
    // No commits yet
    let snap = await buildSnapshot(uta, 'manual')
    expect(snap).not.toBeNull()
    expect(snap!.headCommit).toBeNull()
    expect(snap!.pendingCommits).toEqual([])

    // Stage and commit (but don't push)
    uta.git.add({ action: 'placeOrder', contract: makeContract(), order: new Order() })
    const { hash } = uta.git.commit('test order')

    snap = await buildSnapshot(uta, 'manual')
    expect(snap).not.toBeNull()
    expect(snap!.pendingCommits).toEqual([hash])
    expect(snap!.headCommit).toBeNull() // not pushed yet
  })

  // #9
  it('passes trigger field correctly', async () => {
    for (const trigger of ['scheduled', 'post-push', 'post-reject', 'manual'] as const) {
      const snap = await buildSnapshot(uta, trigger)
      expect(snap).not.toBeNull()
      expect(snap!.trigger).toBe(trigger)
    }
  })

  // #10
  it('omits optional fields when not available', async () => {
    broker.setAccountInfo({ buyingPower: undefined, initMarginReq: undefined })
    const snap = await buildSnapshot(uta, 'manual')
    expect(snap).not.toBeNull()

    expect(snap!.account.buyingPower).toBeUndefined()
    expect(snap!.account.initMarginReq).toBeUndefined()
    expect(snap!.account.maintMarginReq).toBeUndefined()
  })
})

// ==================== Store Tests ====================

describe('Snapshot Store', () => {
  let store: SnapshotStore
  let dir: string

  function makeSnapshot(overrides: Partial<UTASnapshot> = {}): UTASnapshot {
    return {
      accountId: 'test-acc',
      timestamp: new Date().toISOString(),
      trigger: 'manual',
      account: {
        baseCurrency: 'USD',
        netLiquidation: '100000',
        totalCashValue: '90000',
        unrealizedPnL: '5000',
        realizedPnL: '1000',
      },
      positions: [],
      openOrders: [],
      health: 'healthy',
      headCommit: null,
      pendingCommits: [],
      ...overrides,
    }
  }

  beforeEach(() => {
    dir = tempDir()
    store = createSnapshotStore('test-acc', { baseDir: dir })
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  // #11
  it('creates index and first chunk on first write', async () => {
    const snap = makeSnapshot()
    await store.append(snap)

    const results = await store.readRange({ limit: 10 })
    expect(results).toHaveLength(1)
    expect(results[0].accountId).toBe(snap.accountId)
  })

  // #12
  it('rolls over to new chunk after 50 snapshots', async () => {
    // Write 51 snapshots
    for (let i = 0; i < 51; i++) {
      await store.append(makeSnapshot({
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      }))
    }

    const all = await store.readRange()
    expect(all).toHaveLength(51)
  })

  // #13
  it('maintains correct index metadata', async () => {
    const t1 = '2025-01-01T00:00:00.000Z'
    const t2 = '2025-01-01T00:01:00.000Z'
    const t3 = '2025-01-01T00:02:00.000Z'

    await store.append(makeSnapshot({ timestamp: t1 }))
    await store.append(makeSnapshot({ timestamp: t2 }))
    await store.append(makeSnapshot({ timestamp: t3 }))

    const results = await store.readRange()
    expect(results).toHaveLength(3)
    // Newest first
    expect(results[0].timestamp).toBe(t3)
    expect(results[2].timestamp).toBe(t1)
  })

  // #14
  it('returns snapshots in reverse chronological order', async () => {
    const timestamps = ['2025-01-01T00:00:00Z', '2025-01-01T01:00:00Z', '2025-01-01T02:00:00Z']
    for (const ts of timestamps) {
      await store.append(makeSnapshot({ timestamp: ts }))
    }

    const results = await store.readRange()
    expect(results[0].timestamp).toBe('2025-01-01T02:00:00Z')
    expect(results[2].timestamp).toBe('2025-01-01T00:00:00Z')
  })

  // #15
  it('respects limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await store.append(makeSnapshot({ timestamp: new Date(Date.now() + i * 1000).toISOString() }))
    }

    const results = await store.readRange({ limit: 3 })
    expect(results).toHaveLength(3)
  })

  // #16
  it('filters by time range', async () => {
    await store.append(makeSnapshot({ timestamp: '2025-01-01T00:00:00Z' }))
    await store.append(makeSnapshot({ timestamp: '2025-01-02T00:00:00Z' }))
    await store.append(makeSnapshot({ timestamp: '2025-01-03T00:00:00Z' }))

    const results = await store.readRange({
      startTime: '2025-01-01T12:00:00Z',
      endTime: '2025-01-02T12:00:00Z',
    })

    expect(results).toHaveLength(1)
    expect(results[0].timestamp).toBe('2025-01-02T00:00:00Z')
  })

  // #17 (verifying correct total across chunk boundary)
  it('reads across multiple chunks correctly', async () => {
    // Write 60 snapshots (chunk 1: 50, chunk 2: 10)
    for (let i = 0; i < 60; i++) {
      await store.append(makeSnapshot({
        timestamp: new Date(Date.now() + i * 1000).toISOString(),
      }))
    }

    const all = await store.readRange()
    expect(all).toHaveLength(60)
  })

  // #18
  it('returns empty array for empty store', async () => {
    const results = await store.readRange()
    expect(results).toEqual([])
  })

  // #19
  it('handles concurrent appends safely via write lock', async () => {
    // Fire two appends concurrently
    const p1 = store.append(makeSnapshot({ timestamp: '2025-01-01T00:00:01Z' }))
    const p2 = store.append(makeSnapshot({ timestamp: '2025-01-01T00:00:02Z' }))
    await Promise.all([p1, p2])

    const results = await store.readRange()
    expect(results).toHaveLength(2)
  })
})

// ==================== Service Tests ====================

describe('Snapshot Service', () => {
  let manager: UTAManager
  let eventLog: EventLog
  let service: SnapshotService
  let serviceDir: string

  beforeEach(async () => {
    manager = new UTAManager()
    const logPath = tempPath('jsonl')
    eventLog = await createEventLog({ logPath })
    serviceDir = tempDir()

    const broker = new MockBroker({ id: 'acc1', label: 'Test' })
    const uta = new UnifiedTradingAccount(broker)
    manager.add(uta)

    service = createSnapshotService({ utaManager: manager, eventLog, baseDir: serviceDir })
  })

  afterEach(async () => {
    await eventLog._resetForTest()
    await rm(serviceDir, { recursive: true, force: true })
  })

  // #20
  it('takes snapshot and logs event', async () => {
    const snap = await service.takeSnapshot('acc1', 'manual')

    expect(snap).not.toBeNull()
    expect(snap!.accountId).toBe('acc1')
    expect(snap!.trigger).toBe('manual')

    // Check eventLog has snapshot.taken
    const events = eventLog.recent({ type: 'snapshot.taken' })
    expect(events).toHaveLength(1)
    expect(events[0].payload).toMatchObject({
      accountId: 'acc1',
      trigger: 'manual',
    })
  })

  // #21
  it('returns null for unknown account', async () => {
    const snap = await service.takeSnapshot('nonexistent', 'manual')
    expect(snap).toBeNull()
  })

  // #22
  it('returns null and logs snapshot.skipped when builder fails', async () => {
    const uta = manager.get('acc1')!
    vi.spyOn(uta, 'getAccount').mockRejectedValue(new Error('network timeout'))

    const snap = await service.takeSnapshot('acc1', 'scheduled')

    expect(snap).toBeNull()
    // Should log skipped, not store anything
    const skipped = eventLog.recent({ type: 'snapshot.skipped' })
    expect(skipped).toHaveLength(1)
    expect(skipped[0].payload).toMatchObject({ accountId: 'acc1', reason: 'no-data' })
  })

  // #23
  it('takeAllSnapshots captures all accounts', async () => {
    const broker2 = new MockBroker({ id: 'acc2', label: 'Test2' })
    manager.add(new UnifiedTradingAccount(broker2))

    await service.takeAllSnapshots('scheduled')

    const events = eventLog.recent({ type: 'snapshot.taken' })
    expect(events).toHaveLength(2)
    const ids = events.map(e => (e.payload as any).accountId)
    expect(ids).toContain('acc1')
    expect(ids).toContain('acc2')
  })

  // #24
  it('takeAllSnapshots: single failure does not affect others', async () => {
    const broker2 = new MockBroker({ id: 'acc2', label: 'Failing' })
    const uta2 = new UnifiedTradingAccount(broker2)
    manager.add(uta2)
    // Make uta2 disabled — builder returns null, not stored
    ;(uta2 as any)._disabled = true

    await service.takeAllSnapshots('scheduled')

    // Only acc1 gets stored; acc2 is skipped (disabled → null)
    const taken = eventLog.recent({ type: 'snapshot.taken' })
    expect(taken).toHaveLength(1)
    expect((taken[0].payload as any).accountId).toBe('acc1')

    // acc2 should be skipped
    const skipped = eventLog.recent({ type: 'snapshot.skipped' })
    expect(skipped.length).toBeGreaterThanOrEqual(1)
  })

  // #25
  it('getRecent delegates to store', async () => {
    // Take a snapshot first
    await service.takeSnapshot('acc1', 'manual')
    await service.takeSnapshot('acc1', 'scheduled')

    const recent = await service.getRecent('acc1', 1)
    expect(recent).toHaveLength(1)
  })
})

// ==================== Scheduler Tests ====================

describe('Snapshot Scheduler', () => {
  let eventLog: EventLog
  let listenerRegistry: ListenerRegistry
  let cronEngine: CronEngine
  let scheduler: SnapshotScheduler
  let mockService: SnapshotService

  beforeEach(async () => {
    const logPath = tempPath('jsonl')
    const storePath = tempPath('json')
    eventLog = await createEventLog({ logPath })
    listenerRegistry = createListenerRegistry(eventLog)
    await listenerRegistry.start()
    cronEngine = createCronEngine({ registry: listenerRegistry, storePath })
    await cronEngine.start()

    mockService = {
      takeSnapshot: vi.fn(async () => null),
      takeAllSnapshots: vi.fn(async () => {}),
      getRecent: vi.fn(async () => []),
      deleteSnapshot: vi.fn(async () => false),
    }

    scheduler = createSnapshotScheduler({
      snapshotService: mockService,
      cronEngine,
      registry: listenerRegistry,
      config: { enabled: true, every: '15m' },
    })
  })

  afterEach(async () => {
    scheduler?.stop()
    cronEngine.stop()
    await listenerRegistry.stop()
    await eventLog._resetForTest()
  })

  // #26
  it('registers __snapshot__ cron job on start', async () => {
    await scheduler.start()

    const jobs = cronEngine.list()
    const snapshotJob = jobs.find(j => j.name === '__snapshot__')
    expect(snapshotJob).toBeDefined()
    expect(snapshotJob!.enabled).toBe(true)
  })

  // #27
  it('reuses existing job on repeated start (idempotent)', async () => {
    await scheduler.start()
    const jobsBefore = cronEngine.list().filter(j => j.name === '__snapshot__')

    await scheduler.start()
    const jobsAfter = cronEngine.list().filter(j => j.name === '__snapshot__')

    expect(jobsBefore).toHaveLength(1)
    expect(jobsAfter).toHaveLength(1)
    expect(jobsBefore[0].id).toBe(jobsAfter[0].id)
  })

  // #28
  it('fires takeAllSnapshots on cron.fire event', async () => {
    await scheduler.start()

    // Trigger the cron job manually
    const job = cronEngine.list().find(j => j.name === '__snapshot__')!
    await cronEngine.runNow(job.id)

    // Give the async handler time to complete
    await new Promise(r => setTimeout(r, 50))

    expect(mockService.takeAllSnapshots).toHaveBeenCalledWith('scheduled')
  })

  // #29
  it('ignores cron.fire for other jobs', async () => {
    await scheduler.start()

    // Create a different job and fire it
    const otherId = await cronEngine.add({
      name: 'other-job',
      schedule: { kind: 'every', every: '1h' },
      payload: '',
    })
    await cronEngine.runNow(otherId)

    await new Promise(r => setTimeout(r, 50))

    expect(mockService.takeAllSnapshots).not.toHaveBeenCalled()
  })

  // #30
  it('processing lock prevents concurrent fires', async () => {
    // Make takeAllSnapshots slow
    let resolveFirst: () => void
    const firstCall = new Promise<void>(r => { resolveFirst = r })
    ;(mockService.takeAllSnapshots as any).mockImplementationOnce(async () => {
      await firstCall
    })

    await scheduler.start()
    const job = cronEngine.list().find(j => j.name === '__snapshot__')!

    // Fire twice quickly
    await cronEngine.runNow(job.id)
    await new Promise(r => setTimeout(r, 10))
    await cronEngine.runNow(job.id)
    await new Promise(r => setTimeout(r, 10))

    // Second fire should be skipped (processing=true)
    resolveFirst!()
    await new Promise(r => setTimeout(r, 50))

    expect(mockService.takeAllSnapshots).toHaveBeenCalledTimes(1)
  })

  // #31
  it('stop() unsubscribes from events', async () => {
    await scheduler.start()
    scheduler.stop()

    const job = cronEngine.list().find(j => j.name === '__snapshot__')!
    await cronEngine.runNow(job.id)
    await new Promise(r => setTimeout(r, 50))

    expect(mockService.takeAllSnapshots).not.toHaveBeenCalled()
  })
})

// ==================== UTA Hook Tests ====================

describe('UTA — post-push/reject hooks', () => {
  // #32
  it('calls onPostPush after successful push', async () => {
    const onPostPush = vi.fn()
    const { uta, broker } = createUTA(undefined, { onPostPush })

    broker.setQuote('AAPL', 150)
    uta.git.add({ action: 'placeOrder', contract: makeContract(), order: new Order() })
    uta.git.commit('buy')
    await uta.push()

    // fire-and-forget, but should be called
    await new Promise(r => setTimeout(r, 10))
    expect(onPostPush).toHaveBeenCalledWith(uta.id)
  })

  // #33
  it('calls onPostReject after reject', async () => {
    const onPostReject = vi.fn()
    const { uta } = createUTA(undefined, { onPostReject })

    uta.git.add({ action: 'placeOrder', contract: makeContract(), order: new Order() })
    uta.git.commit('buy')
    await uta.reject('changed mind')

    await new Promise(r => setTimeout(r, 10))
    expect(onPostReject).toHaveBeenCalledWith(uta.id)
  })

  // #34
  it('does not call hook when push fails (disabled)', async () => {
    const onPostPush = vi.fn()
    const { uta } = createUTA(undefined, { onPostPush })
    ;(uta as any)._disabled = true

    uta.git.add({ action: 'placeOrder', contract: makeContract(), order: new Order() })
    uta.git.commit('buy')

    await expect(uta.push()).rejects.toThrow()
    expect(onPostPush).not.toHaveBeenCalled()
  })

  // #35
  it('hook error does not affect push return value', async () => {
    const onPostPush = vi.fn().mockRejectedValue(new Error('hook failed'))
    const { uta } = createUTA(undefined, { onPostPush })

    uta.git.add({ action: 'placeOrder', contract: makeContract(), order: new Order() })
    uta.git.commit('buy')
    const result = await uta.push()

    expect(result).toBeDefined()
    expect(result.hash).toBeTruthy()
  })
})
