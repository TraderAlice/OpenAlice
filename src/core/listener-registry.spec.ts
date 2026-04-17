import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createEventLog, type EventLog } from './event-log.js'
import { createListenerRegistry, type ListenerRegistry } from './listener-registry.js'
import type { Listener } from './listener.js'

function tempLogPath(): string {
  return join(tmpdir(), `listener-registry-${randomUUID()}.jsonl`)
}

// Wait one microtask + a small macrotask to let the registry's fire-and-forget
// Promise chain settle.
async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 5))
}

describe('ListenerRegistry', () => {
  let eventLog: EventLog
  let registry: ListenerRegistry

  beforeEach(async () => {
    eventLog = await createEventLog({ logPath: tempLogPath() })
    registry = createListenerRegistry(eventLog)
  })

  afterEach(async () => {
    await registry.stop()
    await eventLog._resetForTest()
  })

  // ==================== register ====================

  describe('register', () => {
    it('should register a listener and show it in list()', () => {
      const listener: Listener<'cron.fire'> = {
        name: 'test',
        eventType: 'cron.fire',
        async handle() { /* no-op */ },
      }
      registry.register(listener)

      const infos = registry.list()
      expect(infos).toHaveLength(1)
      expect(infos[0]).toEqual({ name: 'test', eventType: 'cron.fire', emits: [] })
    })

    it('should throw on duplicate name', () => {
      const listener: Listener<'cron.fire'> = {
        name: 'dup',
        eventType: 'cron.fire',
        async handle() { /* no-op */ },
      }
      registry.register(listener)

      expect(() => registry.register(listener)).toThrow(/already registered/)
    })
  })

  // ==================== start / stop ====================

  describe('start/stop', () => {
    it('should deliver matching events after start()', async () => {
      const received: string[] = []
      registry.register({
        name: 'l1',
        eventType: 'cron.fire',
        async handle(entry) { received.push(entry.payload.jobId) },
      })
      await registry.start()

      await eventLog.append('cron.fire', { jobId: 'j1', jobName: 'x', payload: 'p' })
      await flush()

      expect(received).toEqual(['j1'])
    })

    it('should not deliver non-matching event types', async () => {
      const received: unknown[] = []
      registry.register({
        name: 'l1',
        eventType: 'cron.fire',
        async handle(entry) { received.push(entry) },
      })
      await registry.start()

      await eventLog.append('heartbeat.skip', { reason: 'test' })
      await flush()

      expect(received).toHaveLength(0)
    })

    it('should stop delivering after stop()', async () => {
      const received: string[] = []
      registry.register({
        name: 'l1',
        eventType: 'cron.fire',
        async handle(entry) { received.push(entry.payload.jobId) },
      })
      await registry.start()

      await eventLog.append('cron.fire', { jobId: 'before', jobName: 'x', payload: 'p' })
      await flush()

      await registry.stop()

      await eventLog.append('cron.fire', { jobId: 'after', jobName: 'x', payload: 'p' })
      await flush()

      expect(received).toEqual(['before'])
    })

    it('should deliver to multiple listeners on same event type', async () => {
      const a: string[] = []
      const b: string[] = []
      registry.register({
        name: 'a',
        eventType: 'cron.fire',
        async handle(entry) { a.push(entry.payload.jobId) },
      })
      registry.register({
        name: 'b',
        eventType: 'cron.fire',
        async handle(entry) { b.push(entry.payload.jobId) },
      })
      await registry.start()

      await eventLog.append('cron.fire', { jobId: 'j1', jobName: 'x', payload: 'p' })
      await flush()

      expect(a).toEqual(['j1'])
      expect(b).toEqual(['j1'])
    })

    it('should subscribe listener registered after start()', async () => {
      await registry.start()

      const received: string[] = []
      registry.register({
        name: 'late',
        eventType: 'cron.fire',
        async handle(entry) { received.push(entry.payload.jobId) },
      })

      await eventLog.append('cron.fire', { jobId: 'j1', jobName: 'x', payload: 'p' })
      await flush()

      expect(received).toEqual(['j1'])
    })
  })

  // ==================== error isolation ====================

  describe('error isolation', () => {
    it('should not affect other listeners when one throws', async () => {
      const received: string[] = []
      registry.register({
        name: 'boom',
        eventType: 'cron.fire',
        async handle() { throw new Error('boom') },
      })
      registry.register({
        name: 'ok',
        eventType: 'cron.fire',
        async handle(entry) { received.push(entry.payload.jobId) },
      })
      await registry.start()

      await eventLog.append('cron.fire', { jobId: 'j1', jobName: 'x', payload: 'p' })
      await flush()

      expect(received).toEqual(['j1'])
    })

    it('should continue accepting events after a handle() error', async () => {
      const received: string[] = []
      let first = true
      registry.register({
        name: 'flaky',
        eventType: 'cron.fire',
        async handle(entry) {
          if (first) { first = false; throw new Error('first one fails') }
          received.push(entry.payload.jobId)
        },
      })
      await registry.start()

      await eventLog.append('cron.fire', { jobId: 'j1', jobName: 'x', payload: 'p' })
      await flush()
      await eventLog.append('cron.fire', { jobId: 'j2', jobName: 'x', payload: 'p' })
      await flush()

      expect(received).toEqual(['j2'])
    })
  })

  // ==================== ctx.emit ====================

  describe('ctx.emit', () => {
    it('should allow emitting declared types and auto-set causedBy', async () => {
      registry.register({
        name: 'cron-echo',
        eventType: 'cron.fire',
        emits: ['cron.done'] as const,
        async handle(entry, ctx) {
          await ctx.emit('cron.done', {
            jobId: entry.payload.jobId,
            jobName: entry.payload.jobName,
            reply: 'ok',
            durationMs: 10,
          })
        },
      })
      await registry.start()

      const parent = await eventLog.append('cron.fire', {
        jobId: 'j1', jobName: 'x', payload: 'p',
      })
      await flush()

      const done = eventLog.recent({ type: 'cron.done' })
      expect(done).toHaveLength(1)
      expect(done[0].causedBy).toBe(parent.seq)
      expect(done[0].payload).toMatchObject({ jobId: 'j1', reply: 'ok' })
    })

    it('should reject emit of un-declared event type at runtime', async () => {
      const errors: unknown[] = []
      const origErr = console.error
      console.error = (...a: unknown[]) => { errors.push(a) }
      try {
        registry.register({
          name: 'naughty',
          eventType: 'cron.fire',
          emits: ['cron.done'] as const,
          async handle(_entry, ctx) {
            // Cast past the type system to simulate a misuse
            await (ctx.emit as unknown as (t: string, p: unknown) => Promise<unknown>)(
              'heartbeat.done',
              { reply: 'x', reason: '', durationMs: 0, delivered: false },
            )
          },
        })
        await registry.start()

        await eventLog.append('cron.fire', { jobId: 'j1', jobName: 'x', payload: 'p' })
        await flush()

        // Error was caught by registry's error isolation and logged
        expect(errors.length).toBeGreaterThan(0)
        const msg = String((errors[0] as unknown[])[1])
        expect(msg).toMatch(/naughty.*heartbeat\.done.*declared emits.*cron\.done/)
      } finally {
        console.error = origErr
      }
    })

    it('should reject all emit calls when listener has no emits declared', async () => {
      const errors: unknown[] = []
      const origErr = console.error
      console.error = (...a: unknown[]) => { errors.push(a) }
      try {
        registry.register({
          name: 'silent',
          eventType: 'cron.fire',
          async handle(_entry, ctx) {
            await (ctx.emit as unknown as (t: string, p: unknown) => Promise<unknown>)(
              'cron.done',
              { jobId: '', jobName: '', reply: '', durationMs: 0 },
            )
          },
        })
        await registry.start()

        await eventLog.append('cron.fire', { jobId: 'j1', jobName: 'x', payload: 'p' })
        await flush()

        expect(errors.length).toBeGreaterThan(0)
        const msg = String((errors[0] as unknown[])[1])
        expect(msg).toMatch(/silent.*declared emits: \(none\)/)
      } finally {
        console.error = origErr
      }
    })

    it('should allow overriding causedBy explicitly via opts', async () => {
      registry.register({
        name: 'cron-override',
        eventType: 'cron.fire',
        emits: ['cron.done'] as const,
        async handle(_entry, ctx) {
          await ctx.emit(
            'cron.done',
            { jobId: 'j1', jobName: 'x', reply: 'ok', durationMs: 0 },
            { causedBy: 999 },
          )
        },
      })
      await registry.start()

      await eventLog.append('cron.fire', { jobId: 'j1', jobName: 'x', payload: 'p' })
      await flush()

      const [done] = eventLog.recent({ type: 'cron.done' })
      expect(done.causedBy).toBe(999)
    })
  })

  // ==================== ctx.events ====================

  describe('ctx.events', () => {
    it('should expose read-only event log access', async () => {
      await eventLog.append('cron.fire', { jobId: 'older', jobName: 'x', payload: 'p' })

      let recentSeen: number | undefined
      registry.register({
        name: 'snoop',
        eventType: 'cron.fire',
        async handle(_entry, ctx) {
          recentSeen = ctx.events.recent({ type: 'cron.fire' }).length
        },
      })
      await registry.start()

      await eventLog.append('cron.fire', { jobId: 'newer', jobName: 'x', payload: 'p' })
      await flush()

      expect(recentSeen).toBe(2)
    })
  })
})
