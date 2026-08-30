import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let home: string
let savedHome: string | undefined

async function loadModule() {
  vi.resetModules()
  process.env['OPENALICE_HOME'] = home
  return import('./connector-config.js')
}

beforeEach(async () => {
  savedHome = process.env['OPENALICE_HOME']
  home = await mkdtemp(join(tmpdir(), 'oa-connector-config-'))
})

afterEach(async () => {
  if (savedHome === undefined) delete process.env['OPENALICE_HOME']
  else process.env['OPENALICE_HOME'] = savedHome
  vi.resetModules()
  await rm(home, { recursive: true, force: true })
})

describe('public connector config', () => {
  it('preserves concurrent mutations to different adapters', async () => {
    const config = await loadModule()

    await Promise.all([
      config.mutatePublicConnectorAdapter('telegram', {
        enabled: true,
        set: { inboxPush: false },
        unset: [],
        setSecrets: { botToken: '123456789:AAHreal-telegram-bot-token-value' },
        removeSecrets: [],
      }),
      config.mutatePublicConnectorAdapter('feishu', {
        enabled: true,
        set: { appId: 'cli_openalice', domain: 'feishu' },
        unset: [],
        setSecrets: { appSecret: 'feishu-app-secret-long-enough' },
        removeSecrets: [],
      }),
    ])

    const stored = await config.readConnectorConfig()
    expect(stored.adapters.telegram).toEqual({
      enabled: true,
      settings: {
        inboxPush: false,
        botToken: '123456789:AAHreal-telegram-bot-token-value',
      },
    })
    expect(stored.adapters.feishu).toEqual({
      enabled: true,
      settings: {
        appId: 'cli_openalice',
        domain: 'feishu',
        appSecret: 'feishu-app-secret-long-enough',
      },
    })
    expect(await config.readConnectorServiceEnabled()).toBe(true)
  })

  it('preserves bot-learned owner fields while the UI changes a preference', async () => {
    const config = await loadModule()
    await config.writeConnectorConfig({
      version: 1,
      adapters: {
        telegram: {
          enabled: true,
          settings: { botToken: '123456789:AAHreal-telegram-bot-token-value' },
        },
      },
    })

    await Promise.all([
      config.updateConnectorAdapterSettings('telegram', { ownerUserId: 'owner-42', chatId: 'chat-42' }),
      config.mutatePublicConnectorAdapter('telegram', {
        set: { inboxPush: false },
        unset: [],
        setSecrets: {},
        removeSecrets: [],
      }),
    ])

    expect((await config.readConnectorConfig()).adapters.telegram.settings).toEqual({
      botToken: '123456789:AAHreal-telegram-bot-token-value',
      ownerUserId: 'owner-42',
      chatId: 'chat-42',
      inboxPush: false,
    })
  })

  it('does not signal a process restart for an adapter-only mutation', async () => {
    const config = await loadModule()
    await config.writeConnectorServiceEnabled(true)

    const result = await config.mutatePublicConnectorAdapter('discord', {
      enabled: false,
      set: { inboxPush: false },
      unset: [],
      setSecrets: {},
      removeSecrets: [],
    })

    expect(result).toMatchObject({ serviceEnabled: true, serviceChanged: false, adapterChanged: true })
    await expect(stat(join(home, 'data/control/restart-connector.flag'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('clears learned owner fields on unlink without dropping the sealed token', async () => {
    const config = await loadModule()
    await config.writeConnectorConfig({
      version: 1,
      adapters: {
        telegram: {
          enabled: true,
          settings: {
            botToken: 'secret-token',
            ownerUserId: '42',
            chatId: '42',
          },
        },
      },
    })
    await config.writeConnectorServiceEnabled(true)

    const written = await config.mutatePublicConnectorAdapter('telegram', {
      set: {},
      unset: ['ownerUserId', 'chatId'],
      setSecrets: {},
      removeSecrets: [],
    })

    expect(written.adapter.settings.ownerUserId).toBeUndefined()
    expect(written.adapter.settings.chatId).toBeUndefined()
    expect(written.adapter.configuredSecrets).toEqual(['botToken'])

    const stored = await config.readConnectorConfig()
    expect(stored.adapters.telegram.settings).toEqual({ botToken: 'secret-token' })
  })

  it('rejects replacing a sealed token with a short draft', async () => {
    const config = await loadModule()
    await config.writeConnectorConfig({
      version: 1,
      adapters: {
        telegram: {
          enabled: true,
          settings: { botToken: '123456789:AAHreal-telegram-bot-token-value' },
        },
      },
    })
    await expect(config.mutatePublicConnectorAdapter('telegram', {
      set: {},
      unset: [],
      setSecrets: { botToken: 'qweqw' },
      removeSecrets: [],
    })).rejects.toThrow('too short or malformed')

    const stored = await config.readConnectorConfig()
    expect(stored.adapters.telegram.settings.botToken).toBe('123456789:AAHreal-telegram-bot-token-value')
  })

  it('accepts a plausible replacement token', async () => {
    const config = await loadModule()
    await config.writeConnectorConfig({
      version: 1,
      adapters: {
        telegram: {
          enabled: true,
          settings: { botToken: '123456789:AAHreal-telegram-bot-token-value' },
        },
      },
    })
    const next = '987654321:BBHanother-plausible-bot-token'

    await config.mutatePublicConnectorAdapter('telegram', {
      set: {},
      unset: [],
      setSecrets: { botToken: next },
      removeSecrets: [],
    })

    const stored = await config.readConnectorConfig()
    expect(stored.adapters.telegram.settings.botToken).toBe(next)
  })
})
