import { describe, it, expect } from 'vitest'
import { AgentEventSchemas, validateEventPayload } from './agent-event.js'
import type { AgentEventMap } from './agent-event.js'

// ==================== Schema Completeness ====================

describe('AgentEventSchemas', () => {
  const expectedTypes: (keyof AgentEventMap)[] = [
    'cron.fire', 'cron.done', 'cron.error',
    'heartbeat.done', 'heartbeat.skip', 'heartbeat.error',
    'message.received', 'message.sent',
    'trigger',
  ]

  it('should have a schema for every key in AgentEventMap', () => {
    for (const type of expectedTypes) {
      expect(AgentEventSchemas[type], `missing schema for "${type}"`).toBeDefined()
    }
  })

  it('should not have extra schemas beyond AgentEventMap', () => {
    const schemaKeys = Object.keys(AgentEventSchemas)
    expect(schemaKeys.sort()).toEqual([...expectedTypes].sort())
  })
})

// ==================== validateEventPayload ====================

describe('validateEventPayload', () => {
  // -- cron.fire --
  it('should accept valid cron.fire payload', () => {
    expect(() => validateEventPayload('cron.fire', {
      jobId: 'abc', jobName: 'test', payload: 'hello',
    })).not.toThrow()
  })

  it('should reject cron.fire with missing jobId', () => {
    expect(() => validateEventPayload('cron.fire', {
      jobName: 'test', payload: 'hello',
    })).toThrow(/Invalid payload.*cron\.fire/)
  })

  it('should reject cron.fire with wrong type (number instead of string)', () => {
    expect(() => validateEventPayload('cron.fire', {
      jobId: 123, jobName: 'test', payload: 'hello',
    })).toThrow(/Invalid payload.*cron\.fire/)
  })

  // -- cron.done --
  it('should accept valid cron.done payload', () => {
    expect(() => validateEventPayload('cron.done', {
      jobId: 'abc', jobName: 'test', reply: 'ok', durationMs: 100,
    })).not.toThrow()
  })

  // -- cron.error --
  it('should accept valid cron.error payload', () => {
    expect(() => validateEventPayload('cron.error', {
      jobId: 'abc', jobName: 'test', error: 'boom', durationMs: 50,
    })).not.toThrow()
  })

  // -- heartbeat.done --
  it('should accept valid heartbeat.done payload', () => {
    expect(() => validateEventPayload('heartbeat.done', {
      reply: 'all good', reason: 'CHAT_YES', durationMs: 200, delivered: true,
    })).not.toThrow()
  })

  // -- heartbeat.skip --
  it('should accept heartbeat.skip with optional parsedReason', () => {
    expect(() => validateEventPayload('heartbeat.skip', {
      reason: 'ack', parsedReason: 'All systems normal.',
    })).not.toThrow()
  })

  it('should accept heartbeat.skip without parsedReason', () => {
    expect(() => validateEventPayload('heartbeat.skip', {
      reason: 'outside-active-hours',
    })).not.toThrow()
  })

  it('should reject heartbeat.skip with missing reason', () => {
    expect(() => validateEventPayload('heartbeat.skip', {
      parsedReason: 'something',
    })).toThrow(/Invalid payload.*heartbeat\.skip/)
  })

  // -- heartbeat.error --
  it('should accept valid heartbeat.error payload', () => {
    expect(() => validateEventPayload('heartbeat.error', {
      error: 'timeout', durationMs: 5000,
    })).not.toThrow()
  })

  // -- message.received --
  it('should accept valid message.received payload', () => {
    expect(() => validateEventPayload('message.received', {
      channel: 'web', to: 'default', prompt: 'hello',
    })).not.toThrow()
  })

  // -- message.sent --
  it('should accept valid message.sent payload', () => {
    expect(() => validateEventPayload('message.sent', {
      channel: 'web', to: 'default', prompt: 'hello', reply: 'hi', durationMs: 300,
    })).not.toThrow()
  })

  it('should reject message.sent with missing reply', () => {
    expect(() => validateEventPayload('message.sent', {
      channel: 'web', to: 'default', prompt: 'hello', durationMs: 300,
    })).toThrow(/Invalid payload.*message\.sent/)
  })

  // -- trigger --
  it('should accept valid trigger payload', () => {
    expect(() => validateEventPayload('trigger', {
      source: 'webhook', name: 'price-alert', data: { symbol: 'BTC', price: 100000 },
    })).not.toThrow()
  })

  it('should accept trigger with empty data', () => {
    expect(() => validateEventPayload('trigger', {
      source: 'api', name: 'test', data: {},
    })).not.toThrow()
  })

  it('should reject trigger with missing source', () => {
    expect(() => validateEventPayload('trigger', {
      name: 'test', data: {},
    })).toThrow(/Invalid payload.*trigger/)
  })

  // -- unregistered types --
  it('should pass for unregistered event types', () => {
    expect(() => validateEventPayload('some.random.type', {
      anything: 'goes', here: 42,
    })).not.toThrow()
  })

  it('should pass for unregistered type with null payload', () => {
    expect(() => validateEventPayload('unknown.type', null)).not.toThrow()
  })
})
