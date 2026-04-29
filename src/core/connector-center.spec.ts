import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  ConnectorCenter,
  type Connector,
  type SendPayload,
} from './connector-center.js'
import { createEventLog, type EventLog } from './event-log.js'
import { createListenerRegistry } from './listener-registry.js'

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    channel: 'test',
    to: 'default',
    capabilities: { push: true, media: false },
    send: async () => ({ delivered: true }),
    ...overrides,
  }
}

describe('ConnectorCenter', () => {
  describe('without EventLog', () => {
    let cc: ConnectorCenter

    beforeEach(() => {
      cc = new ConnectorCenter()
    })

    describe('register', () => {
      it('should register and list connectors', () => {
        cc.register(makeConnector({ channel: 'telegram', to: '123' }))

        expect(cc.hasConnectors()).toBe(true)
        expect(cc.list()).toHaveLength(1)
        expect(cc.list()[0].channel).toBe('telegram')
      })

      it('should replace existing registration for same channel', () => {
        cc.register(makeConnector({ channel: 'telegram', to: '123' }))
        cc.register(makeConnector({ channel: 'telegram', to: '456' }))

        expect(cc.list()).toHaveLength(1)
        expect(cc.list()[0].to).toBe('456')
      })

      it('should support multiple channels', () => {
        cc.register(makeConnector({ channel: 'telegram', to: '123' }))
        cc.register(makeConnector({ channel: 'discord', to: '#general' }))

        expect(cc.list()).toHaveLength(2)
      })

      it('should return an unregister function', () => {
        const unregister = cc.register(makeConnector({ channel: 'telegram', to: '123' }))

        expect(cc.hasConnectors()).toBe(true)
        unregister()
        expect(cc.hasConnectors()).toBe(false)
      })

      it('should expose capabilities', () => {
        cc.register(makeConnector({
          channel: 'telegram',
          capabilities: { push: true, media: true },
        }))

        const connector = cc.list()[0]
        expect(connector.capabilities.push).toBe(true)
        expect(connector.capabilities.media).toBe(true)
      })
    })

    describe('get', () => {
      it('should return connector by channel name', () => {
        cc.register(makeConnector({ channel: 'telegram', to: '123' }))

        expect(cc.get('telegram')).not.toBeNull()
        expect(cc.get('telegram')!.channel).toBe('telegram')
      })

      it('should return null for unknown channel', () => {
        expect(cc.get('nonexistent')).toBeNull()
      })
    })

    describe('notify', () => {
      it('should fall back to first connector when no interaction yet', async () => {
        cc.register(makeConnector({ channel: 'telegram' }))

        const result = await cc.notify('hello')

        expect(result.delivered).toBe(true)
        expect(result.channel).toBe('telegram')
      })

      it('should return delivered: false when no connectors registered', async () => {
        const result = await cc.notify('hello')

        expect(result.delivered).toBe(false)
        expect(result.channel).toBeUndefined()
      })

      it('should pass media in payload', async () => {
        const payloads: SendPayload[] = []
        cc.register(makeConnector({
          channel: 'web',
          capabilities: { push: true, media: true },
          send: async (payload) => { payloads.push(payload); return { delivered: true } },
        }))

        await cc.notify('chart', {
          media: [{ type: 'image', path: '/tmp/screenshot.png' }],
          source: 'cron',
        })

        expect(payloads[0].media).toHaveLength(1)
        expect(payloads[0].media![0].path).toBe('/tmp/screenshot.png')
      })

      it('should default kind to notification', async () => {
        const payloads: SendPayload[] = []
        cc.register(makeConnector({
          channel: 'web',
          send: async (payload) => { payloads.push(payload); return { delivered: true } },
        }))

        await cc.notify('hello')

        expect(payloads[0].kind).toBe('notification')
      })

      it('should respect explicit kind override', async () => {
        const payloads: SendPayload[] = []
        cc.register(makeConnector({
          channel: 'web',
          send: async (payload) => { payloads.push(payload); return { delivered: true } },
        }))

        await cc.notify('hello', { kind: 'message' })

        expect(payloads[0].kind).toBe('message')
      })
    })

    describe('broadcast', () => {
      it('should send to all push-capable connectors', async () => {
        const delivered: string[] = []
        cc.register(makeConnector({
          channel: 'telegram',
          capabilities: { push: true, media: false },
          send: async () => { delivered.push('telegram'); return { delivered: true } },
        }))
        cc.register(makeConnector({
          channel: 'web',
          capabilities: { push: true, media: true },
          send: async () => { delivered.push('web'); return { delivered: true } },
        }))
        cc.register(makeConnector({
          channel: 'mcp-ask',
          capabilities: { push: false, media: false },
          send: async () => { delivered.push('mcp-ask'); return { delivered: false } },
        }))

        const results = await cc.broadcast('hello')

        expect(results).toHaveLength(2) // telegram + web, not mcp-ask
        expect(delivered).toEqual(['telegram', 'web'])
        expect(results.every((r) => r.delivered)).toBe(true)
      })

      it('should return empty array when no push-capable connectors', async () => {
        cc.register(makeConnector({
          channel: 'mcp-ask',
          capabilities: { push: false, media: false },
        }))

        const results = await cc.broadcast('hello')

        expect(results).toHaveLength(0)
      })

      it('should handle individual send failures gracefully', async () => {
        cc.register(makeConnector({
          channel: 'telegram',
          capabilities: { push: true, media: false },
          send: async () => { throw new Error('send failed') },
        }))
        cc.register(makeConnector({
          channel: 'web',
          capabilities: { push: true, media: false },
          send: async () => ({ delivered: true }),
        }))

        const results = await cc.broadcast('hello')

        expect(results).toHaveLength(2)
        expect(results[0]).toMatchObject({ delivered: false, channel: 'telegram' })
        expect(results[1]).toMatchObject({ delivered: true, channel: 'web' })
      })
    })

    describe('send (direct connector)', () => {
      it('should pass structured payload to connector', async () => {
        const payloads: SendPayload[] = []
        cc.register(makeConnector({
          channel: 'web',
          send: async (payload) => { payloads.push(payload); return { delivered: true } },
        }))

        const target = cc.get('web')!
        await target.send({ kind: 'notification', text: 'hello', source: 'heartbeat' })

        expect(payloads).toHaveLength(1)
        expect(payloads[0].text).toBe('hello')
        expect(payloads[0].kind).toBe('notification')
        expect(payloads[0].source).toBe('heartbeat')
      })

      it('should return delivered: false for pull-based connectors', async () => {
        cc.register(makeConnector({
          channel: 'mcp-ask',
          capabilities: { push: false, media: false },
          send: async () => ({ delivered: false }),
        }))

        const target = cc.get('mcp-ask')!
        const result = await target.send({ kind: 'notification', text: 'test' })

        expect(result.delivered).toBe(false)
      })
    })
  })

  describe('with EventLog', () => {
    let cc: ConnectorCenter
    let eventLog: EventLog
    let listenerRegistry: ReturnType<typeof createListenerRegistry>

    beforeEach(async () => {
      const logPath = join(tmpdir(), `cc-test-${randomUUID()}.jsonl`)
      eventLog = await createEventLog({ logPath })
      listenerRegistry = createListenerRegistry(eventLog)
      await listenerRegistry.start()
      cc = new ConnectorCenter({ eventLog, listenerRegistry })
    })

    afterEach(async () => {
      await listenerRegistry.stop()
      await eventLog._resetForTest()
    })

    it('should auto-track interaction from message.received event', async () => {
      await eventLog.append('message.received', {
        channel: 'telegram', to: '123', prompt: 'hello',
      })

      // Subscription is synchronous within append
      const last = cc.getLastInteraction()
      expect(last).not.toBeNull()
      expect(last!.channel).toBe('telegram')
      expect(last!.to).toBe('123')
    })

    it('should update on subsequent events', async () => {
      await eventLog.append('message.received', {
        channel: 'telegram', to: '123', prompt: 'hi',
      })
      await eventLog.append('message.received', {
        channel: 'web', to: 'default', prompt: 'hello',
      })

      const last = cc.getLastInteraction()
      expect(last!.channel).toBe('web')
      expect(last!.to).toBe('default')
    })

    it('should route notify to last-interacted connector', async () => {
      const payloads: SendPayload[] = []
      cc.register(makeConnector({ channel: 'telegram' }))
      cc.register(makeConnector({
        channel: 'discord',
        send: async (payload) => { payloads.push(payload); return { delivered: true } },
      }))

      await eventLog.append('message.received', {
        channel: 'discord', to: '#general', prompt: 'test',
      })

      const result = await cc.notify('hello', { source: 'heartbeat' })

      expect(result.delivered).toBe(true)
      expect(result.channel).toBe('discord')
      expect(payloads).toHaveLength(1)
      expect(payloads[0].text).toBe('hello')
    })

    it('should fall back when last-interacted channel was unregistered', async () => {
      const unregister = cc.register(makeConnector({ channel: 'telegram' }))
      cc.register(makeConnector({ channel: 'discord' }))

      await eventLog.append('message.received', {
        channel: 'telegram', to: '123', prompt: 'hi',
      })
      unregister()

      const result = await cc.notify('hello')

      expect(result.delivered).toBe(true)
      expect(result.channel).toBe('discord')
    })

    it('should ignore non-message events', async () => {
      await eventLog.append('cron.fire', {
        jobId: 'abc', jobName: 'test', payload: 'hi',
      })

      expect(cc.getLastInteraction()).toBeNull()
    })
  })

  describe('shared connectors producer', () => {
    let eventLog: EventLog
    let listenerRegistry: ReturnType<typeof createListenerRegistry>
    let cc: ConnectorCenter

    beforeEach(async () => {
      const logPath = join(tmpdir(), `cc-test-${randomUUID()}.jsonl`)
      eventLog = await createEventLog({ logPath })
      listenerRegistry = createListenerRegistry(eventLog)
      await listenerRegistry.start()
      cc = new ConnectorCenter({ eventLog, listenerRegistry })
    })

    afterEach(async () => {
      cc.stop()
      await listenerRegistry.stop()
      await eventLog._resetForTest()
    })

    it('declares a single `connectors` producer on construction', () => {
      const producers = listenerRegistry.listProducers()
      const connectorsProducer = producers.find((p) => p.name === 'connectors')

      expect(connectorsProducer).toBeDefined()
      expect(connectorsProducer!.emits).toEqual(['message.received', 'message.sent'])
      expect(connectorsProducer!.emitsWildcard).toBe(false)

      // And nobody else owns the old per-plugin names
      expect(producers.find((p) => p.name === 'web-chat')).toBeUndefined()
      expect(producers.find((p) => p.name === 'telegram-connector')).toBeUndefined()
    })

    it('emitMessageReceived appends a message.received event', async () => {
      const entry = await cc.emitMessageReceived({
        channel: 'web', to: 'default', prompt: 'hi',
      })

      expect(entry.type).toBe('message.received')
      expect(entry.payload).toEqual({ channel: 'web', to: 'default', prompt: 'hi' })
      expect(entry.seq).toBeGreaterThan(0)

      const recent = eventLog.recent({ type: 'message.received' })
      expect(recent).toHaveLength(1)
    })

    it('emitMessageSent appends a message.sent event', async () => {
      const entry = await cc.emitMessageSent({
        channel: 'telegram', to: '123', prompt: 'hi', reply: 'hello', durationMs: 42,
      })

      expect(entry.type).toBe('message.sent')
      expect(entry.payload).toMatchObject({ channel: 'telegram', reply: 'hello', durationMs: 42 })
    })

    it('emitMessageReceived from any channel is picked up by the interaction tracker', async () => {
      await cc.emitMessageReceived({ channel: 'discord', to: '#general', prompt: 'hi' })

      const last = cc.getLastInteraction()
      expect(last).not.toBeNull()
      expect(last!.channel).toBe('discord')
      expect(last!.to).toBe('#general')
    })

    it('stop() disposes the producer so the name is free again', () => {
      expect(listenerRegistry.listProducers().some((p) => p.name === 'connectors')).toBe(true)
      cc.stop()
      expect(listenerRegistry.listProducers().some((p) => p.name === 'connectors')).toBe(false)

      // Name is free — a fresh center on the same registry can be constructed again
      const cc2 = new ConnectorCenter({ eventLog, listenerRegistry })
      expect(listenerRegistry.listProducers().some((p) => p.name === 'connectors')).toBe(true)
      cc2.stop()
    })

    it('stop() unregisters the interaction-tracker listener', () => {
      const beforeCount = listenerRegistry.list().filter((l) => l.name === 'connector-interaction-tracker').length
      expect(beforeCount).toBe(1)
      cc.stop()
      const afterCount = listenerRegistry.list().filter((l) => l.name === 'connector-interaction-tracker').length
      expect(afterCount).toBe(0)
    })
  })

  describe('without a listener registry', () => {
    it('emitMessageReceived throws with a clear message', async () => {
      const cc = new ConnectorCenter()
      await expect(
        cc.emitMessageReceived({ channel: 'web', to: 'default', prompt: 'x' }),
      ).rejects.toThrow(/no ListenerRegistry/)
    })

    it('emitMessageSent throws with a clear message', async () => {
      const cc = new ConnectorCenter()
      await expect(
        cc.emitMessageSent({ channel: 'web', to: 'default', prompt: 'x', reply: 'y', durationMs: 1 }),
      ).rejects.toThrow(/no ListenerRegistry/)
    })

    it('stop() is a no-op (safe to call)', () => {
      const cc = new ConnectorCenter()
      expect(() => cc.stop()).not.toThrow()
    })
  })
})
