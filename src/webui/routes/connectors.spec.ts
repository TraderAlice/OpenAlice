import { describe, expect, it, vi } from 'vitest'
import type {
  ConnectorAdapterMutation,
  PublicConnectorAdapterMutationResult,
  PublicConnectorConfig,
} from '@traderalice/connector-protocol'

import type { WorkspaceService } from '../../workspaces/service.js'
import type { ConnectorDesk } from '../../workspaces/issues/connector-desk.js'
import { createConnectorRoutes, isTelegramPrivateChatLinked } from './connectors.js'

function connectorConfig(linked: boolean): PublicConnectorConfig {
  return {
    serviceEnabled: true,
    adapters: {
      telegram: {
        enabled: true,
        settings: linked ? { ownerUserId: 'owner-1', chatId: 'chat-1' } : {},
        configuredSecrets: linked ? ['botToken'] : [],
      },
    },
  }
}

function desk(every = '4h'): ConnectorDesk {
  return {
    wsId: 'ws-1',
    connectorId: 'telegram',
    issue: {
      id: 'telegram-phone-desk',
      title: 'Chat on Telegram',
      status: 'todo',
      priority: 'none',
      assignee: '@new-then-resume',
      when: { kind: 'every', every },
      what: 'Read recent comments and reply when needed.',
      connectorDesk: 'telegram',
    },
  }
}

function build(options: {
  linked?: boolean
  fetchImpl?: typeof fetch
  restartConnectorService?: () => Promise<void>
  mutateAdapter?: (id: string, mutation: ConnectorAdapterMutation) => Promise<PublicConnectorAdapterMutationResult>
  mutateService?: (enabled: boolean) => Promise<{ serviceEnabled: boolean; serviceChanged: boolean }>
} = {}) {
  const createConnectorDesk = vi.fn(async () => desk())
  const updateConnectorDesk = vi.fn(async (_id: string, patch: Parameters<WorkspaceService['updateConnectorDesk']>[1]) => {
    const next = desk(patch.when?.every)
    if (patch.what) next.issue.what = patch.what
    return next
  })
  const service = {
    createConnectorDesk,
    updateConnectorDesk,
  } as unknown as WorkspaceService
  const app = createConnectorRoutes({
    getWorkspaceService: () => service,
    readConnectorConfig: async () => connectorConfig(options.linked ?? true),
    fetchImpl: options.fetchImpl,
    restartConnectorService: options.restartConnectorService,
    mutateAdapter: options.mutateAdapter,
    mutateService: options.mutateService,
  })
  return { app, createConnectorDesk, updateConnectorDesk }
}

describe('Telegram phone-desk connector routes', () => {
  it('reconciles only the mutated adapter when service is already running', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch
    const restartConnectorService = vi.fn(async () => undefined)
    const mutateAdapter = vi.fn(async (): Promise<PublicConnectorAdapterMutationResult> => ({
      serviceEnabled: true,
      serviceChanged: false,
      adapterChanged: true,
      adapter: { enabled: false, settings: {}, configuredSecrets: ['botToken'] },
    }))
    const { app } = build({ fetchImpl, restartConnectorService, mutateAdapter })

    const response = await app.request('/telegram', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })

    expect(response.status).toBe(200)
    expect(mutateAdapter).toHaveBeenCalledWith('telegram', {
      enabled: false,
      set: {},
      unset: [],
      setSecrets: {},
      removeSecrets: [],
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/v1/connectors/telegram/reconcile' }),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(restartConnectorService).not.toHaveBeenCalled()
  })

  it('asks Guardian to start Connector Service when the first adapter is enabled', async () => {
    const fetchImpl = vi.fn() as typeof fetch
    const restartConnectorService = vi.fn(async () => undefined)
    const mutateAdapter = vi.fn(async (): Promise<PublicConnectorAdapterMutationResult> => ({
      serviceEnabled: true,
      serviceChanged: true,
      adapterChanged: true,
      adapter: { enabled: true, settings: {}, configuredSecrets: ['botToken'] },
    }))
    const { app } = build({ fetchImpl, restartConnectorService, mutateAdapter })

    const response = await app.request('/telegram', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    })

    expect(response.status).toBe(202)
    expect(restartConnectorService).toHaveBeenCalledOnce()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('recognizes only a bot token plus a durable private-owner link', () => {
    expect(isTelegramPrivateChatLinked(connectorConfig(true))).toBe(true)
    expect(isTelegramPrivateChatLinked(connectorConfig(false))).toBe(false)

    const missingChat = connectorConfig(true)
    missingChat.adapters.telegram!.settings.chatId = ''
    expect(isTelegramPrivateChatLinked(missingChat)).toBe(false)

    const missingToken = connectorConfig(true)
    missingToken.adapters.telegram!.configuredSecrets = []
    expect(isTelegramPrivateChatLinked(missingToken)).toBe(false)
  })

  it('refuses direct enable requests until Telegram is linked', async () => {
    const { app, createConnectorDesk } = build({ linked: false })
    const response = await app.request('/telegram/desk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wsId: 'ws-1' }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: 'not_linked',
      message: 'Link this connector to its private owner chat before turning on chat',
    })
    expect(createConnectorDesk).not.toHaveBeenCalled()
  })

  it('enables a linked phone desk through the Workspace service', async () => {
    const { app, createConnectorDesk } = build()
    const response = await app.request('/telegram/desk', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wsId: 'ws-1' }),
    })

    expect(response.status).toBe(201)
    expect(createConnectorDesk).toHaveBeenCalledWith('telegram', 'ws-1')
  })

  it('rejects a cadence outside the Settings product contract', async () => {
    const { app, updateConnectorDesk } = build()
    const response = await app.request('/telegram/desk', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ when: { kind: 'every', every: '37m' } }),
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'invalid',
      message: 'when must use a supported heartbeat',
    })
    expect(updateConnectorDesk).not.toHaveBeenCalled()
  })

  it('updates a supported cadence through the Workspace service boundary', async () => {
    const { app, updateConnectorDesk } = build()
    const response = await app.request('/telegram/desk', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ when: { kind: 'every', every: '8h' } }),
    })

    expect(response.status).toBe(200)
    expect(updateConnectorDesk).toHaveBeenCalledWith('telegram', {
      when: { kind: 'every', every: '8h' },
    })
  })

  it('requests a single-adapter reconnect while Connector Service is reachable', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch
    const restartConnectorService = vi.fn(async () => undefined)
    const { app } = build({ fetchImpl, restartConnectorService })

    const response = await app.request('/telegram/reconnect', { method: 'POST' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, scope: 'adapter', adapterId: 'telegram' })
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/v1/connectors/telegram/reconnect' }),
      expect.objectContaining({ method: 'POST' }),
    )
    expect(restartConnectorService).not.toHaveBeenCalled()
  })

  it('asks Guardian to restart the service when Connector Service is unreachable', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as typeof fetch
    const restartConnectorService = vi.fn(async () => undefined)
    const { app } = build({ fetchImpl, restartConnectorService })

    const response = await app.request('/telegram/reconnect', { method: 'POST' })

    expect(response.status).toBe(202)
    expect(await response.json()).toEqual({ ok: true, scope: 'service', adapterId: 'telegram' })
    expect(restartConnectorService).toHaveBeenCalledOnce()
  })

  it('does not restart the service for an unknown adapter', async () => {
    const fetchImpl = vi.fn() as typeof fetch
    const restartConnectorService = vi.fn(async () => undefined)
    const { app } = build({ fetchImpl, restartConnectorService })

    const response = await app.request('/unknown/reconnect', { method: 'POST' })

    expect(response.status).toBe(404)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(restartConnectorService).not.toHaveBeenCalled()
  })
})
