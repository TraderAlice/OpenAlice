import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createAutoTradingScheduler } from './scheduler.js'
import { createEventLog } from '../../core/event-log.js'
import { ConnectorCenter } from '../../core/connector-center.js'
import { createMemoryNotificationsStore } from '../../core/notifications-store.js'
import type { INotificationsStore } from '../../core/notifications-store.js'

function tempDir(): string {
  return join(tmpdir(), `auto-trading-test-${randomUUID()}`)
}

function freshTimestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function staleTimestamp(): string {
  return new Date(Date.now() - 20 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

async function writeSnapshot(path: string, data: object): Promise<void> {
  await mkdir(join(path, '..'), { recursive: true })
  await writeFile(path, JSON.stringify(data), 'utf-8')
}

async function notifiedTexts(store: INotificationsStore): Promise<string[]> {
  const { entries } = await store.read({ limit: 100 })
  return entries.map((e) => e.text).reverse() // oldest first
}

describe('AutoTradingScheduler', () => {
  let dir: string
  let snapshotPath: string
  let store: INotificationsStore
  let connectorCenter: ConnectorCenter
  let eventLog: ReturnType<typeof createEventLog> extends Promise<infer T> ? T : never

  beforeEach(async () => {
    dir = tempDir()
    await mkdir(dir, { recursive: true })
    snapshotPath = join(dir, 'market-snapshot.json')
    store = createMemoryNotificationsStore()
    connectorCenter = new ConnectorCenter({ notificationsStore: store })
    eventLog = await createEventLog({ logPath: join(dir, 'events.jsonl') })
  })

  function makeScheduler() {
    return createAutoTradingScheduler({
      config: {
        enabled: false, // start disabled; use runNow() in tests
        tickEvery: '15m',
        marketSnapshotPath: snapshotPath,
      },
      connectorCenter,
      eventLog,
    })
  }

  it('notifies once when a symbol transitions to all_clear=true', async () => {
    await writeSnapshot(snapshotPath, {
      updated_at: freshTimestamp(),
      signals: {
        'BTC/USDT:USDT': { all_clear: true, price: 65000, suggested_stop_loss: 63700 },
      },
    })
    const scheduler = makeScheduler()
    await scheduler.runNow()
    const texts = await notifiedTexts(store)
    expect(texts).toHaveLength(1)
    expect(texts[0]).toContain('BTC/USDT:USDT')
    expect(texts[0]).toContain('65000')
    expect(texts[0]).toContain('63700')
  })

  it('does not re-notify when a symbol stays all_clear=true across ticks', async () => {
    const snap = {
      updated_at: freshTimestamp(),
      signals: { 'BTC/USDT:USDT': { all_clear: true, price: 65000 } },
    }
    await writeSnapshot(snapshotPath, snap)
    const scheduler = makeScheduler()
    await scheduler.runNow()
    await scheduler.runNow()
    const texts = await notifiedTexts(store)
    expect(texts).toHaveLength(1)
  })

  it('re-notifies when a symbol returns to all_clear=true after going false', async () => {
    const scheduler = makeScheduler()

    await writeSnapshot(snapshotPath, {
      updated_at: freshTimestamp(),
      signals: { 'BTC/USDT:USDT': { all_clear: true, price: 65000 } },
    })
    await scheduler.runNow()

    await writeSnapshot(snapshotPath, {
      updated_at: freshTimestamp(),
      signals: { 'BTC/USDT:USDT': { all_clear: false, price: 64000 } },
    })
    await scheduler.runNow()

    await writeSnapshot(snapshotPath, {
      updated_at: freshTimestamp(),
      signals: { 'BTC/USDT:USDT': { all_clear: true, price: 65500 } },
    })
    await scheduler.runNow()

    const texts = await notifiedTexts(store)
    expect(texts).toHaveLength(2)
  })

  it('does not notify when snapshot is stale (> 15 min old)', async () => {
    await writeSnapshot(snapshotPath, {
      updated_at: staleTimestamp(),
      signals: { 'BTC/USDT:USDT': { all_clear: true, price: 65000 } },
    })
    const scheduler = makeScheduler()
    await scheduler.runNow()
    const texts = await notifiedTexts(store)
    expect(texts).toHaveLength(0)
  })

  it('does not notify when CIRCUIT_BREAKER=HALT', async () => {
    await writeSnapshot(snapshotPath, {
      updated_at: freshTimestamp(),
      CIRCUIT_BREAKER: 'HALT',
      signals: { 'BTC/USDT:USDT': { all_clear: true, price: 65000 } },
    })
    const scheduler = makeScheduler()
    await scheduler.runNow()
    const texts = await notifiedTexts(store)
    expect(texts).toHaveLength(0)
  })

  it('does not notify when snapshot file does not exist', async () => {
    const scheduler = makeScheduler()
    await scheduler.runNow() // snapshotPath never written
    const texts = await notifiedTexts(store)
    expect(texts).toHaveLength(0)
  })

  it('handles missing price gracefully (shows 0 instead of undefined)', async () => {
    await writeSnapshot(snapshotPath, {
      updated_at: freshTimestamp(),
      signals: { 'ETH/USDT:USDT': { all_clear: true } }, // no price field
    })
    const scheduler = makeScheduler()
    await scheduler.runNow()
    const texts = await notifiedTexts(store)
    expect(texts).toHaveLength(1)
    expect(texts[0]).not.toContain('undefined')
  })
})
