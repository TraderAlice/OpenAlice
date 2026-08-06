import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type {
  ConnectorAdapterConfig,
  ConnectorAdapterHealth,
  InboxNotification,
} from '@traderalice/connector-protocol'
import type { ConnectorAdapter, ConnectorAdapterContext } from './adapter.js'
import { ConnectorRegistry } from './adapter.js'
import { DeliveryManager } from './delivery-manager.js'
import { createConnectorIOEvent, type ConnectorIOEvent, type ConnectorIORecorder } from './io-events.js'

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
    await manager.stop()
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

  it('keeps a failed adapter registered so its degraded health remains visible', async () => {
    const adapter: ConnectorAdapter = {
      id: 'broken',
      start: async () => { throw new Error('Telegram API did not become ready') },
      stop: async () => undefined,
      deliver: async () => { throw new Error('Telegram is not ready') },
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
    })

    await manager.start()

    expect(manager.health()).toMatchObject({
      status: 'degraded',
      adapters: [{ id: 'broken', status: 'degraded' }],
    })
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
})
