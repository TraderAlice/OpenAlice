import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { createEventLog, type EventLog, type EventLogEntry } from '../../core/event-log.js'
import { createCronListener, type CronListener } from './listener.js'
import { SessionStore } from '../../core/session.js'
import type { CronFirePayload } from './engine.js'
import * as connectorRegistry from '../../core/connector-registry.js'

function tempPath(ext: string): string {
  return join(tmpdir(), `cron-listener-test-${randomUUID()}.${ext}`)
}

// ==================== Mock Engine ====================

function createMockEngine(response = 'AI reply') {
  const calls: Array<{ prompt: string; session: SessionStore }> = []
  let shouldFail = false

  return {
    calls,
    setResponse(text: string) { response = text },
    setShouldFail(val: boolean) { shouldFail = val },
    // Partial Engine mock — only askWithSession is needed
    askWithSession: vi.fn(async (prompt: string, session: SessionStore) => {
      calls.push({ prompt, session })
      if (shouldFail) throw new Error('engine error')
      return { text: response, media: [] }
    }),
    // Stubs for other Engine properties
    isGenerating: false,
    ask: vi.fn(),
    agent: {} as any,
    tools: {},
  }
}

describe('cron listener', () => {
  let eventLog: EventLog
  let listener: CronListener
  let mockEngine: ReturnType<typeof createMockEngine>
  let session: SessionStore
  let logPath: string

  beforeEach(async () => {
    logPath = tempPath('jsonl')
    eventLog = await createEventLog({ logPath })
    mockEngine = createMockEngine()
    session = new SessionStore(`test/cron-${randomUUID()}`)

    listener = createCronListener({
      eventLog,
      engine: mockEngine as any,
      session,
    })
  })

  afterEach(async () => {
    listener.stop()
    connectorRegistry._resetForTest()
    await eventLog._resetForTest()
  })

  // ==================== Basic functionality ====================

  describe('event handling', () => {
    it('should call engine.askWithSession on cron.fire', async () => {
      listener.start()

      await eventLog.append('cron.fire', {
        jobId: 'abc12345',
        jobName: 'test-job',
        payload: 'Check the market',
      } satisfies CronFirePayload)

      // Wait for async handler
      await vi.waitFor(() => {
        expect(mockEngine.askWithSession).toHaveBeenCalledTimes(1)
      })

      expect(mockEngine.askWithSession).toHaveBeenCalledWith(
        'Check the market',
        session,
        expect.objectContaining({ historyPreamble: expect.any(String) }),
      )
    })

    it('should write cron.done event on success', async () => {
      listener.start()

      await eventLog.append('cron.fire', {
        jobId: 'abc12345',
        jobName: 'test-job',
        payload: 'Do something',
      } satisfies CronFirePayload)

      await vi.waitFor(() => {
        const done = eventLog.recent({ type: 'cron.done' })
        expect(done).toHaveLength(1)
      })

      const done = eventLog.recent({ type: 'cron.done' })
      expect(done[0].payload).toMatchObject({
        jobId: 'abc12345',
        jobName: 'test-job',
        reply: 'AI reply',
      })
      expect((done[0].payload as any).durationMs).toBeGreaterThanOrEqual(0)
    })

    it('should not react to other event types', async () => {
      listener.start()

      await eventLog.append('some.other.event', { data: 'hello' })

      // Give it a moment
      await new Promise((r) => setTimeout(r, 50))

      expect(mockEngine.askWithSession).not.toHaveBeenCalled()
    })
  })

  // ==================== Delivery ====================

  describe('delivery', () => {
    it('should deliver reply through connector registry', async () => {
      const delivered: string[] = []
      connectorRegistry.registerConnector({
        channel: 'test',
        to: 'user1',
        deliver: async (text) => { delivered.push(text) },
      })
      connectorRegistry.touchInteraction('test', 'user1')

      listener.start()

      await eventLog.append('cron.fire', {
        jobId: 'abc12345',
        jobName: 'test-job',
        payload: 'Hello',
      } satisfies CronFirePayload)

      await vi.waitFor(() => {
        expect(delivered).toHaveLength(1)
      })

      expect(delivered[0]).toBe('AI reply')
    })

    it('should handle delivery failure gracefully', async () => {
      connectorRegistry.registerConnector({
        channel: 'test',
        to: 'user1',
        deliver: async () => { throw new Error('delivery failed') },
      })
      connectorRegistry.touchInteraction('test', 'user1')

      listener.start()

      await eventLog.append('cron.fire', {
        jobId: 'abc12345',
        jobName: 'test-job',
        payload: 'Hello',
      } satisfies CronFirePayload)

      // Should still write cron.done (delivery failure is non-fatal)
      await vi.waitFor(() => {
        const done = eventLog.recent({ type: 'cron.done' })
        expect(done).toHaveLength(1)
      })
    })

    it('should handle no connectors gracefully', async () => {
      // No connectors registered
      listener.start()

      await eventLog.append('cron.fire', {
        jobId: 'abc12345',
        jobName: 'test-job',
        payload: 'Hello',
      } satisfies CronFirePayload)

      // Should still write cron.done
      await vi.waitFor(() => {
        const done = eventLog.recent({ type: 'cron.done' })
        expect(done).toHaveLength(1)
      })
    })
  })

  // ==================== Error handling ====================

  describe('error handling', () => {
    it('should write cron.error on engine failure', async () => {
      mockEngine.setShouldFail(true)
      listener.start()

      await eventLog.append('cron.fire', {
        jobId: 'abc12345',
        jobName: 'test-job',
        payload: 'Will fail',
      } satisfies CronFirePayload)

      await vi.waitFor(() => {
        const errors = eventLog.recent({ type: 'cron.error' })
        expect(errors).toHaveLength(1)
      })

      const errors = eventLog.recent({ type: 'cron.error' })
      expect(errors[0].payload).toMatchObject({
        jobId: 'abc12345',
        jobName: 'test-job',
        error: 'engine error',
      })
      expect((errors[0].payload as any).durationMs).toBeGreaterThanOrEqual(0)
    })
  })

  // ==================== Lifecycle ====================

  describe('lifecycle', () => {
    it('should stop receiving events after stop()', async () => {
      listener.start()
      listener.stop()

      await eventLog.append('cron.fire', {
        jobId: 'abc12345',
        jobName: 'test-job',
        payload: 'Should not fire',
      } satisfies CronFirePayload)

      // Give it a moment
      await new Promise((r) => setTimeout(r, 50))

      expect(mockEngine.askWithSession).not.toHaveBeenCalled()
    })

    it('should be idempotent (start twice, stop twice)', () => {
      listener.start()
      listener.start()
      listener.stop()
      listener.stop()
      // No error
    })
  })
})
