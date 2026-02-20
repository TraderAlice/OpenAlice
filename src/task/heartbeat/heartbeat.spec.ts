import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createEventLog, type EventLog } from '../../core/event-log.js'
import { createCronEngine, type CronEngine } from '../cron/engine.js'
import {
  createHeartbeat,
  stripAckToken,
  isWithinActiveHours,
  HeartbeatDedup,
  HEARTBEAT_JOB_NAME,
  type Heartbeat,
  type HeartbeatConfig,
} from './heartbeat.js'
import { SessionStore } from '../../core/session.js'
import * as connectorRegistry from '../../core/connector-registry.js'

function tempPath(ext: string): string {
  return join(tmpdir(), `heartbeat-test-${randomUUID()}.${ext}`)
}

function makeConfig(overrides: Partial<HeartbeatConfig> = {}): HeartbeatConfig {
  return {
    enabled: true,
    every: '30m',
    prompt: 'Check if anything needs attention. Reply HEARTBEAT_OK if nothing to report.',
    ackToken: 'HEARTBEAT_OK',
    ackMaxChars: 300,
    activeHours: null,
    ...overrides,
  }
}

// ==================== Mock Engine ====================

function createMockEngine(response = 'Market alert: BTC dropped 5%') {
  return {
    _response: response,
    setResponse(text: string) { this._response = text },
    askWithSession: vi.fn(async function (this: any) {
      return { text: this._response, media: [] }
    }),
    isGenerating: false,
    ask: vi.fn(),
    agent: {} as any,
    tools: {},
  }
}

describe('heartbeat', () => {
  let eventLog: EventLog
  let cronEngine: CronEngine
  let heartbeat: Heartbeat
  let mockEngine: ReturnType<typeof createMockEngine>
  let session: SessionStore

  beforeEach(async () => {
    const logPath = tempPath('jsonl')
    const storePath = tempPath('json')
    eventLog = await createEventLog({ logPath })
    cronEngine = createCronEngine({ eventLog, storePath })
    await cronEngine.start()

    mockEngine = createMockEngine()
    session = new SessionStore(`test/heartbeat-${randomUUID()}`)
  })

  afterEach(async () => {
    heartbeat?.stop()
    cronEngine.stop()
    connectorRegistry._resetForTest()
    await eventLog._resetForTest()
  })

  // ==================== Start / Idempotency ====================

  describe('start', () => {
    it('should register a cron job on start', async () => {
      heartbeat = createHeartbeat({
        config: makeConfig(),
        cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })

      await heartbeat.start()

      const jobs = cronEngine.list()
      expect(jobs).toHaveLength(1)
      expect(jobs[0].name).toBe(HEARTBEAT_JOB_NAME)
      expect(jobs[0].schedule).toEqual({ kind: 'every', every: '30m' })
    })

    it('should be idempotent (update existing job, not create duplicate)', async () => {
      heartbeat = createHeartbeat({
        config: makeConfig({ every: '30m' }),
        cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })

      await heartbeat.start()
      heartbeat.stop()

      // Start again with different interval
      heartbeat = createHeartbeat({
        config: makeConfig({ every: '1h' }),
        cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })

      await heartbeat.start()

      const jobs = cronEngine.list()
      expect(jobs).toHaveLength(1) // not 2
      expect(jobs[0].schedule).toEqual({ kind: 'every', every: '1h' })
    })

    it('should not register job when disabled', async () => {
      heartbeat = createHeartbeat({
        config: makeConfig({ enabled: false }),
        cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })

      await heartbeat.start()

      expect(cronEngine.list()).toHaveLength(0)
    })
  })

  // ==================== Event Handling ====================

  describe('event handling', () => {
    it('should call AI and write heartbeat.done on real response', async () => {
      const delivered: string[] = []
      connectorRegistry.registerConnector({
        channel: 'test', to: 'user1',
        deliver: async (text) => { delivered.push(text) },
      })
      connectorRegistry.touchInteraction('test', 'user1')

      heartbeat = createHeartbeat({
        config: makeConfig(),
        cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })
      await heartbeat.start()

      // Simulate cron.fire for heartbeat
      await cronEngine.runNow(cronEngine.list()[0].id)

      await vi.waitFor(() => {
        const done = eventLog.recent({ type: 'heartbeat.done' })
        expect(done).toHaveLength(1)
      })

      expect(delivered).toHaveLength(1)
      expect(delivered[0]).toBe('Market alert: BTC dropped 5%')

      const done = eventLog.recent({ type: 'heartbeat.done' })
      expect(done[0].payload).toMatchObject({
        reply: 'Market alert: BTC dropped 5%',
        delivered: true,
      })
    })

    it('should skip ack responses (HEARTBEAT_OK)', async () => {
      mockEngine.setResponse('HEARTBEAT_OK')

      heartbeat = createHeartbeat({
        config: makeConfig(),
        cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })
      await heartbeat.start()

      await cronEngine.runNow(cronEngine.list()[0].id)

      await vi.waitFor(() => {
        const skips = eventLog.recent({ type: 'heartbeat.skip' })
        expect(skips).toHaveLength(1)
      })

      const skips = eventLog.recent({ type: 'heartbeat.skip' })
      expect(skips[0].payload).toMatchObject({ reason: 'ack' })

      // Should NOT have heartbeat.done
      expect(eventLog.recent({ type: 'heartbeat.done' })).toHaveLength(0)
    })

    it('should ignore non-heartbeat cron.fire events', async () => {
      heartbeat = createHeartbeat({
        config: makeConfig(),
        cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })
      await heartbeat.start()

      // Fire a non-heartbeat cron event
      await eventLog.append('cron.fire', {
        jobId: 'other-job',
        jobName: 'check-eth',
        payload: 'Check ETH price',
      })

      await new Promise((r) => setTimeout(r, 50))

      expect(mockEngine.askWithSession).not.toHaveBeenCalled()
    })
  })

  // ==================== Active Hours ====================

  describe('active hours', () => {
    it('should skip when outside active hours', async () => {
      // Set active hours to a window that excludes the test time
      const fakeNow = new Date('2025-06-15T03:00:00').getTime() // 3 AM local

      heartbeat = createHeartbeat({
        config: makeConfig({
          activeHours: { start: '09:00', end: '22:00', timezone: 'local' },
        }),
        cronEngine, eventLog,
        engine: mockEngine as any,
        session,
        now: () => fakeNow,
      })
      await heartbeat.start()

      await cronEngine.runNow(cronEngine.list()[0].id)

      await vi.waitFor(() => {
        const skips = eventLog.recent({ type: 'heartbeat.skip' })
        expect(skips).toHaveLength(1)
      })

      const skips = eventLog.recent({ type: 'heartbeat.skip' })
      expect(skips[0].payload).toMatchObject({ reason: 'outside-active-hours' })
      expect(mockEngine.askWithSession).not.toHaveBeenCalled()
    })
  })

  // ==================== Dedup ====================

  describe('dedup', () => {
    it('should suppress duplicate messages within 24h', async () => {
      const delivered: string[] = []
      connectorRegistry.registerConnector({
        channel: 'test', to: 'user1',
        deliver: async (text) => { delivered.push(text) },
      })
      connectorRegistry.touchInteraction('test', 'user1')

      heartbeat = createHeartbeat({
        config: makeConfig(),
        cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })
      await heartbeat.start()

      const jobId = cronEngine.list()[0].id

      // First fire — should deliver
      await cronEngine.runNow(jobId)
      await vi.waitFor(() => {
        expect(delivered).toHaveLength(1)
      })

      // Second fire (same response) — should be suppressed
      await cronEngine.runNow(jobId)
      await vi.waitFor(() => {
        const skips = eventLog.recent({ type: 'heartbeat.skip' })
        expect(skips.some((s) => (s.payload as any).reason === 'duplicate')).toBe(true)
      })

      expect(delivered).toHaveLength(1) // still 1, not 2
    })
  })

  // ==================== Error Handling ====================

  describe('error handling', () => {
    it('should write heartbeat.error on engine failure', async () => {
      mockEngine.askWithSession.mockRejectedValueOnce(new Error('AI down'))

      heartbeat = createHeartbeat({
        config: makeConfig(),
        cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })
      await heartbeat.start()

      await cronEngine.runNow(cronEngine.list()[0].id)

      await vi.waitFor(() => {
        const errors = eventLog.recent({ type: 'heartbeat.error' })
        expect(errors).toHaveLength(1)
      })

      const errors = eventLog.recent({ type: 'heartbeat.error' })
      expect(errors[0].payload).toMatchObject({ error: 'AI down' })
    })

    it('should handle delivery failure gracefully', async () => {
      connectorRegistry.registerConnector({
        channel: 'test', to: 'user1',
        deliver: async () => { throw new Error('delivery failed') },
      })
      connectorRegistry.touchInteraction('test', 'user1')

      heartbeat = createHeartbeat({
        config: makeConfig(),
        cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })
      await heartbeat.start()

      await cronEngine.runNow(cronEngine.list()[0].id)

      await vi.waitFor(() => {
        const done = eventLog.recent({ type: 'heartbeat.done' })
        expect(done).toHaveLength(1)
      })

      const done = eventLog.recent({ type: 'heartbeat.done' })
      expect((done[0].payload as any).delivered).toBe(false)
    })
  })

  // ==================== Lifecycle ====================

  describe('lifecycle', () => {
    it('should stop listening after stop()', async () => {
      heartbeat = createHeartbeat({
        config: makeConfig(),
        cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })
      await heartbeat.start()
      heartbeat.stop()

      await cronEngine.runNow(cronEngine.list()[0].id)
      await new Promise((r) => setTimeout(r, 50))

      expect(mockEngine.askWithSession).not.toHaveBeenCalled()
    })
  })
})

// ==================== Unit Tests: stripAckToken ====================

describe('stripAckToken', () => {
  it('should detect plain ack token', () => {
    const r = stripAckToken('HEARTBEAT_OK', 'HEARTBEAT_OK', 300)
    expect(r.shouldSkip).toBe(true)
  })

  it('should detect ack token with whitespace', () => {
    const r = stripAckToken('  HEARTBEAT_OK  ', 'HEARTBEAT_OK', 300)
    expect(r.shouldSkip).toBe(true)
  })

  it('should detect ack with markdown bold', () => {
    const r = stripAckToken('**HEARTBEAT_OK**', 'HEARTBEAT_OK', 300)
    expect(r.shouldSkip).toBe(true)
  })

  it('should skip short remaining text after stripping', () => {
    const r = stripAckToken('HEARTBEAT_OK — all good!', 'HEARTBEAT_OK', 300)
    expect(r.shouldSkip).toBe(true)
    expect(r.text).toBe('— all good!')
  })

  it('should NOT skip long substantive response', () => {
    const longText = 'HEARTBEAT_OK but also: ' + 'x'.repeat(400)
    const r = stripAckToken(longText, 'HEARTBEAT_OK', 300)
    expect(r.shouldSkip).toBe(false)
  })

  it('should NOT skip response without ack token', () => {
    const r = stripAckToken('Market alert: BTC down 10%', 'HEARTBEAT_OK', 300)
    expect(r.shouldSkip).toBe(false)
    expect(r.text).toBe('Market alert: BTC down 10%')
  })

  it('should handle empty input', () => {
    const r = stripAckToken('', 'HEARTBEAT_OK', 300)
    expect(r.shouldSkip).toBe(true)
  })
})

// ==================== Unit Tests: isWithinActiveHours ====================

describe('isWithinActiveHours', () => {
  it('should return true when no active hours configured', () => {
    expect(isWithinActiveHours(null)).toBe(true)
  })

  it('should return true within normal range', () => {
    // 15:00 local → within 09:00-22:00
    const ts = todayAt(15, 0).getTime()
    expect(isWithinActiveHours(
      { start: '09:00', end: '22:00', timezone: 'local' },
      ts,
    )).toBe(true)
  })

  it('should return false outside normal range', () => {
    // 03:00 local → outside 09:00-22:00
    const ts = todayAt(3, 0).getTime()
    expect(isWithinActiveHours(
      { start: '09:00', end: '22:00', timezone: 'local' },
      ts,
    )).toBe(false)
  })

  it('should handle overnight range (22:00 → 06:00)', () => {
    const ts = todayAt(23, 0).getTime()
    expect(isWithinActiveHours(
      { start: '22:00', end: '06:00', timezone: 'local' },
      ts,
    )).toBe(true)

    const ts2 = todayAt(3, 0).getTime()
    expect(isWithinActiveHours(
      { start: '22:00', end: '06:00', timezone: 'local' },
      ts2,
    )).toBe(true)

    const ts3 = todayAt(12, 0).getTime()
    expect(isWithinActiveHours(
      { start: '22:00', end: '06:00', timezone: 'local' },
      ts3,
    )).toBe(false)
  })

  it('should handle invalid format gracefully (return true)', () => {
    expect(isWithinActiveHours(
      { start: 'invalid', end: '22:00', timezone: 'local' },
    )).toBe(true)
  })
})

// ==================== Unit Tests: HeartbeatDedup ====================

describe('HeartbeatDedup', () => {
  it('should not flag first message as duplicate', () => {
    const d = new HeartbeatDedup()
    expect(d.isDuplicate('hello')).toBe(false)
  })

  it('should flag same text within window', () => {
    const d = new HeartbeatDedup(1000)
    d.record('hello', 100)
    expect(d.isDuplicate('hello', 500)).toBe(true)
  })

  it('should not flag same text after window expires', () => {
    const d = new HeartbeatDedup(1000)
    d.record('hello', 100)
    expect(d.isDuplicate('hello', 1200)).toBe(false)
  })

  it('should not flag different text', () => {
    const d = new HeartbeatDedup(1000)
    d.record('hello', 100)
    expect(d.isDuplicate('world', 500)).toBe(false)
  })
})

// ==================== Helpers ====================

/** Create a Date set to today at the given local hour and minute. */
function todayAt(h: number, m: number): Date {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d
}
