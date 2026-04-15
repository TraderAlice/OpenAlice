import { describe, it, expect, beforeEach } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createEventLog, type EventLog, type EventLogEntry } from './event-log.js'

/** Each test gets its own temp file to avoid interference. */
function tempLogPath(): string {
  return join(tmpdir(), `event-log-test-${randomUUID()}.jsonl`)
}

let log: EventLog

beforeEach(async () => {
  const logPath = tempLogPath()
  log = await createEventLog({ logPath })
})

describe('event-log', () => {
  // ==================== append + read ====================

  describe('append / read', () => {
    it('should append and read back events', async () => {
      await log.append('trade.open', { symbol: 'BTC/USD', side: 'buy' })
      await log.append('trade.close', { symbol: 'BTC/USD', pnl: 42 })

      const entries = await log.read()
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({
        seq: 1,
        type: 'trade.open',
        payload: { symbol: 'BTC/USD', side: 'buy' },
      })
      expect(entries[1]).toMatchObject({
        seq: 2,
        type: 'trade.close',
        payload: { symbol: 'BTC/USD', pnl: 42 },
      })
    })

    it('should assign monotonic seq numbers', async () => {
      await log.append('a', {})
      await log.append('b', {})
      await log.append('c', {})

      const entries = await log.read()
      expect(entries.map((e) => e.seq)).toEqual([1, 2, 3])
    })

    it('should include reasonable timestamps', async () => {
      const before = Date.now()
      const entry = await log.append('test', { n: 1 })
      const after = Date.now()

      expect(entry.ts).toBeGreaterThanOrEqual(before)
      expect(entry.ts).toBeLessThanOrEqual(after)
    })

    it('should return the full entry from append', async () => {
      const entry = await log.append('ping', { value: 'pong' })

      expect(entry.seq).toBe(1)
      expect(entry.type).toBe('ping')
      expect(entry.payload).toEqual({ value: 'pong' })
      expect(typeof entry.ts).toBe('number')
    })
  })

  // ==================== read filtering ====================

  describe('read filtering', () => {
    it('should filter by afterSeq', async () => {
      await log.append('a', { n: 1 })
      await log.append('b', { n: 2 })
      await log.append('c', { n: 3 })

      const entries = await log.read({ afterSeq: 1 })
      expect(entries).toHaveLength(2)
      expect(entries[0].seq).toBe(2)
      expect(entries[1].seq).toBe(3)
    })

    it('should filter by type', async () => {
      await log.append('trade.open', { n: 1 })
      await log.append('heartbeat', { n: 2 })
      await log.append('trade.open', { n: 3 })
      await log.append('trade.close', { n: 4 })

      const entries = await log.read({ type: 'trade.open' })
      expect(entries).toHaveLength(2)
      expect(entries.every((e) => e.type === 'trade.open')).toBe(true)
    })

    it('should respect limit', async () => {
      for (let i = 0; i < 10; i++) {
        await log.append('tick', { i })
      }

      const entries = await log.read({ limit: 3 })
      expect(entries).toHaveLength(3)
      expect(entries[0].seq).toBe(1)
      expect(entries[2].seq).toBe(3)
    })

    it('should combine afterSeq + type + limit', async () => {
      await log.append('a', {})  // seq 1
      await log.append('b', {})  // seq 2
      await log.append('a', {})  // seq 3
      await log.append('a', {})  // seq 4
      await log.append('b', {})  // seq 5
      await log.append('a', {})  // seq 6

      const entries = await log.read({ afterSeq: 2, type: 'a', limit: 2 })
      expect(entries).toHaveLength(2)
      expect(entries[0].seq).toBe(3)
      expect(entries[1].seq).toBe(4)
    })

    it('should return empty array when no events match', async () => {
      await log.append('a', {})

      const entries = await log.read({ type: 'nonexistent' })
      expect(entries).toHaveLength(0)
    })
  })

  // ==================== recent (memory buffer) ====================

  describe('recent', () => {
    it('should return same entries as read for small sets', async () => {
      await log.append('a', { n: 1 })
      await log.append('b', { n: 2 })
      await log.append('c', { n: 3 })

      const fromDisk = await log.read()
      const fromMem = log.recent()

      expect(fromMem).toHaveLength(3)
      expect(fromMem.map((e) => e.seq)).toEqual(fromDisk.map((e) => e.seq))
    })

    it('should filter by afterSeq', async () => {
      await log.append('a', {})
      await log.append('b', {})
      await log.append('c', {})

      const entries = log.recent({ afterSeq: 2 })
      expect(entries).toHaveLength(1)
      expect(entries[0].seq).toBe(3)
    })

    it('should filter by type', async () => {
      await log.append('trade.open', {})
      await log.append('heartbeat', {})
      await log.append('trade.open', {})

      const entries = log.recent({ type: 'trade.open' })
      expect(entries).toHaveLength(2)
    })

    it('should respect limit', async () => {
      for (let i = 0; i < 10; i++) {
        await log.append('tick', { i })
      }

      const entries = log.recent({ limit: 3 })
      expect(entries).toHaveLength(3)
      expect(entries[0].seq).toBe(1)
    })

    it('should combine afterSeq + type + limit', async () => {
      await log.append('a', {})  // seq 1
      await log.append('b', {})  // seq 2
      await log.append('a', {})  // seq 3
      await log.append('a', {})  // seq 4

      const entries = log.recent({ afterSeq: 1, type: 'a', limit: 1 })
      expect(entries).toHaveLength(1)
      expect(entries[0].seq).toBe(3)
    })

    it('should return empty for no matches', async () => {
      await log.append('a', {})
      expect(log.recent({ type: 'z' })).toHaveLength(0)
    })
  })

  // ==================== ring buffer truncation ====================

  describe('ring buffer', () => {
    it('should truncate buffer at bufferSize', async () => {
      const logPath = tempLogPath()
      const smallLog = await createEventLog({ logPath, bufferSize: 5 })

      for (let i = 0; i < 10; i++) {
        await smallLog.append('tick', { i })
      }

      // Memory only has last 5
      const recent = smallLog.recent()
      expect(recent).toHaveLength(5)
      expect(recent[0].seq).toBe(6)
      expect(recent[4].seq).toBe(10)

      // Disk has all 10
      const all = await smallLog.read()
      expect(all).toHaveLength(10)

      await smallLog._resetForTest()
    })

    it('should recover buffer from disk on restart', async () => {
      const logPath = tempLogPath()
      const log1 = await createEventLog({ logPath, bufferSize: 3 })

      for (let i = 0; i < 7; i++) {
        await log1.append('tick', { i })
      }
      await log1.close()

      // Re-open — buffer should have last 3 entries
      const log2 = await createEventLog({ logPath, bufferSize: 3 })

      const recent = log2.recent()
      expect(recent).toHaveLength(3)
      expect(recent[0].seq).toBe(5)
      expect(recent[2].seq).toBe(7)

      // New appends continue from seq 7
      const entry = await log2.append('new', {})
      expect(entry.seq).toBe(8)

      await log2._resetForTest()
    })
  })

  // ==================== lastSeq ====================

  describe('lastSeq', () => {
    it('should be 0 when empty', () => {
      expect(log.lastSeq()).toBe(0)
    })

    it('should track the latest seq', async () => {
      await log.append('a', {})
      expect(log.lastSeq()).toBe(1)

      await log.append('b', {})
      expect(log.lastSeq()).toBe(2)
    })
  })

  // ==================== subscribe ====================

  describe('subscribe', () => {
    it('should receive new events in real-time', async () => {
      const received: EventLogEntry[] = []
      log.subscribe((entry) => received.push(entry))

      await log.append('a', { n: 1 })
      await log.append('b', { n: 2 })

      expect(received).toHaveLength(2)
      expect(received[0].type).toBe('a')
      expect(received[1].type).toBe('b')
    })

    it('should unsubscribe cleanly', async () => {
      const received: EventLogEntry[] = []
      const unsub = log.subscribe((entry) => received.push(entry))

      await log.append('a', {})
      unsub()
      await log.append('b', {})

      expect(received).toHaveLength(1)
      expect(received[0].type).toBe('a')
    })

    it('should swallow listener errors', async () => {
      log.subscribe(() => { throw new Error('boom') })

      const received: EventLogEntry[] = []
      log.subscribe((entry) => received.push(entry))

      // Should not throw
      await log.append('test', {})
      expect(received).toHaveLength(1)
    })

    it('should support multiple subscribers', async () => {
      const a: EventLogEntry[] = []
      const b: EventLogEntry[] = []

      log.subscribe((entry) => a.push(entry))
      log.subscribe((entry) => b.push(entry))

      await log.append('test', {})

      expect(a).toHaveLength(1)
      expect(b).toHaveLength(1)
    })
  })

  // ==================== subscribeType ====================

  describe('subscribeType', () => {
    it('should only receive events of the subscribed type', async () => {
      const received: EventLogEntry[] = []
      log.subscribeType('trade.open', (entry) => received.push(entry))

      await log.append('trade.open', { n: 1 })
      await log.append('heartbeat', { n: 2 })
      await log.append('trade.open', { n: 3 })

      expect(received).toHaveLength(2)
      expect(received.every((e) => e.type === 'trade.open')).toBe(true)
    })

    it('should unsubscribe cleanly', async () => {
      const received: EventLogEntry[] = []
      const unsub = log.subscribeType('a', (entry) => received.push(entry))

      await log.append('a', {})
      unsub()
      await log.append('a', {})

      expect(received).toHaveLength(1)
    })

    it('should deliver to both global and type subscribers', async () => {
      const global: EventLogEntry[] = []
      const typed: EventLogEntry[] = []

      log.subscribe((entry) => global.push(entry))
      log.subscribeType('a', (entry) => typed.push(entry))

      await log.append('a', {})

      expect(global).toHaveLength(1)
      expect(typed).toHaveLength(1)
    })
  })

  // ==================== recovery ====================

  describe('crash recovery', () => {
    it('should continue seq after re-open', async () => {
      const logPath = tempLogPath()
      const log1 = await createEventLog({ logPath })

      await log1.append('a', {})
      await log1.append('b', {})
      await log1.close()

      // Re-open the same file
      const log2 = await createEventLog({ logPath })
      expect(log2.lastSeq()).toBe(2)

      const entry = await log2.append('c', {})
      expect(entry.seq).toBe(3)

      // Read all 3 entries
      const all = await log2.read()
      expect(all).toHaveLength(3)
      expect(all.map((e) => e.seq)).toEqual([1, 2, 3])

      await log2._resetForTest()
    })

    it('should restore buffer contents on recovery', async () => {
      const logPath = tempLogPath()
      const log1 = await createEventLog({ logPath })

      await log1.append('a', { n: 1 })
      await log1.append('b', { n: 2 })
      await log1.close()

      const log2 = await createEventLog({ logPath })

      // recent() should see the recovered entries
      const recent = log2.recent()
      expect(recent).toHaveLength(2)
      expect(recent[0].type).toBe('a')
      expect(recent[1].type).toBe('b')

      await log2._resetForTest()
    })
  })

  // ==================== edge cases ====================

  describe('edge cases', () => {
    it('should handle empty / nonexistent file', async () => {
      const logPath = tempLogPath()
      const freshLog = await createEventLog({ logPath })

      expect(freshLog.lastSeq()).toBe(0)

      const entries = await freshLog.read()
      expect(entries).toHaveLength(0)

      const recent = freshLog.recent()
      expect(recent).toHaveLength(0)

      await freshLog._resetForTest()
    })

    it('should handle read on file with no matching entries', async () => {
      await log.append('a', {})
      const entries = await log.read({ afterSeq: 999 })
      expect(entries).toHaveLength(0)
    })
  })

  // ==================== typed append validation ====================

  describe('typed append validation', () => {
    it('should accept valid payload for registered event type', async () => {
      const entry = await log.append('cron.fire', {
        jobId: 'j1', jobName: 'test', payload: 'hello',
      })
      expect(entry.type).toBe('cron.fire')
      expect(entry.payload.jobId).toBe('j1')
    })

    it('should reject invalid payload for registered event type', async () => {
      await expect(
        log.append('cron.fire', { wrong: 'shape' } as never),
      ).rejects.toThrow(/Invalid payload/)
    })

    it('should allow unregistered event types without validation', async () => {
      const entry = await log.append('custom.unregistered', { anything: true })
      expect(entry.type).toBe('custom.unregistered')
    })
  })

  // ==================== _resetForTest ====================

  describe('_resetForTest', () => {
    it('should clear seq, buffer, and delete file', async () => {
      await log.append('a', {})
      await log.append('b', {})
      expect(log.lastSeq()).toBe(2)

      await log._resetForTest()

      expect(log.lastSeq()).toBe(0)
      const entries = await log.read()
      expect(entries).toHaveLength(0)
      const recent = log.recent()
      expect(recent).toHaveLength(0)
    })
  })
})
