import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { createCronEngine, parseDuration, nextCronFire, computeNextRun } from './engine.js'
import { createEventLog, type EventLog, type EventLogEntry } from '../../core/event-log.js'
import type { CronEngine, CronFirePayload } from './engine.js'

function tempPath(ext: string): string {
  return join(tmpdir(), `cron-test-${randomUUID()}.${ext}`)
}

describe('cron engine', () => {
  let eventLog: EventLog
  let engine: CronEngine
  let storePath: string
  let logPath: string
  let clock: number

  beforeEach(async () => {
    logPath = tempPath('jsonl')
    storePath = tempPath('json')
    eventLog = await createEventLog({ logPath })
    clock = Date.now()
    engine = createCronEngine({
      eventLog,
      storePath,
      now: () => clock,
    })
  })

  afterEach(async () => {
    engine.stop()
    await eventLog._resetForTest()
    try { await unlink(storePath) } catch { /* ok */ }
  })

  // ==================== Job CRUD ====================

  describe('CRUD', () => {
    it('should add a job and list it', async () => {
      const id = await engine.add({
        name: 'test',
        schedule: { kind: 'every', every: '1h' },
        payload: 'hello',
      })

      expect(id).toHaveLength(8)
      const jobs = engine.list()
      expect(jobs).toHaveLength(1)
      expect(jobs[0]).toMatchObject({
        id,
        name: 'test',
        enabled: true,
        payload: 'hello',
        schedule: { kind: 'every', every: '1h' },
      })
    })

    it('should get a job by id', async () => {
      const id = await engine.add({
        name: 'get-test',
        schedule: { kind: 'every', every: '30m' },
        payload: 'x',
      })

      const job = engine.get(id)
      expect(job).toBeDefined()
      expect(job!.name).toBe('get-test')
    })

    it('should update a job', async () => {
      const id = await engine.add({
        name: 'before',
        schedule: { kind: 'every', every: '1h' },
        payload: 'old',
      })

      await engine.update(id, { name: 'after', payload: 'new' })

      const job = engine.get(id)
      expect(job!.name).toBe('after')
      expect(job!.payload).toBe('new')
    })

    it('should update schedule and recompute nextRunAtMs', async () => {
      const id = await engine.add({
        name: 'sched',
        schedule: { kind: 'every', every: '1h' },
        payload: 'x',
      })

      const before = engine.get(id)!.state.nextRunAtMs

      await engine.update(id, { schedule: { kind: 'every', every: '2h' } })

      const after = engine.get(id)!.state.nextRunAtMs
      expect(after).not.toBe(before)
    })

    it('should remove a job', async () => {
      const id = await engine.add({
        name: 'rm',
        schedule: { kind: 'every', every: '1h' },
        payload: 'x',
      })

      await engine.remove(id)
      expect(engine.list()).toHaveLength(0)
    })

    it('should throw on update of nonexistent job', async () => {
      await expect(engine.update('nope', { name: 'x' })).rejects.toThrow('not found')
    })

    it('should throw on remove of nonexistent job', async () => {
      await expect(engine.remove('nope')).rejects.toThrow('not found')
    })

    it('should add disabled job', async () => {
      const id = await engine.add({
        name: 'off',
        schedule: { kind: 'every', every: '1h' },
        payload: 'x',
        enabled: false,
      })

      expect(engine.get(id)!.enabled).toBe(false)
    })
  })

  // ==================== runNow ====================

  describe('runNow', () => {
    it('should fire a cron.fire event immediately', async () => {
      const fired: EventLogEntry[] = []
      eventLog.subscribeType('cron.fire', (e) => fired.push(e))

      const id = await engine.add({
        name: 'manual',
        schedule: { kind: 'every', every: '1h' },
        payload: 'run me now',
      })

      await engine.runNow(id)

      expect(fired).toHaveLength(1)
      const p = fired[0].payload as CronFirePayload
      expect(p.jobId).toBe(id)
      expect(p.payload).toBe('run me now')
    })

    it('should update lastRunAtMs and lastStatus', async () => {
      const id = await engine.add({
        name: 'state-check',
        schedule: { kind: 'every', every: '1h' },
        payload: 'x',
      })

      await engine.runNow(id)

      const job = engine.get(id)!
      expect(job.state.lastRunAtMs).toBe(clock)
      expect(job.state.lastStatus).toBe('ok')
    })

    it('should throw on runNow of nonexistent job', async () => {
      await expect(engine.runNow('nope')).rejects.toThrow('not found')
    })
  })

  // ==================== persistence ====================

  describe('persistence', () => {
    it('should recover jobs after restart', async () => {
      await engine.add({
        name: 'persist-me',
        schedule: { kind: 'every', every: '2h' },
        payload: 'hello',
      })

      engine.stop()

      // New engine from same store
      const engine2 = createCronEngine({
        eventLog,
        storePath,
        now: () => clock,
      })
      await engine2.start()

      const jobs = engine2.list()
      expect(jobs).toHaveLength(1)
      expect(jobs[0].name).toBe('persist-me')

      engine2.stop()
    })
  })

  // ==================== one-shot (at) ====================

  describe('one-shot (at)', () => {
    it('should disable after execution', async () => {
      const future = new Date(clock + 1000).toISOString()
      const id = await engine.add({
        name: 'once',
        schedule: { kind: 'at', at: future },
        payload: 'one-time',
      })

      await engine.runNow(id)

      const job = engine.get(id)!
      expect(job.enabled).toBe(false)
      expect(job.state.nextRunAtMs).toBeNull()
    })

    it('should compute null nextRun for past timestamps', async () => {
      const past = new Date(clock - 10000).toISOString()
      const id = await engine.add({
        name: 'expired',
        schedule: { kind: 'at', at: past },
        payload: 'x',
      })

      expect(engine.get(id)!.state.nextRunAtMs).toBeNull()
    })
  })
})

// ==================== Pure helpers ====================

describe('parseDuration', () => {
  it('should parse hours', () => {
    expect(parseDuration('2h')).toBe(2 * 3600_000)
  })

  it('should parse minutes', () => {
    expect(parseDuration('30m')).toBe(30 * 60_000)
  })

  it('should parse seconds', () => {
    expect(parseDuration('45s')).toBe(45_000)
  })

  it('should parse combined', () => {
    expect(parseDuration('1h30m')).toBe(90 * 60_000)
  })

  it('should return null for empty', () => {
    expect(parseDuration('')).toBeNull()
  })

  it('should return null for garbage', () => {
    expect(parseDuration('abc')).toBeNull()
  })
})

describe('nextCronFire', () => {
  it('should find next fire for simple expression', () => {
    // Every hour at minute 0
    const base = new Date('2025-06-01T10:00:00Z').getTime()
    const next = nextCronFire('0 * * * *', base)
    expect(next).toBe(new Date('2025-06-01T11:00:00Z').getTime())
  })

  it('should find next weekday fire', () => {
    // "0 9 * * 1" = Monday at 9:00 local time
    // Use local dates to avoid timezone mismatch
    const base = new Date('2025-06-01T00:00:00').getTime() // Sunday local
    const next = nextCronFire('0 9 * * 1', base)
    expect(next).toBe(new Date('2025-06-02T09:00:00').getTime()) // Monday 9am local
  })

  it('should return null for invalid expression', () => {
    expect(nextCronFire('bad expr', Date.now())).toBeNull()
  })

  it('should handle step syntax', () => {
    // Every 15 minutes
    const base = new Date('2025-06-01T10:00:00Z').getTime()
    const next = nextCronFire('*/15 * * * *', base)
    expect(next).toBe(new Date('2025-06-01T10:15:00Z').getTime())
  })
})

describe('computeNextRun', () => {
  it('should compute for every', () => {
    const base = 1000000
    expect(computeNextRun({ kind: 'every', every: '1h' }, base)).toBe(base + 3600_000)
  })

  it('should compute for at (future)', () => {
    const future = new Date(Date.now() + 60000).toISOString()
    const result = computeNextRun({ kind: 'at', at: future }, Date.now())
    expect(result).toBeGreaterThan(Date.now())
  })

  it('should return null for at (past)', () => {
    const past = new Date(Date.now() - 60000).toISOString()
    expect(computeNextRun({ kind: 'at', at: past }, Date.now())).toBeNull()
  })
})
