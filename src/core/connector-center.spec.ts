import { describe, it, expect, beforeEach } from 'vitest'
import {
  ConnectorCenter,
  type Connector,
  type SendPayload,
} from './connector-center.js'

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

  describe('touch', () => {
    it('should record the last interaction', () => {
      cc.touch('telegram', '123')

      const last = cc.getLastInteraction()
      expect(last).not.toBeNull()
      expect(last!.channel).toBe('telegram')
      expect(last!.to).toBe('123')
      expect(last!.ts).toBeGreaterThan(0)
    })

    it('should update on subsequent interactions', () => {
      cc.touch('telegram', '123')
      cc.touch('discord', '#general')

      const last = cc.getLastInteraction()
      expect(last!.channel).toBe('discord')
      expect(last!.to).toBe('#general')
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
    it('should send to last-interacted connector', async () => {
      const payloads: SendPayload[] = []
      cc.register(makeConnector({ channel: 'telegram' }))
      cc.register(makeConnector({
        channel: 'discord',
        send: async (payload) => { payloads.push(payload); return { delivered: true } },
      }))
      cc.touch('discord', '#general')

      const result = await cc.notify('hello', { source: 'heartbeat' })

      expect(result.delivered).toBe(true)
      expect(result.channel).toBe('discord')
      expect(payloads).toHaveLength(1)
      expect(payloads[0].text).toBe('hello')
      expect(payloads[0].kind).toBe('notification')
      expect(payloads[0].source).toBe('heartbeat')
    })

    it('should fall back to first connector when no interaction yet', async () => {
      cc.register(makeConnector({ channel: 'telegram' }))

      const result = await cc.notify('hello')

      expect(result.delivered).toBe(true)
      expect(result.channel).toBe('telegram')
    })

    it('should fall back when last-interacted channel was unregistered', async () => {
      const unregister = cc.register(makeConnector({ channel: 'telegram' }))
      cc.register(makeConnector({ channel: 'discord' }))
      cc.touch('telegram', '123')
      unregister()

      const result = await cc.notify('hello')

      expect(result.delivered).toBe(true)
      expect(result.channel).toBe('discord')
    })

    it('should return delivered: false when no connectors registered', async () => {
      const result = await cc.notify('hello')

      expect(result.delivered).toBe(false)
      expect(result.channel).toBeUndefined()
    })

    it('should return delivered: false when no connectors and touch was called', async () => {
      cc.touch('telegram', '123')

      const result = await cc.notify('hello')

      expect(result.delivered).toBe(false)
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
