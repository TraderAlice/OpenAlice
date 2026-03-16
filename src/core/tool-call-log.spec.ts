import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createToolCallLog, type ToolCallLog, type ToolCallRecord } from './tool-call-log.js'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'

// Use a temp directory per test to avoid cross-contamination
let log: ToolCallLog
let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(resolve(tmpdir(), 'tcl-test-'))
  log = await createToolCallLog({ logPath: resolve(tempDir, 'tool-calls.jsonl') })
})

afterEach(async () => {
  await log.close()
  await rm(tempDir, { recursive: true, force: true })
})

/** Helper: complete a tool call round-trip and return the record. */
async function roundTrip(
  id: string,
  name: string,
  input: unknown,
  output: string,
  sessionId = 'sess-1',
): Promise<ToolCallRecord> {
  log.start(id, name, input, sessionId)
  await log.complete(id, output)
  return log.recent({ limit: 1 }).at(-1)!
}

// ==================== start + complete ====================

describe('start + complete', () => {
  it('records a basic tool call', async () => {
    const record = await roundTrip('t1', 'searchContracts', { pattern: 'AAPL' }, '{"results":[]}')
    expect(record).toMatchObject({
      seq: 1,
      id: 't1',
      name: 'searchContracts',
      input: { pattern: 'AAPL' },
      output: '{"results":[]}',
      status: 'ok',
      sessionId: 'sess-1',
    })
    expect(record.durationMs).toBeGreaterThanOrEqual(0)
    expect(record.timestamp).toBeGreaterThan(0)
  })

  it('increments seq monotonically', async () => {
    await roundTrip('t1', 'a', {}, 'ok')
    await roundTrip('t2', 'b', {}, 'ok')
    await roundTrip('t3', 'c', {}, 'ok')
    const records = log.recent()
    expect(records.map(r => r.seq)).toEqual([1, 2, 3])
  })

  it('ignores orphan complete (no matching start)', async () => {
    await log.complete('orphan-id', 'output')
    expect(log.recent()).toHaveLength(0)
    expect(log.lastSeq()).toBe(0)
  })

  it('tracks separate sessions', async () => {
    await roundTrip('t1', 'toolA', {}, 'ok', 'sess-A')
    await roundTrip('t2', 'toolA', {}, 'ok', 'sess-B')
    const records = log.recent()
    expect(records[0].sessionId).toBe('sess-A')
    expect(records[1].sessionId).toBe('sess-B')
  })
})

// ==================== error detection ====================

describe('error detection', () => {
  it('detects JSON error field', async () => {
    const r = await roundTrip('t1', 'tool', {}, '{"error":"Not found"}')
    expect(r.status).toBe('error')
  })

  it('detects "Error:" prefix', async () => {
    const r = await roundTrip('t1', 'tool', {}, 'Error: connection refused')
    expect(r.status).toBe('error')
  })

  it('detects "Error -" prefix', async () => {
    const r = await roundTrip('t1', 'tool', {}, 'Error - timeout')
    expect(r.status).toBe('error')
  })

  it('marks normal output as ok', async () => {
    const r = await roundTrip('t1', 'tool', {}, 'success')
    expect(r.status).toBe('ok')
  })

  it('marks empty output as ok (not error)', async () => {
    const r = await roundTrip('t1', 'tool', {}, '')
    expect(r.status).toBe('ok')
  })

  it('marks JSON without error field as ok', async () => {
    const r = await roundTrip('t1', 'tool', {}, '{"data":"hello"}')
    expect(r.status).toBe('ok')
  })
})

// ==================== flushPending ====================

describe('flushPending', () => {
  it('clears pending calls without persisting', async () => {
    log.start('t1', 'tool', {}, 'sess-1')
    log.start('t2', 'tool', {}, 'sess-1')
    log.flushPending()
    // Completing after flush should be a no-op (orphan)
    await log.complete('t1', 'output')
    await log.complete('t2', 'output')
    expect(log.recent()).toHaveLength(0)
  })
})

// ==================== recent (memory buffer) ====================

describe('recent', () => {
  it('returns all records when no filter', async () => {
    await roundTrip('t1', 'a', {}, 'ok')
    await roundTrip('t2', 'b', {}, 'ok')
    expect(log.recent()).toHaveLength(2)
  })

  it('filters by afterSeq', async () => {
    await roundTrip('t1', 'a', {}, 'ok')
    await roundTrip('t2', 'b', {}, 'ok')
    await roundTrip('t3', 'c', {}, 'ok')
    const results = log.recent({ afterSeq: 1 })
    expect(results.map(r => r.seq)).toEqual([2, 3])
  })

  it('filters by name', async () => {
    await roundTrip('t1', 'alpha', {}, 'ok')
    await roundTrip('t2', 'beta', {}, 'ok')
    await roundTrip('t3', 'alpha', {}, 'ok')
    const results = log.recent({ name: 'alpha' })
    expect(results).toHaveLength(2)
    expect(results.every(r => r.name === 'alpha')).toBe(true)
  })

  it('respects limit', async () => {
    await roundTrip('t1', 'a', {}, 'ok')
    await roundTrip('t2', 'b', {}, 'ok')
    await roundTrip('t3', 'c', {}, 'ok')
    expect(log.recent({ limit: 2 })).toHaveLength(2)
  })

  it('combines afterSeq + name + limit', async () => {
    await roundTrip('t1', 'x', {}, 'ok')
    await roundTrip('t2', 'y', {}, 'ok')
    await roundTrip('t3', 'x', {}, 'ok')
    await roundTrip('t4', 'x', {}, 'ok')
    const results = log.recent({ afterSeq: 1, name: 'x', limit: 1 })
    expect(results).toHaveLength(1)
    expect(results[0].seq).toBe(3)
  })
})

// ==================== ring buffer eviction ====================

describe('ring buffer', () => {
  it('evicts old entries when buffer exceeds size', async () => {
    const smallLog = await createToolCallLog({
      logPath: resolve(tempDir, 'small.jsonl'),
      bufferSize: 3,
    })
    for (let i = 1; i <= 5; i++) {
      await roundTripOn(smallLog, `t${i}`, 'tool', {}, 'ok')
    }
    const inMemory = smallLog.recent()
    expect(inMemory).toHaveLength(3)
    expect(inMemory[0].seq).toBe(3) // oldest surviving
    expect(inMemory[2].seq).toBe(5) // newest
    await smallLog.close()
  })
})

async function roundTripOn(l: ToolCallLog, id: string, name: string, input: unknown, output: string) {
  l.start(id, name, input, 'sess-1')
  await l.complete(id, output)
}

// ==================== query (disk) ====================

describe('query', () => {
  it('returns paginated results newest-first', async () => {
    for (let i = 1; i <= 5; i++) {
      await roundTrip(`t${i}`, 'tool', { i }, 'ok')
    }
    const result = await log.query({ page: 1, pageSize: 3 })
    expect(result.total).toBe(5)
    expect(result.totalPages).toBe(2)
    expect(result.entries).toHaveLength(3)
    // Page 1 = newest entries
    expect(result.entries[0].seq).toBe(5)
    expect(result.entries[2].seq).toBe(3)
  })

  it('page 2 returns older entries', async () => {
    for (let i = 1; i <= 5; i++) {
      await roundTrip(`t${i}`, 'tool', { i }, 'ok')
    }
    const result = await log.query({ page: 2, pageSize: 3 })
    expect(result.entries).toHaveLength(2)
    expect(result.entries[0].seq).toBe(2)
    expect(result.entries[1].seq).toBe(1)
  })

  it('filters by name on disk', async () => {
    await roundTrip('t1', 'alpha', {}, 'ok')
    await roundTrip('t2', 'beta', {}, 'ok')
    await roundTrip('t3', 'alpha', {}, 'ok')
    const result = await log.query({ name: 'alpha' })
    expect(result.total).toBe(2)
    expect(result.entries.every(r => r.name === 'alpha')).toBe(true)
  })

  it('returns empty result for empty log', async () => {
    const result = await log.query()
    expect(result.total).toBe(0)
    expect(result.entries).toHaveLength(0)
    expect(result.totalPages).toBe(1)
  })
})

// ==================== lastSeq ====================

describe('lastSeq', () => {
  it('starts at 0', () => {
    expect(log.lastSeq()).toBe(0)
  })

  it('increments on complete', async () => {
    await roundTrip('t1', 'tool', {}, 'ok')
    expect(log.lastSeq()).toBe(1)
    await roundTrip('t2', 'tool', {}, 'ok')
    expect(log.lastSeq()).toBe(2)
  })
})

// ==================== subscribe ====================

describe('subscribe', () => {
  it('notifies on complete', async () => {
    const received: ToolCallRecord[] = []
    log.subscribe((r) => received.push(r))
    await roundTrip('t1', 'tool', { x: 1 }, 'result')
    expect(received).toHaveLength(1)
    expect(received[0].name).toBe('tool')
  })

  it('unsubscribe stops notifications', async () => {
    const received: ToolCallRecord[] = []
    const unsub = log.subscribe((r) => received.push(r))
    await roundTrip('t1', 'tool', {}, 'ok')
    unsub()
    await roundTrip('t2', 'tool', {}, 'ok')
    expect(received).toHaveLength(1)
  })

  it('swallows subscriber errors', async () => {
    log.subscribe(() => { throw new Error('boom') })
    const received: ToolCallRecord[] = []
    log.subscribe((r) => received.push(r))
    // Should not throw despite first subscriber erroring
    await roundTrip('t1', 'tool', {}, 'ok')
    expect(received).toHaveLength(1)
  })
})

// ==================== recovery ====================

describe('recovery', () => {
  it('recovers seq and buffer from existing file', async () => {
    const logPath = resolve(tempDir, 'recover.jsonl')
    const log1 = await createToolCallLog({ logPath })
    log1.start('t1', 'a', {}, 'sess')
    await log1.complete('t1', 'ok')
    log1.start('t2', 'b', {}, 'sess')
    await log1.complete('t2', 'ok')
    await log1.close()

    // Re-open — should recover
    const log2 = await createToolCallLog({ logPath })
    expect(log2.lastSeq()).toBe(2)
    expect(log2.recent()).toHaveLength(2)
    expect(log2.recent()[0].name).toBe('a')
    expect(log2.recent()[1].name).toBe('b')

    // New entries should continue seq
    log2.start('t3', 'c', {}, 'sess')
    await log2.complete('t3', 'ok')
    expect(log2.lastSeq()).toBe(3)
    await log2.close()
  })

  it('recovery respects buffer size', async () => {
    const logPath = resolve(tempDir, 'recover-small.jsonl')
    const log1 = await createToolCallLog({ logPath, bufferSize: 2 })
    for (let i = 1; i <= 5; i++) {
      log1.start(`t${i}`, `tool${i}`, {}, 'sess')
      await log1.complete(`t${i}`, 'ok')
    }
    await log1.close()

    const log2 = await createToolCallLog({ logPath, bufferSize: 2 })
    expect(log2.lastSeq()).toBe(5)
    // Only last 2 in memory
    const inMemory = log2.recent()
    expect(inMemory).toHaveLength(2)
    expect(inMemory[0].seq).toBe(4)
    expect(inMemory[1].seq).toBe(5)
    // But disk query sees all
    const diskResult = await log2.query()
    expect(diskResult.total).toBe(5)
    await log2.close()
  })
})

// ==================== parallel tool calls ====================

describe('parallel tool calls', () => {
  it('handles multiple starts before completes', async () => {
    log.start('t1', 'alpha', { a: 1 }, 'sess')
    log.start('t2', 'beta', { b: 2 }, 'sess')
    log.start('t3', 'gamma', { c: 3 }, 'sess')

    await log.complete('t2', 'beta-result')
    await log.complete('t1', 'alpha-result')
    await log.complete('t3', 'gamma-result')

    const records = log.recent()
    expect(records).toHaveLength(3)
    // Order should match completion order
    expect(records[0].name).toBe('beta')
    expect(records[1].name).toBe('alpha')
    expect(records[2].name).toBe('gamma')
  })
})

// ==================== duration tracking ====================

describe('duration', () => {
  it('measures time between start and complete', async () => {
    vi.useFakeTimers()
    try {
      const fakeLog = await createToolCallLog({ logPath: resolve(tempDir, 'dur.jsonl') })
      vi.setSystemTime(1000)
      fakeLog.start('t1', 'tool', {}, 'sess')
      vi.setSystemTime(1150)
      await fakeLog.complete('t1', 'ok')
      const record = fakeLog.recent()[0]
      expect(record.durationMs).toBe(150)
      expect(record.timestamp).toBe(1000)
      await fakeLog.close()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ==================== _resetForTest ====================

describe('_resetForTest', () => {
  it('clears all state and deletes file', async () => {
    await roundTrip('t1', 'tool', {}, 'ok')
    expect(log.lastSeq()).toBe(1)
    await log._resetForTest()
    expect(log.lastSeq()).toBe(0)
    expect(log.recent()).toHaveLength(0)
    const result = await log.query()
    expect(result.total).toBe(0)
  })
})
