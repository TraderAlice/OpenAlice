import { describe, it, expect, beforeEach } from 'vitest'
import {
  registerConnector,
  touchInteraction,
  getLastInteraction,
  resolveDeliveryTarget,
  listConnectors,
  hasConnectors,
  _resetForTest,
  type Connector,
  type DeliveryPayload,
} from './connector-registry.js'

beforeEach(() => {
  _resetForTest()
})

function makeConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    channel: 'test',
    to: 'default',
    capabilities: { push: true, media: false },
    deliver: async () => ({ delivered: true }),
    ...overrides,
  }
}

describe('connector-registry', () => {
  describe('registerConnector', () => {
    it('should register and list connectors', () => {
      registerConnector(makeConnector({ channel: 'telegram', to: '123' }))

      expect(hasConnectors()).toBe(true)
      expect(listConnectors()).toHaveLength(1)
      expect(listConnectors()[0].channel).toBe('telegram')
    })

    it('should replace existing registration for same channel', () => {
      registerConnector(makeConnector({ channel: 'telegram', to: '123' }))
      registerConnector(makeConnector({ channel: 'telegram', to: '456' }))

      expect(listConnectors()).toHaveLength(1)
      expect(listConnectors()[0].to).toBe('456')
    })

    it('should support multiple channels', () => {
      registerConnector(makeConnector({ channel: 'telegram', to: '123' }))
      registerConnector(makeConnector({ channel: 'discord', to: '#general' }))

      expect(listConnectors()).toHaveLength(2)
    })

    it('should return an unregister function', () => {
      const unregister = registerConnector(makeConnector({ channel: 'telegram', to: '123' }))

      expect(hasConnectors()).toBe(true)
      unregister()
      expect(hasConnectors()).toBe(false)
    })

    it('should expose capabilities', () => {
      registerConnector(makeConnector({
        channel: 'telegram',
        capabilities: { push: true, media: true },
      }))

      const connector = listConnectors()[0]
      expect(connector.capabilities.push).toBe(true)
      expect(connector.capabilities.media).toBe(true)
    })
  })

  describe('touchInteraction', () => {
    it('should record the last interaction', () => {
      touchInteraction('telegram', '123')

      const last = getLastInteraction()
      expect(last).not.toBeNull()
      expect(last!.channel).toBe('telegram')
      expect(last!.to).toBe('123')
      expect(last!.ts).toBeGreaterThan(0)
    })

    it('should update on subsequent interactions', () => {
      touchInteraction('telegram', '123')
      touchInteraction('discord', '#general')

      const last = getLastInteraction()
      expect(last!.channel).toBe('discord')
      expect(last!.to).toBe('#general')
    })
  })

  describe('resolveDeliveryTarget', () => {
    it('should return last-interacted connector', () => {
      registerConnector(makeConnector({ channel: 'telegram', to: '123' }))
      const dc = makeConnector({ channel: 'discord', to: '#general' })
      registerConnector(dc)

      touchInteraction('discord', '#general')

      const target = resolveDeliveryTarget()
      expect(target).not.toBeNull()
      expect(target!.channel).toBe('discord')
    })

    it('should fall back to first connector when no interaction yet', () => {
      registerConnector(makeConnector({ channel: 'telegram', to: '123' }))

      const target = resolveDeliveryTarget()
      expect(target).not.toBeNull()
      expect(target!.channel).toBe('telegram')
    })

    it('should fall back when last-interacted channel was unregistered', () => {
      const unregister = registerConnector(makeConnector({ channel: 'telegram', to: '123' }))
      registerConnector(makeConnector({ channel: 'discord', to: '#general' }))

      touchInteraction('telegram', '123')
      unregister()

      const target = resolveDeliveryTarget()
      expect(target).not.toBeNull()
      expect(target!.channel).toBe('discord')
    })

    it('should return null when no connectors registered', () => {
      const target = resolveDeliveryTarget()
      expect(target).toBeNull()
    })

    it('should return null when no connectors and no interaction', () => {
      touchInteraction('telegram', '123')

      const target = resolveDeliveryTarget()
      expect(target).toBeNull()
    })
  })

  describe('deliver', () => {
    it('should pass structured payload to connector', async () => {
      const payloads: DeliveryPayload[] = []
      registerConnector(makeConnector({
        channel: 'web',
        deliver: async (payload) => {
          payloads.push(payload)
          return { delivered: true }
        },
      }))

      const target = resolveDeliveryTarget()!
      await target.deliver({ text: 'hello', source: 'heartbeat' })

      expect(payloads).toHaveLength(1)
      expect(payloads[0].text).toBe('hello')
      expect(payloads[0].source).toBe('heartbeat')
    })

    it('should pass media in payload', async () => {
      const payloads: DeliveryPayload[] = []
      registerConnector(makeConnector({
        channel: 'web',
        capabilities: { push: true, media: true },
        deliver: async (payload) => {
          payloads.push(payload)
          return { delivered: true }
        },
      }))

      const target = resolveDeliveryTarget()!
      await target.deliver({
        text: 'chart',
        media: [{ type: 'image', path: '/tmp/screenshot.png' }],
        source: 'cron',
      })

      expect(payloads[0].media).toHaveLength(1)
      expect(payloads[0].media![0].path).toBe('/tmp/screenshot.png')
    })

    it('should return delivered: false for pull-based connectors', async () => {
      registerConnector(makeConnector({
        channel: 'mcp-ask',
        capabilities: { push: false, media: false },
        deliver: async () => ({ delivered: false }),
      }))

      const target = resolveDeliveryTarget()!
      const result = await target.deliver({ text: 'test' })

      expect(result.delivered).toBe(false)
    })
  })
})
