import { describe, expect, it, vi } from 'vitest'
import type { PublicConnectorConfig } from '@traderalice/connector-protocol'

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
      title: 'Telegram phone desk',
      status: 'todo',
      priority: 'none',
      assignee: '@new-then-resume',
      when: { kind: 'every', every },
      what: 'Read recent comments and reply when needed.',
      connectorDesk: 'telegram',
    },
  }
}

function build(options: { linked?: boolean } = {}) {
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
  })
  return { app, createConnectorDesk, updateConnectorDesk }
}

describe('Telegram phone-desk connector routes', () => {
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
    expect(await response.json()).toMatchObject({ error: 'not_linked' })
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
})
