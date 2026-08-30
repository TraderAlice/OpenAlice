import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type {
  ConnectorAdapterConfig,
  ConnectorAdapterHealth,
  InboxNotification,
} from '@traderalice/connector-protocol'
import type { ConnectorAdapter, ConnectorAdapterContext } from './adapter.js'
import { ConnectorRegistry } from './adapter.js'
import {
  DeliveryManager,
  MAX_INBOUND_OWNER_MESSAGES,
} from './delivery-manager.js'
import { createConnectorIOEvent, type ConnectorIOEvent, type ConnectorIORecorder } from './io-events.js'
import type { ConnectorWorkKind, ConnectorWorkQueueStore } from './work-queue.js'

class MemoryWorkQueue implements ConnectorWorkQueueStore {
  private entries: Array<{ id: string; kind: ConnectorWorkKind; payload: unknown; claimId?: string }> = []
  async enqueue<T>(kind: ConnectorWorkKind, id: string, payload: T): Promise<void> {
    const limit = kind === 'inbound' ? 100 : 20
    if (this.entries.filter((entry) => entry.kind === kind).length >= limit) throw new Error(`Connector ${kind} queue is full. Try again.`)
    this.entries.push({ id, kind, payload })
  }
  async claim<T>(kind: ConnectorWorkKind, limit: number) {
    const claimId = `claim-${kind}`
    const selected = this.entries.filter((entry) => entry.kind === kind && !entry.claimId).slice(0, limit)
    selected.forEach((entry) => { entry.claimId = claimId })
    return { claimId, items: selected.map((entry) => ({ id: entry.id, payload: entry.payload as T })) }
  }
  async ack(claimId: string, itemIds: readonly string[]): Promise<void> {
    this.entries = this.entries.filter((entry) => entry.claimId !== claimId || !itemIds.includes(entry.id))
  }
  async release(claimId: string, itemIds: readonly string[]): Promise<void> {
    this.entries.forEach((entry) => {
      if (entry.claimId === claimId && itemIds.includes(entry.id)) delete entry.claimId
    })
  }
}

async function drainInbound(manager: DeliveryManager) {
  const claim = await manager.claimInbound()
  await manager.ackInbound(claim.claimId, claim.items.map((item) => item.id))
  return claim.items.map((item) => item.payload)
}

async function drainActions(manager: DeliveryManager) {
  const claim = await manager.claimActions()
  await manager.ackActions(claim.claimId, claim.items.map((item) => item.id))
  return claim.items.map((item) => item.payload)
}

async function drainUtaActions(manager: DeliveryManager) {
  const claim = await manager.claimUtaActions()
  await manager.ackActions(claim.claimId, claim.items.map((item) => item.id))
  return claim.items.map((item) => item.payload)
}

class MemoryRecorder implements ConnectorIORecorder {
  readonly events: ConnectorIOEvent[] = []
  async record(input: Parameters<ConnectorIORecorder['record']>[0]): Promise<void> {
    this.events.push(createConnectorIOEvent(input))
  }
}

class FakeThirdPartyAdapter implements ConnectorAdapter {
  readonly id = 'carrier-pigeon'
  readonly delivered: InboxNotification[] = []
  private status: ConnectorAdapterHealth['status'] = 'stopped'

  async start(_config: ConnectorAdapterConfig, _context: ConnectorAdapterContext): Promise<void> {
    this.status = 'healthy'
  }

  async stop(): Promise<void> {
    this.status = 'stopped'
  }

  async deliver(notification: InboxNotification): Promise<void> {
    this.delivered.push(notification)
  }

  async sendOwnerText(): Promise<void> {}

  health(): ConnectorAdapterHealth {
    return { id: this.id, enabled: true, status: this.status }
  }
}

describe('DeliveryManager connector registry', () => {
  it('runs an unrecognized third adapter without changing delivery core', async () => {
    const adapter = new FakeThirdPartyAdapter()
    const registry = new ConnectorRegistry()
    registry.register({
      definition: {
        id: 'carrier-pigeon',
        label: 'Carrier Pigeon',
        description: 'Test-only third connector.',
        fields: [],
        commands: [],
      },
      create: () => adapter,
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { 'carrier-pigeon': { enabled: true, settings: {} } } },
      updateAdapterSettings: vi.fn(),
      workQueue: new MemoryWorkQueue(),
    })

    await manager.start()
    await manager.deliver({
      id: 'inbox-1',
      createdAt: new Date().toISOString(),
      workspaceId: 'ws-1',
      title: 'Hello from Inbox',
      body: 'No Discord or Telegram branch was involved.',
    })

    expect(adapter.delivered).toHaveLength(1)
    expect(manager.health()).toMatchObject({ status: 'healthy' })
    await manager.acceptInbound({ connectorId: 'carrier-pigeon', userId: '1', text: 'hello' })
    expect(await drainInbound(manager)).toEqual([
      { connectorId: 'carrier-pigeon', userId: '1', text: 'hello' },
    ])
    expect(await drainInbound(manager)).toEqual([])
    await manager.acceptInbound({ connectorId: 'carrier-pigeon', userId: '1', text: '' })
    expect(await drainInbound(manager)).toEqual([])
    for (let i = 0; i < MAX_INBOUND_OWNER_MESSAGES; i += 1) {
      await manager.acceptInbound({ connectorId: 'carrier-pigeon', userId: '1', text: `m${i}` })
    }
    await expect(manager.acceptInbound({ connectorId: 'carrier-pigeon', userId: '1', text: 'overflow' }))
      .rejects.toThrow('queue is full')
    const kept = await drainInbound(manager)
    expect(kept).toHaveLength(MAX_INBOUND_OWNER_MESSAGES)
    expect(kept[0]?.text).toBe('m0')
    expect(kept.at(-1)?.text).toBe(`m${MAX_INBOUND_OWNER_MESSAGES - 1}`)
    await manager.stop()
  })

  it('replaces only the requested adapter during an explicit reconnect', async () => {
    const created: FakeThirdPartyAdapter[] = []
    const registry = new ConnectorRegistry()
    registry.register({
      definition: {
        id: 'carrier-pigeon',
        label: 'Carrier Pigeon',
        description: 'Test-only third connector.',
        fields: [],
        commands: [],
      },
      create: () => {
        const adapter = new FakeThirdPartyAdapter()
        created.push(adapter)
        return adapter
      },
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { 'carrier-pigeon': { enabled: true, settings: {} } } },
      updateAdapterSettings: vi.fn(),
    })

    await manager.start()
    const health = await manager.reconnect('carrier-pigeon')

    expect(created).toHaveLength(2)
    expect(created[0]?.health().status).toBe('stopped')
    expect(health.status).toBe('healthy')
    await manager.stop()
  })

  it('reconciles one adapter without stopping or recreating its peers', async () => {
    const calls = new Map<string, { starts: ReturnType<typeof vi.fn>; stops: ReturnType<typeof vi.fn>; created: number }>()
    const registry = new ConnectorRegistry()
    for (const id of ['alpha', 'beta']) {
      const state = { starts: vi.fn(), stops: vi.fn(), created: 0 }
      calls.set(id, state)
      registry.register({
        definition: { id, label: id, description: `${id} adapter`, fields: [], commands: [] },
        create: () => {
          state.created += 1
          let status: ConnectorAdapterHealth['status'] = 'stopped'
          return {
            id,
            start: async () => { state.starts(); status = 'healthy' },
            stop: async () => { state.stops(); status = 'stopped' },
            deliver: async () => undefined,
            sendOwnerText: async () => undefined,
            health: () => ({ id, enabled: true, status }),
          }
        },
      })
    }
    const manager = new DeliveryManager({
      registry,
      config: {
        version: 1,
        adapters: {
          alpha: { enabled: true, settings: { inboxPush: true } },
          beta: { enabled: true, settings: { inboxPush: true } },
        },
      },
      updateAdapterSettings: vi.fn(),
    })

    await manager.start()
    expect(calls.get('alpha')).toMatchObject({ created: 1 })
    expect(calls.get('beta')).toMatchObject({ created: 1 })

    expect(await manager.reconcile('alpha', { enabled: false, settings: {} })).toEqual({
      id: 'alpha',
      enabled: false,
      status: 'disabled',
    })
    expect(calls.get('alpha')?.stops).toHaveBeenCalledOnce()
    expect(calls.get('beta')?.stops).not.toHaveBeenCalled()
    expect(calls.get('beta')).toMatchObject({ created: 1 })

    await manager.reconcile('alpha', { enabled: true, settings: { inboxPush: false } })
    expect(calls.get('alpha')).toMatchObject({ created: 2 })
    expect(calls.get('alpha')?.starts).toHaveBeenCalledTimes(2)
    expect(calls.get('beta')?.starts).toHaveBeenCalledOnce()
    expect(calls.get('beta')?.stops).not.toHaveBeenCalled()
    await manager.stop()
  })

  it('reports starting adapters before external startup finishes', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const adapter: ConnectorAdapter = {
      id: 'slow',
      start: async () => { await gate },
      stop: async () => undefined,
      deliver: async () => undefined,
      sendOwnerText: async () => undefined,
      health: () => ({ id: 'slow', enabled: true, status: 'starting' }),
    }
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: 'slow', label: 'Slow', description: 'Slow adapter.', fields: [], commands: [] },
      create: () => adapter,
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { slow: { enabled: true, settings: {} } } },
      updateAdapterSettings: async () => undefined,
    })

    manager.installEnabledAdapters()
    expect(manager.health()).toMatchObject({
      status: 'healthy',
      adapters: [{ id: 'slow', status: 'starting' }],
    })

    const started = manager.start()
    release()
    await started
    await manager.stop()
  })

  it('keeps a failed adapter registered so its degraded health remains visible', async () => {
    const adapter: ConnectorAdapter = {
      id: 'broken',
      start: async () => { throw new Error('Telegram API did not become ready') },
      stop: async () => undefined,
      deliver: async () => { throw new Error('Telegram is not ready') },
      sendOwnerText: async () => undefined,
      health: () => ({
        id: 'broken',
        enabled: true,
        status: 'degraded',
        lastError: 'Telegram API did not become ready',
      }),
    }
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: 'broken', label: 'Broken', description: 'Broken adapter.', fields: [], commands: [] },
      create: () => adapter,
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { broken: { enabled: true, settings: {} } } },
      updateAdapterSettings: async () => undefined,
      adapterStartRetryDelayMs: 60_000,
    })

    await manager.start()

    expect(manager.health()).toMatchObject({
      status: 'degraded',
      adapters: [{ id: 'broken', status: 'degraded', lastError: 'Telegram API did not become ready' }],
    })
    await manager.stop()
  })

  it('retries a transient adapter start failure without dropping the registration', async () => {
    let attempts = 0
    let status: ConnectorAdapterHealth['status'] = 'degraded'
    const adapter: ConnectorAdapter = {
      id: 'flaky',
      classifyStartFailure: () => 'retry',
      start: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('Telegram polling did not become ready within 15000ms')
        status = 'healthy'
      },
      stop: async () => { status = 'stopped' },
      deliver: async () => undefined,
      sendOwnerText: async () => undefined,
      health: () => ({ id: 'flaky', enabled: true, status }),
    }
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: 'flaky', label: 'Flaky', description: 'Flaky adapter.', fields: [], commands: [] },
      create: () => adapter,
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { flaky: { enabled: true, settings: {} } } },
      updateAdapterSettings: async () => undefined,
      adapterStartRetryDelayMs: 5,
    })

    await manager.start()
    expect(attempts).toBe(1)
    expect(manager.health().adapters[0]?.status).toBe('degraded')

    await vi.waitFor(() => {
      expect(attempts).toBe(2)
      expect(manager.health().adapters[0]?.status).toBe('healthy')
    })
    await manager.stop()
  })

  it('does not retry a configuration error', async () => {
    let attempts = 0
    const adapter: ConnectorAdapter = {
      id: 'invalid',
      start: async () => {
        attempts += 1
        throw new Error('Telegram setting botToken is required')
      },
      stop: async () => undefined,
      deliver: async () => undefined,
      sendOwnerText: async () => undefined,
      health: () => ({
        id: 'invalid',
        enabled: true,
        status: 'degraded',
        lastError: 'Telegram setting botToken is required',
      }),
    }
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: 'invalid', label: 'Invalid', description: 'Invalid adapter.', fields: [], commands: [] },
      create: () => adapter,
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { invalid: { enabled: true, settings: {} } } },
      updateAdapterSettings: async () => undefined,
      adapterStartRetryDelayMs: 5,
    })

    await manager.start()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(attempts).toBe(1)
    await manager.stop()
  })

  it('cancels a pending start retry on stop', async () => {
    let attempts = 0
    const adapter: ConnectorAdapter = {
      id: 'slow-fail',
      classifyStartFailure: () => 'retry',
      start: async () => {
        attempts += 1
        throw new Error('Network request for \'getMe\' failed!')
      },
      stop: async () => undefined,
      deliver: async () => undefined,
      sendOwnerText: async () => undefined,
      health: () => ({ id: 'slow-fail', enabled: true, status: 'degraded' }),
    }
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: 'slow-fail', label: 'Slow fail', description: 'Fails.', fields: [], commands: [] },
      create: () => adapter,
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { 'slow-fail': { enabled: true, settings: {} } } },
      updateAdapterSettings: async () => undefined,
      adapterStartRetryDelayMs: 50,
    })

    await manager.start()
    expect(attempts).toBe(1)
    await manager.stop()
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(attempts).toBe(1)
  })

  it('contains adapter delivery failures', async () => {
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: 'broken', label: 'Broken', description: 'Broken adapter.', fields: [], commands: [] },
      create: () => ({
        id: 'broken',
        start: async () => undefined,
        stop: async () => undefined,
        deliver: async () => { throw new Error('external outage') },
        sendOwnerText: async () => undefined,
        health: () => ({ id: 'broken', enabled: true, status: 'degraded' as const, lastError: 'external outage' }),
      }),
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { broken: { enabled: true, settings: {} } } },
      updateAdapterSettings: vi.fn(),
    })
    await manager.start()

    await expect(manager.deliver({
      id: 'inbox-2',
      createdAt: new Date().toISOString(),
      workspaceId: 'ws-1',
      title: 'Still durable',
      body: '',
    })).resolves.toBeUndefined()
  })

  it('skips Inbox push when the adapter turned it off', async () => {
    const deliver = vi.fn(async () => undefined)
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: 'quiet', label: 'Quiet', description: 'Quiet adapter.', fields: [], commands: [] },
      create: () => ({
        id: 'quiet',
        start: async () => undefined,
        stop: async () => undefined,
        deliver,
        sendOwnerText: async () => undefined,
        health: () => ({ id: 'quiet', enabled: true, status: 'healthy' as const }),
      }),
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { quiet: { enabled: true, settings: { inboxPush: false } } } },
      updateAdapterSettings: vi.fn(),
    })
    await manager.start()
    await manager.deliver({
      id: 'inbox-3',
      createdAt: new Date().toISOString(),
      workspaceId: 'ws-1',
      title: 'Stay local',
      body: '',
    })
    expect(deliver).not.toHaveBeenCalled()
    await manager.stop()
  })

  it('contains asynchronous owner-chat failures after accepting the projection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: 'broken', label: 'Broken', description: 'Broken adapter.', fields: [], commands: [] },
      create: () => ({
        id: 'broken',
        start: async () => undefined,
        stop: async () => undefined,
        deliver: async () => undefined,
        sendOwnerText: async () => { throw new Error('owner chat offline') },
        health: () => ({ id: 'broken', enabled: true, status: 'degraded' as const }),
      }),
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { broken: { enabled: true, settings: {} } } },
      updateAdapterSettings: vi.fn(),
    })
    await manager.start()

    expect(manager.enqueueOwnerChat({
      id: 'desk-comment-1',
      adapterId: 'broken',
      conversationId: 'comment-1',
      phase: 'final',
      text: 'hello',
    }))
      .toEqual({ accepted: true, deliveryId: 'desk-comment-1' })
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
      '[connector] broken owner-chat delivery failed:',
      'owner chat offline',
    ))
    warn.mockRestore()
  })

  it('treats an online bot waiting for /link as an intentional setup phase', async () => {
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: 'unlinked', label: 'Unlinked', description: 'Waiting for owner.', fields: [], commands: [] },
      create: () => ({
        id: 'unlinked',
        start: async () => undefined,
        stop: async () => undefined,
        deliver: async () => { throw new Error('owner not linked') },
        sendOwnerText: async () => undefined,
        health: () => ({ id: 'unlinked', enabled: true, status: 'awaiting_link' as const }),
      }),
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { unlinked: { enabled: true, settings: {} } } },
      updateAdapterSettings: vi.fn(),
    })

    await manager.start()

    expect(manager.health()).toMatchObject({
      status: 'healthy',
      adapters: [{ id: 'unlinked', status: 'awaiting_link' }],
    })
  })

  it('records replayable ingress and per-adapter delivery results', async () => {
    const recorder = new MemoryRecorder()
    const adapter = new FakeThirdPartyAdapter()
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: adapter.id, label: 'Fake', description: 'Fake.', fields: [], commands: [] },
      create: () => adapter,
    })
    const manager = new DeliveryManager({
      registry,
      recorder,
      config: { version: 1, adapters: { [adapter.id]: { enabled: true, settings: {} } } },
      updateAdapterSettings: vi.fn(),
      workQueue: new MemoryWorkQueue(),
    })
    await manager.start()
    const content = Buffer.from('# Report\n')
    const source = Buffer.from('# Source report\n')
    const receipt = manager.enqueue({
      id: 'inbox-recorded',
      createdAt: new Date().toISOString(),
      workspaceId: 'ws-1',
      title: 'Replay me',
      body: 'Recorded payload',
      attachments: [{
        filename: 'report.md',
        mediaType: 'text/markdown; charset=utf-8',
        sizeBytes: content.byteLength,
        contentSha256: createHash('sha256').update(content).digest('hex'),
        source: {
          sizeBytes: source.byteLength,
          contentSha256: createHash('sha256').update(source).digest('hex'),
          detectedEncoding: 'windows-1252',
          detectionConfidence: 35,
        },
        contentBase64: content.toString('base64'),
      }],
    })

    await vi.waitFor(() => expect(adapter.delivered).toHaveLength(1))
    expect(recorder.events.map((event) => event.stage)).toEqual([
      'notification.received',
      'delivery.attempted',
      'delivery.succeeded',
    ])
    expect(recorder.events.every((event) => event.correlationId === receipt.deliveryId)).toBe(true)
    expect(recorder.events[0]?.payload).toMatchObject({ notification: { id: 'inbox-recorded' } })
    expect(adapter.delivered[0]?.attachments?.[0]?.contentBase64).toBe(content.toString('base64'))
    expect(recorder.events[0]?.payload).toMatchObject({
      attachmentEvidence: [{
        filename: 'report.md',
        sizeBytes: content.byteLength,
        source: {
          sizeBytes: source.byteLength,
          detectedEncoding: 'windows-1252',
        },
        normalized: true,
      }],
    })
    expect(JSON.stringify(recorder.events)).not.toContain(content.toString('base64'))
  })

  it('does not let a broken recorder block external delivery', async () => {
    const adapter = new FakeThirdPartyAdapter()
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: adapter.id, label: 'Fake', description: 'Fake.', fields: [], commands: [] },
      create: () => adapter,
    })
    const manager = new DeliveryManager({
      registry,
      recorder: { record: async () => { throw new Error('disk full') } },
      config: { version: 1, adapters: { [adapter.id]: { enabled: true, settings: {} } } },
      updateAdapterSettings: vi.fn(),
    })
    await manager.start()
    await manager.deliver({
      id: 'inbox-no-log', createdAt: new Date().toISOString(), workspaceId: 'ws-1', title: 'Still send', body: '',
    })
    expect(adapter.delivered).toHaveLength(1)
  })

  it('keeps artifact requests bounded, TTL-limited, and separate from phone-desk inbound', async () => {
    const now = Date.parse('2026-08-14T15:02:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const adapter = new FakeThirdPartyAdapter()
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: adapter.id, label: 'Fake', description: 'Fake.', fields: [], commands: [] },
      create: () => adapter,
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { [adapter.id]: { enabled: true, settings: {} } } },
      updateAdapterSettings: vi.fn(),
      workQueue: new MemoryWorkQueue(),
    })
    try {
      await manager.start()

      const requestId = await manager.enqueueArtifactRequest(adapter.id, { entryId: 'entry-1', docIndex: 0 })
      expect(requestId.startsWith('art-')).toBe(true)
      await manager.acceptInbound({ connectorId: adapter.id, userId: '1', text: 'desk' })
      expect(await drainInbound(manager)).toEqual([
        { connectorId: adapter.id, userId: '1', text: 'desk' },
      ])
      expect(await drainActions(manager)).toEqual([expect.objectContaining({
        requestId,
        connectorId: adapter.id,
        entryId: 'entry-1',
        docIndex: 0,
      })])
      expect(await drainActions(manager)).toEqual([])

      await manager.enqueueArtifactRequest(adapter.id, { entryId: 'stale', docIndex: 1 })
      vi.setSystemTime(now + 60_001)
      expect(await drainActions(manager)).toEqual([expect.objectContaining({
        connectorId: adapter.id,
        entryId: 'stale',
        docIndex: 1,
      })])

      for (let index = 0; index < 20; index += 1) {
        await manager.enqueueArtifactRequest(adapter.id, { entryId: `entry-${index}`, docIndex: 0 })
      }
      await expect(manager.enqueueArtifactRequest(adapter.id, { entryId: 'overflow', docIndex: 0 }))
        .rejects.toThrow('queue is full')
    } finally {
      vi.useRealTimers()
      await manager.stop()
    }
  })

  it('leaves request expiry to Alice after a durable claim', async () => {
    const now = Date.parse('2026-08-14T15:02:00.000Z')
    vi.useFakeTimers()
    vi.setSystemTime(now)
    const notices: string[] = []
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: 'telegram', label: 'Telegram', description: 'Telegram.', fields: [], commands: [] },
      create: () => ({
        id: 'telegram',
        start: async () => undefined,
        stop: async () => undefined,
        deliver: async () => undefined,
        sendOwnerText: async (text) => { notices.push(text) },
        health: () => ({ id: 'telegram', enabled: true, status: 'healthy' as const }),
      }),
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { telegram: { enabled: true, settings: {} } } },
      updateAdapterSettings: vi.fn(),
      workQueue: new MemoryWorkQueue(),
    })
    try {
      await manager.start()
      await manager.enqueueArtifactRequest('telegram', { entryId: 'stale', docIndex: 0 })
      vi.setSystemTime(now + 60_001)
      await manager.enqueueArtifactRequest('telegram', { entryId: 'fresh', docIndex: 0 })
      expect(notices).toEqual([])
      expect(await drainActions(manager)).toEqual([
        expect.objectContaining({ entryId: 'stale' }),
        expect.objectContaining({ entryId: 'fresh' }),
      ])
    } finally {
      vi.useRealTimers()
      await manager.stop()
    }
  })

  it('keeps UTA review requests off the Inbox artifact drain', async () => {
    const presented: unknown[] = []
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: 'telegram', label: 'Telegram', description: 'Telegram.', fields: [], commands: [] },
      create: () => ({
        id: 'telegram',
        start: async () => undefined,
        stop: async () => undefined,
        deliver: async () => undefined,
        sendOwnerText: async () => undefined,
        presentUta: async (presentation) => { presented.push(presentation) },
        health: () => ({ id: 'telegram', enabled: true, status: 'healthy' as const }),
      }),
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { telegram: { enabled: true, settings: {} } } },
      updateAdapterSettings: vi.fn(),
      workQueue: new MemoryWorkQueue(),
    })
    await manager.start()
    const requestId = await manager.enqueueUtaRequest('telegram', { action: 'review' })
    expect(requestId.startsWith('uta-')).toBe(true)
    expect(await drainActions(manager)).toEqual([])
    expect(await drainUtaActions(manager)).toEqual([expect.objectContaining({
      requestId,
      connectorId: 'telegram',
      action: 'review',
    })])
    await manager.presentUta({
      requestId,
      connectorId: 'telegram',
      review: {
        generatedAt: '2026-08-19T12:00:00.000Z',
        accounts: [{
          id: 'alpaca-paper',
          label: 'Alpaca paper',
          pendingMessage: 'long AAPL',
          pendingHash: 'abc12345',
          stagedCount: 1,
          hiddenOperationCount: 0,
          operations: [{ action: 'placeOrder', summary: 'BUY AAPL MKT × 10' }],
        }],
      },
    })
    expect(presented).toHaveLength(1)
    await manager.stop()
  })

  it('delivers an artifact only to the requesting connector', async () => {
    const content = Buffer.from('# Current\n')
    const telegramDelivered: unknown[] = []
    const otherDelivered: InboxNotification[] = []
    const otherArtifacts: unknown[] = []
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: 'telegram', label: 'Telegram', description: 'Telegram.', fields: [], commands: [] },
      create: () => ({
        id: 'telegram',
        start: async () => undefined,
        stop: async () => undefined,
        deliver: async () => undefined,
        sendOwnerText: async () => undefined,
        deliverArtifact: async (delivery) => { telegramDelivered.push(delivery) },
        health: () => ({ id: 'telegram', enabled: true, status: 'healthy' as const }),
      }),
    })
    registry.register({
      definition: { id: 'discord', label: 'Discord', description: 'Discord.', fields: [], commands: [] },
      create: () => ({
        id: 'discord',
        start: async () => undefined,
        stop: async () => undefined,
        deliver: async (notification) => { otherDelivered.push(notification) },
        sendOwnerText: async () => undefined,
        deliverArtifact: async (delivery) => { otherArtifacts.push(delivery) },
        health: () => ({ id: 'discord', enabled: true, status: 'healthy' as const }),
      }),
    })
    const manager = new DeliveryManager({
      registry,
      config: {
        version: 1,
        adapters: {
          telegram: { enabled: true, settings: {} },
          discord: { enabled: true, settings: {} },
        },
      },
      updateAdapterSettings: vi.fn(),
    })
    await manager.start()
    await manager.deliverArtifact({
      requestId: 'art-1',
      connectorId: 'telegram',
      entryId: 'entry-1',
      docIndex: 0,
      attachment: {
        filename: 'close.md',
        mediaType: 'text/markdown',
        sizeBytes: content.byteLength,
        contentSha256: createHash('sha256').update(content).digest('hex'),
        contentBase64: content.toString('base64'),
      },
    })
    expect(telegramDelivered).toHaveLength(1)
    expect(otherArtifacts).toEqual([])
    expect(otherDelivered).toEqual([])
    await manager.stop()
  })

  it('does not treat a directed artifact as an Inbox notification', async () => {
    const delivered: InboxNotification[] = []
    const artifacts: unknown[] = []
    const registry = new ConnectorRegistry()
    registry.register({
      definition: { id: 'telegram', label: 'Telegram', description: 'Telegram.', fields: [], commands: [] },
      create: () => ({
        id: 'telegram',
        start: async () => undefined,
        stop: async () => undefined,
        deliver: async (notification) => { delivered.push(notification) },
        sendOwnerText: async () => undefined,
        deliverArtifact: async (delivery) => { artifacts.push(delivery) },
        health: () => ({ id: 'telegram', enabled: true, status: 'healthy' as const }),
      }),
    })
    const manager = new DeliveryManager({
      registry,
      config: { version: 1, adapters: { telegram: { enabled: true, settings: {} } } },
      updateAdapterSettings: vi.fn(),
    })
    await manager.start()
    const content = Buffer.from('note')
    await manager.deliverArtifact({
      requestId: 'art-2',
      connectorId: 'telegram',
      entryId: 'entry-2',
      docIndex: 1,
      attachment: {
        filename: 'note.txt',
        mediaType: 'application/octet-stream',
        sizeBytes: content.byteLength,
        contentSha256: createHash('sha256').update(content).digest('hex'),
        contentBase64: content.toString('base64'),
      },
    })
    expect(delivered).toEqual([])
    expect(artifacts).toHaveLength(1)
    await manager.stop()
  })
})
