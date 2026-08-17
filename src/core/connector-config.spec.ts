import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
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

    const publicConfig = await config.readPublicConnectorConfig()
    const written = await config.writePublicConnectorConfig({
      ...publicConfig,
      adapters: {
        ...publicConfig.adapters,
        telegram: {
          ...publicConfig.adapters.telegram,
          settings: {
            ...publicConfig.adapters.telegram.settings,
            ownerUserId: '',
            chatId: '',
          },
        },
      },
    })

    expect(written.adapters.telegram.settings.ownerUserId).toBeUndefined()
    expect(written.adapters.telegram.settings.chatId).toBeUndefined()
    expect(written.adapters.telegram.configuredSecrets).toEqual(['botToken'])

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
    const publicConfig = await config.readPublicConnectorConfig()

    await expect(config.writePublicConnectorConfig({
      ...publicConfig,
      adapters: {
        ...publicConfig.adapters,
        telegram: {
          ...publicConfig.adapters.telegram,
          settings: { botToken: 'qweqw' },
          configuredSecrets: ['botToken'],
        },
      },
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
    const publicConfig = await config.readPublicConnectorConfig()
    const next = '987654321:BBHanother-plausible-bot-token'

    await config.writePublicConnectorConfig({
      ...publicConfig,
      adapters: {
        ...publicConfig.adapters,
        telegram: {
          ...publicConfig.adapters.telegram,
          settings: { botToken: next },
          configuredSecrets: ['botToken'],
        },
      },
    })

    const stored = await config.readConnectorConfig()
    expect(stored.adapters.telegram.settings.botToken).toBe(next)
  })
})
