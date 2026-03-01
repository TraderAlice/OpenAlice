import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createEventLog, type EventLog } from '../../core/event-log.js'
import { createCronEngine, type CronEngine } from '../cron/engine.js'
import {
  createHeartbeat,
  parseHeartbeatResponse,
  isWithinActiveHours,
  HeartbeatDedup,
  HEARTBEAT_JOB_NAME,
  type Heartbeat,
  type HeartbeatConfig,
} from './heartbeat.js'
import { SessionStore } from '../../core/session.js'
import { ConnectorCenter } from '../../core/connector-center.js'

// Mock writeConfigSection to avoid disk writes in tests
vi.mock('../../core/config.js', () => ({
  writeConfigSection: vi.fn(async () => ({})),
}))

function tempPath(ext: string): string {
  return join(tmpdir(), `heartbeat-test-${randomUUID()}.${ext}`)
}

function makeConfig(overrides: Partial<HeartbeatConfig> = {}): HeartbeatConfig {
  return {
    enabled: true,
    every: '30m',
    prompt: 'Check if anything needs attention.',
    activeHours: null,
    ...overrides,
  }
}

// ==================== Mock Engine ====================

const CHAT_YES_RESPONSE = `STATUS: CHAT_YES
REASON: Significant price movement detected.
CONTENT: Market alert: BTC dropped 5%`

function createMockEngine(response = CHAT_YES_RESPONSE) {
  return {
    _response: response,
    setResponse(text: string) { this._response = text },
    askWithSession: vi.fn(async function (this: any) {
      return { text: this._response, media: [] }
    }),
    ask: vi.fn(),
  }
}

describe('heartbeat', () => {
  let eventLog: EventLog
  let cronEngine: CronEngine
  let heartbeat: Heartbeat
  let mockEngine: ReturnType<typeof createMockEngine>
  let session: SessionStore
  let connectorCenter: ConnectorCenter

  beforeEach(async () => {
    const logPath = tempPath('jsonl')
    const storePath = tempPath('json')
    eventLog = await createEventLog({ logPath })
    cronEngine = createCronEngine({ eventLog, storePath })
    await cronEngine.start()

    mockEngine = createMockEngine()
    session = new SessionStore(`test/heartbeat-${randomUUID()}`)
    connectorCenter = new ConnectorCenter()
  })

  afterEach(async () => {
    heartbeat?.stop()
    cronEngine.stop()
    await eventLog._resetForTest()
  })

  // ==================== Start / Idempotency ====================

  describe('start', () => {
    it('should register a cron job on start', async () => {
      heartbeat = createHeartbeat({
        config: makeConfig(),
        connectorCenter, cronEngine, eventLog,
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
        connectorCenter, cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })

      await heartbeat.start()
      heartbeat.stop()

      // Start again with different interval
      heartbeat = createHeartbeat({
        config: makeConfig({ every: '1h' }),
        connectorCenter, cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })

      await heartbeat.start()

      const jobs = cronEngine.list()
      expect(jobs).toHaveLength(1) // not 2
      expect(jobs[0].schedule).toEqual({ kind: 'every', every: '1h' })
    })

    it('should register disabled job when config.enabled is false', async () => {
      heartbeat = createHeartbeat({
        config: makeConfig({ enabled: false }),
        connectorCenter, cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })

      await heartbeat.start()

      const jobs = cronEngine.list()
      expect(jobs).toHaveLength(1)
      expect(jobs[0].enabled).toBe(false)
      expect(heartbeat.isEnabled()).toBe(false)
    })
  })

  // ==================== Event Handling ====================

  describe('event handling', () => {
    it('should call AI and write heartbeat.done on real response', async () => {
      const delivered: string[] = []
      connectorCenter.register({
        channel: 'test', to: 'user1',
        capabilities: { push: true, media: false },
        send: async (payload) => { delivered.push(payload.text); return { delivered: true } },
      })

      heartbeat = createHeartbeat({
        config: makeConfig(),
        connectorCenter, cronEngine, eventLog,
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

    it('should skip HEARTBEAT_OK responses', async () => {
      mockEngine.setResponse('STATUS: HEARTBEAT_OK\nREASON: All systems normal.')

      heartbeat = createHeartbeat({
        config: makeConfig(),
        connectorCenter, cronEngine, eventLog,
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
      expect(skips[0].payload).toMatchObject({ reason: 'ack', parsedReason: 'All systems normal.' })

      // Should NOT have heartbeat.done
      expect(eventLog.recent({ type: 'heartbeat.done' })).toHaveLength(0)
    })

    it('should deliver unparsed responses (fail-open)', async () => {
      const delivered: string[] = []
      connectorCenter.register({
        channel: 'test', to: 'user1',
        capabilities: { push: true, media: false },
        send: async (payload) => { delivered.push(payload.text); return { delivered: true } },
      })

      // Raw text without structured format
      mockEngine.setResponse('BTC just crashed 15%, major liquidation event!')

      heartbeat = createHeartbeat({
        config: makeConfig(),
        connectorCenter, cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })
      await heartbeat.start()

      await cronEngine.runNow(cronEngine.list()[0].id)

      await vi.waitFor(() => {
        const done = eventLog.recent({ type: 'heartbeat.done' })
        expect(done).toHaveLength(1)
      })

      expect(delivered).toHaveLength(1)
      expect(delivered[0]).toBe('BTC just crashed 15%, major liquidation event!')
    })

    it('should ignore non-heartbeat cron.fire events', async () => {
      heartbeat = createHeartbeat({
        config: makeConfig(),
        connectorCenter, cronEngine, eventLog,
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
        connectorCenter, cronEngine, eventLog,
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
      connectorCenter.register({
        channel: 'test', to: 'user1',
        capabilities: { push: true, media: false },
        send: async (payload) => { delivered.push(payload.text); return { delivered: true } },
      })

      heartbeat = createHeartbeat({
        config: makeConfig(),
        connectorCenter, cronEngine, eventLog,
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
        connectorCenter, cronEngine, eventLog,
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
      connectorCenter.register({
        channel: 'test', to: 'user1',
        capabilities: { push: true, media: false },
        send: async () => { throw new Error('send failed') },
      })

      heartbeat = createHeartbeat({
        config: makeConfig(),
        connectorCenter, cronEngine, eventLog,
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
        connectorCenter, cronEngine, eventLog,
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

  // ==================== setEnabled / isEnabled ====================

  describe('setEnabled', () => {
    it('should enable a previously disabled heartbeat', async () => {
      heartbeat = createHeartbeat({
        config: makeConfig({ enabled: false }),
        connectorCenter, cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })
      await heartbeat.start()

      expect(heartbeat.isEnabled()).toBe(false)
      expect(cronEngine.list()[0].enabled).toBe(false)

      await heartbeat.setEnabled(true)

      expect(heartbeat.isEnabled()).toBe(true)
      expect(cronEngine.list()[0].enabled).toBe(true)
    })

    it('should disable an enabled heartbeat', async () => {
      heartbeat = createHeartbeat({
        config: makeConfig({ enabled: true }),
        connectorCenter, cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })
      await heartbeat.start()

      expect(heartbeat.isEnabled()).toBe(true)

      await heartbeat.setEnabled(false)

      expect(heartbeat.isEnabled()).toBe(false)
      expect(cronEngine.list()[0].enabled).toBe(false)
    })

    it('should persist config via writeConfigSection', async () => {
      const { writeConfigSection } = await import('../../core/config.js')

      heartbeat = createHeartbeat({
        config: makeConfig({ enabled: false }),
        connectorCenter, cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })
      await heartbeat.start()
      await heartbeat.setEnabled(true)

      expect(writeConfigSection).toHaveBeenCalledWith('heartbeat', expect.objectContaining({ enabled: true }))
    })

    it('should allow firing after setEnabled(true)', async () => {
      const delivered: string[] = []
      connectorCenter.register({
        channel: 'test', to: 'user1',
        capabilities: { push: true, media: false },
        send: async (payload) => { delivered.push(payload.text); return { delivered: true } },
      })

      heartbeat = createHeartbeat({
        config: makeConfig({ enabled: false }),
        connectorCenter, cronEngine, eventLog,
        engine: mockEngine as any,
        session,
      })
      await heartbeat.start()

      // Enable heartbeat
      await heartbeat.setEnabled(true)

      // Fire — should process since now enabled
      await cronEngine.runNow(cronEngine.list()[0].id)

      await vi.waitFor(() => {
        expect(delivered).toHaveLength(1)
      })
    })
  })
})

// ==================== Unit Tests: parseHeartbeatResponse ====================

describe('parseHeartbeatResponse', () => {
  it('should parse HEARTBEAT_OK', () => {
    const r = parseHeartbeatResponse('STATUS: HEARTBEAT_OK\nREASON: All good.')
    expect(r.status).toBe('HEARTBEAT_OK')
    expect(r.reason).toBe('All good.')
    expect(r.content).toBe('')
    expect(r.unparsed).toBe(false)
  })

  it('should treat former CHAT_NO as unparsed (fail-open to CHAT_YES)', () => {
    const r = parseHeartbeatResponse('STATUS: CHAT_NO\nREASON: Nothing worth reporting.')
    expect(r.status).toBe('CHAT_YES')
    expect(r.unparsed).toBe(true)
  })

  it('should parse CHAT_YES with content', () => {
    const r = parseHeartbeatResponse(
      'STATUS: CHAT_YES\nREASON: Price alert.\nCONTENT: BTC dropped 8% to $87,200.',
    )
    expect(r.status).toBe('CHAT_YES')
    expect(r.reason).toBe('Price alert.')
    expect(r.content).toBe('BTC dropped 8% to $87,200.')
    expect(r.unparsed).toBe(false)
  })

  it('should parse CHAT_YES with multiline content', () => {
    const r = parseHeartbeatResponse(
      'STATUS: CHAT_YES\nREASON: Multiple alerts.\nCONTENT: Line 1\nLine 2\nLine 3',
    )
    expect(r.status).toBe('CHAT_YES')
    expect(r.content).toBe('Line 1\nLine 2\nLine 3')
  })

  it('should be case-insensitive for STATUS field', () => {
    const r = parseHeartbeatResponse('status: heartbeat_ok\nreason: ok')
    expect(r.status).toBe('HEARTBEAT_OK')
  })

  it('should handle extra whitespace', () => {
    const r = parseHeartbeatResponse('  STATUS:   HEARTBEAT_OK  \n  REASON:   All quiet.  ')
    expect(r.status).toBe('HEARTBEAT_OK')
    expect(r.reason).toBe('All quiet.')
  })

  it('should fail-open on unparseable response (deliver it)', () => {
    const r = parseHeartbeatResponse('Something unexpected happened with BTC!')
    expect(r.status).toBe('CHAT_YES')
    expect(r.content).toBe('Something unexpected happened with BTC!')
    expect(r.unparsed).toBe(true)
  })

  it('should handle empty input', () => {
    const r = parseHeartbeatResponse('')
    expect(r.status).toBe('HEARTBEAT_OK')
    expect(r.content).toBe('')
    expect(r.unparsed).toBe(false)
  })

  it('should handle response with only STATUS line', () => {
    const r = parseHeartbeatResponse('STATUS: HEARTBEAT_OK')
    expect(r.status).toBe('HEARTBEAT_OK')
    expect(r.reason).toBe('')
  })

  it('should handle CHAT_YES without CONTENT field', () => {
    const r = parseHeartbeatResponse('STATUS: CHAT_YES\nREASON: Want to say hi.')
    expect(r.status).toBe('CHAT_YES')
    expect(r.content).toBe('')
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
