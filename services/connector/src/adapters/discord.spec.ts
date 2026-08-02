import type { Dispatcher } from 'undici'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistry, type ConnectorAdapterContext } from '../core/adapter.js'
import type { ConnectorProxyTransport } from '../core/proxy.js'

const discordMocks = vi.hoisted(() => ({
  restConstruct: vi.fn(),
  restSetToken: vi.fn(),
  restPut: vi.fn(),
  clientConstruct: vi.fn(),
  clientOn: vi.fn(),
  clientOnce: vi.fn(),
  clientLogin: vi.fn(),
  clientDestroy: vi.fn(),
}))

vi.mock('discord.js', () => {
  class REST {
    constructor(options: unknown) {
      discordMocks.restConstruct(options)
    }
    setToken(token: string): this {
      discordMocks.restSetToken(token)
      return this
    }
    put(route: string, data: unknown): Promise<unknown> {
      return discordMocks.restPut(route, data)
    }
  }

  class Client {
    constructor(options: unknown) {
      discordMocks.clientConstruct(options)
    }
    on(event: string, listener: (...args: unknown[]) => unknown): this {
      discordMocks.clientOn(event, listener)
      return this
    }
    once(event: string, listener: () => void): this {
      discordMocks.clientOnce(event, listener)
      if (event === 'ready') queueMicrotask(listener)
      return this
    }
    login(token: string): Promise<string> {
      return discordMocks.clientLogin(token)
    }
    destroy(): void {
      discordMocks.clientDestroy()
    }
  }

  class SlashCommandBuilder {
    setName(): this { return this }
    setDescription(): this { return this }
    toJSON(): Record<string, never> { return {} }
  }

  return {
    ApplicationIntegrationType: { UserInstall: 1 },
    Client,
    Events: { InteractionCreate: 'interaction', Error: 'error', ClientReady: 'ready' },
    GatewayIntentBits: { Guilds: 1, DirectMessages: 2 },
    InteractionContextType: { BotDM: 1 },
    Partials: { Channel: 1 },
    REST,
    Routes: { applicationCommands: (id: string) => `/applications/${id}/commands` },
    SlashCommandBuilder,
  }
})

import { DiscordConnectorAdapter } from './discord.js'

describe('DiscordConnectorAdapter proxy startup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    discordMocks.restPut.mockResolvedValue([])
    discordMocks.clientLogin.mockResolvedValue('test-token')
  })

  it('passes the shared Undici dispatcher into command and client REST paths', async () => {
    const dispatcher = {} as Dispatcher
    const proxy: ConnectorProxyTransport = {
      active: true,
      dispatcher,
      close: async () => undefined,
    }
    const adapter = new DiscordConnectorAdapter(proxy)

    await adapter.start({
      enabled: true,
      settings: { applicationId: 'app-1', botToken: 'test-token' },
    }, context())

    expect(discordMocks.restConstruct).toHaveBeenCalledWith({ version: '10', agent: dispatcher })
    expect(discordMocks.clientConstruct).toHaveBeenCalledWith(expect.objectContaining({
      rest: { agent: dispatcher },
    }))
    expect(discordMocks.restPut).toHaveBeenCalledWith(
      '/applications/app-1/commands',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })
})

function context(): ConnectorAdapterContext {
  return {
    commands: new CommandRegistry('discord'),
    updateSettings: vi.fn(),
    getServiceStatus: () => 'healthy',
    sendTest: vi.fn(),
  }
}
