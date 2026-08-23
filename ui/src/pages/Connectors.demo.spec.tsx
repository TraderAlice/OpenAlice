// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicConnectorConfig } from '../api'
import { createDemoConnectorSnapshot } from '../demo/fixtures/connectors'
import { i18n } from '../i18n'
import { ConnectorStatusPage } from './ConnectorStatusPage'
import { ConnectorsPage } from './ConnectorsPage'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn(),
  test: vi.fn(),
  reconnect: vi.fn(),
  deskLoad: vi.fn(),
  openOrFocus: vi.fn(),
}))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      connectors: {
        load: mocks.load,
        save: mocks.save,
        test: mocks.test,
        reconnect: mocks.reconnect,
        desk: {
          load: mocks.deskLoad,
          create: vi.fn(),
          update: vi.fn(),
          disable: vi.fn(),
        },
      },
    },
  }
})

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) =>
    selector({ openOrFocus: mocks.openOrFocus }),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    workspaces: [{ id: 'ws-1', tag: 'desk', displayName: 'Desk' }],
  }),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  mocks.load.mockImplementation(async () => createDemoConnectorSnapshot())
  mocks.save.mockImplementation(async (config) => ({ config: redactSecrets(config) }))
  mocks.test.mockResolvedValue({ ok: true, probeId: 'connector-probe-demo' })
  mocks.reconnect.mockResolvedValue({ ok: true, scope: 'adapter', adapterId: 'telegram' })
  mocks.deskLoad.mockResolvedValue({ desk: null })
})

afterEach(() => cleanup())

describe('Connector demo routes', () => {
  it('renders the read-only operations route from the demo snapshot', async () => {
    render(<ConnectorStatusPage />)

    expect(await screen.findByText('Connector Service')).toBeTruthy()
    expect(screen.getByText('Discord')).toBeTruthy()
    expect(screen.getByText('Telegram')).toBeTruthy()
    expect(screen.getByText(/External delivery is disabled/)).toBeTruthy()
  })

  it('reconnects an unhealthy configured adapter from the operations route', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.serviceEnabled = true
    snapshot.config.adapters.telegram = {
      enabled: true,
      settings: {},
      configuredSecrets: ['botToken'],
    }
    snapshot.health = {
      enabled: true,
      status: 'degraded',
      service: {
        status: 'degraded',
        startedAt: '2026-08-23T00:00:00.000Z',
        adapters: [{ id: 'telegram', enabled: true, status: 'degraded', lastError: 'offline' }],
      },
    }
    mocks.load.mockResolvedValue(snapshot)

    render(<ConnectorStatusPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }))

    await waitFor(() => expect(mocks.reconnect).toHaveBeenCalledWith('telegram'))
  })

  it('localizes the read-only operations route', async () => {
    await i18n.changeLanguage('zh')
    render(<ConnectorStatusPage />)

    expect(await screen.findByRole('heading', { name: '连接器' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '配置' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '连接器服务' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '投递连接器' })).toBeTruthy()
    expect(screen.getByText('将收件箱通知投递到你的私有 Discord 会话。')).toBeTruthy()
    expect(screen.getAllByText('需要设置')).toHaveLength(4)
    expect(screen.queryByText('Delivery connectors')).toBeNull()
  })

  it('renders the Connector configuration route from the demo snapshot', async () => {
    render(<ConnectorsPage />)

    expect(await screen.findByText('Run external notification connectors')).toBeTruthy()
    expect(screen.getByText('Discord')).toBeTruthy()
    expect(screen.getByText('Telegram')).toBeTruthy()
    expect(screen.getByText('Slack')).toBeTruthy()
    expect(screen.getByText('Feishu')).toBeTruthy()
    expect(screen.getByText('Application ID')).toBeTruthy()
    expect(screen.getAllByText('Bot token')).toHaveLength(3)
    expect(screen.queryByRole('button', { name: 'Send test' })).toBeNull()
  })

  it('localizes Connector setup state and credential controls', async () => {
    await i18n.changeLanguage('zh')
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.adapters.telegram.configuredSecrets = ['botToken']
    mocks.load.mockResolvedValue(snapshot)
    render(<ConnectorsPage />)

    expect(await screen.findByRole('heading', { name: '连接器' })).toBeTruthy()
    expect(screen.getByText('运行外部通知连接器')).toBeTruthy()
    expect(screen.getAllByText('需要凭据')).toHaveLength(3)
    expect(screen.getByRole('textbox', { name: 'Discord 应用 ID' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '管理 Telegram 连接信息' })).toBeTruthy()
    expect(screen.queryByText('Connection details')).toBeNull()
  })

  it('collapses saved connection details and promotes testing into the lifecycle row', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.serviceEnabled = true
    snapshot.config.adapters.discord = {
      enabled: true,
      settings: { applicationId: 'discord-app', ownerUserId: 'owner-1' },
      configuredSecrets: ['botToken'],
    }
    snapshot.health = {
      enabled: true,
      status: 'healthy',
      service: {
        status: 'healthy',
        startedAt: '2026-07-31T00:00:00.000Z',
        adapters: [{
          id: 'discord',
          enabled: true,
          status: 'healthy',
          owner: 'owner-1',
        }],
      },
    }
    mocks.load.mockResolvedValue(snapshot)

    render(<ConnectorsPage />)

    const manage = await screen.findByRole('button', { name: 'Manage Discord connection details' })
    expect(manage.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('textbox', { name: 'Discord Application ID' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Send test' })).toBeTruthy()

    fireEvent.click(manage)
    expect(screen.getByRole('button', { name: 'Hide Discord connection details' }).getAttribute('aria-expanded'))
      .toBe('true')
    expect(screen.getByRole('textbox', { name: 'Discord Application ID' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Send test' }))
    await waitFor(() => expect(mocks.test).toHaveBeenCalledWith('discord'))
    expect(await screen.findByText('connector-probe-demo')).toBeTruthy()
  })

  it('confirms before unlinking a learned owner and keeps the token', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.serviceEnabled = true
    snapshot.config.adapters.discord = {
      enabled: true,
      settings: { applicationId: 'discord-app', ownerUserId: 'owner-1' },
      configuredSecrets: ['botToken'],
    }
    snapshot.health = {
      enabled: true,
      status: 'healthy',
      service: {
        status: 'healthy',
        startedAt: '2026-07-31T00:00:00.000Z',
        adapters: [{
          id: 'discord',
          enabled: true,
          status: 'healthy',
          owner: 'owner-1',
        }],
      },
    }
    mocks.load.mockResolvedValue(snapshot)
    render(<ConnectorsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Unlink' }))
    expect(screen.getByRole('heading', { name: 'Unlink Discord?' })).toBeTruthy()
    await new Promise((resolve) => window.setTimeout(resolve, 800))
    expect(mocks.save).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Unlink Discord?' })).toBeNull()
    await new Promise((resolve) => window.setTimeout(resolve, 800))
    expect(mocks.save).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Unlink' }).at(-1)!)

    await waitFor(() => expect(mocks.save).toHaveBeenCalled(), { timeout: 1_200 })
    const saved = mocks.save.mock.calls.at(-1)?.[0] as PublicConnectorConfig
    expect(saved.adapters.discord.settings.ownerUserId).toBe('')
    expect(saved.adapters.discord.settings.applicationId).toBe('discord-app')
    expect(saved.adapters.discord.configuredSecrets).toEqual(['botToken'])
  })

  it('keeps a secret as a local draft until the user saves a plausible token', async () => {
    render(<ConnectorsPage />)

    await screen.findByText('Run external notification connectors')
    const input = screen.getAllByPlaceholderText('Stored locally and sealed')[0] as HTMLInputElement

    fireEvent.change(input, { target: { value: 'a' } })
    expect(input.value).toBe('a')
    await new Promise((resolve) => window.setTimeout(resolve, 800))
    expect(mocks.save).not.toHaveBeenCalled()
    expect(input.value).toBe('a')

    fireEvent.change(input, { target: { value: 'qweqw' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save token' })[0])
    expect((await screen.findByRole('alert')).textContent).toContain('too short to be a bot token')
    expect(mocks.save).not.toHaveBeenCalled()

    expect(input.type).toBe('password')
    fireEvent.click(screen.getAllByRole('button', { name: 'Show draft' })[0])
    expect(input.type).toBe('text')
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide draft' })[0])
    expect(input.type).toBe('password')

    fireEvent.change(input, { target: { value: '123456789:AAHplausible-bot-token' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save token' })[0])

    await waitFor(() => expect(mocks.save).toHaveBeenCalled())
    const saved = mocks.save.mock.calls.at(-1)?.[0] as PublicConnectorConfig
    expect(saved.adapters.discord.settings.botToken).toBe('123456789:AAHplausible-bot-token')
    await waitFor(() => expect(input.value).toBe(''))
    expect(input.placeholder).toBe('Configured — enter a new value to replace')
    expect((screen.getAllByRole('button', { name: 'Replace token' })[0] as HTMLButtonElement).disabled).toBe(true)
  })

  it('retains a secret draft when saving fails', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Connector settings unavailable'))
    render(<ConnectorsPage />)

    await screen.findByText('Run external notification connectors')
    const input = screen.getAllByPlaceholderText('Stored locally and sealed')[0] as HTMLInputElement
    fireEvent.change(input, { target: { value: '123456789:AAHstill-here-bot-token' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save token' })[0])

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Token was not saved: Connector settings unavailable',
    )
    expect(input.value).toBe('123456789:AAHstill-here-bot-token')
  })

  it('confirms before replacing a configured secret and omits secrets from unlink auto-save', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.serviceEnabled = true
    snapshot.config.adapters.discord = {
      enabled: true,
      settings: { applicationId: 'discord-app', ownerUserId: 'owner-1' },
      configuredSecrets: ['botToken'],
    }
    snapshot.health = {
      enabled: true,
      status: 'healthy',
      service: {
        status: 'healthy',
        startedAt: '2026-07-31T00:00:00.000Z',
        adapters: [{
          id: 'discord',
          enabled: true,
          status: 'healthy',
          owner: 'owner-1',
        }],
      },
    }
    mocks.load.mockResolvedValue(snapshot)
    render(<ConnectorsPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Manage Discord connection details' }))
    const input = screen.getByLabelText('Discord Bot token') as HTMLInputElement
    fireEvent.change(input, { target: { value: '123456789:AAHreplacement-bot-token' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replace token' }))
    expect(screen.getByRole('heading', { name: 'Replace Discord token?' })).toBeTruthy()
    expect(mocks.save).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: 'Replace token' }).at(-1)!)
    await waitFor(() => expect(mocks.save).toHaveBeenCalled())
    expect(mocks.save.mock.calls.at(-1)?.[0].adapters.discord.settings.botToken)
      .toBe('123456789:AAHreplacement-bot-token')
  })

  it('rejects a short replacement draft before asking for confirmation', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.adapters.discord.configuredSecrets = ['botToken']
    mocks.load.mockResolvedValue(snapshot)
    render(<ConnectorsPage />)

    await screen.findByText('Run external notification connectors')
    const input = screen.getByLabelText('Discord Bot token') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'qweqw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replace token' }))

    expect((await screen.findByRole('alert')).textContent).toContain('too short to be a bot token')
    expect(screen.queryByRole('heading', { name: 'Replace Discord token?' })).toBeNull()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('requires confirmation before removing a configured secret', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.adapters.discord.configuredSecrets = ['botToken']
    mocks.load.mockResolvedValue(snapshot)
    render(<ConnectorsPage />)

    await screen.findByText('Run external notification connectors')
    fireEvent.click(screen.getByRole('button', { name: 'Remove token' }))

    expect(screen.getByRole('heading', { name: 'Remove Discord token?' })).toBeTruthy()
    expect(screen.getByText(/OpenAlice cannot recover this token after removal/)).toBeTruthy()
    await new Promise((resolve) => window.setTimeout(resolve, 800))
    expect(mocks.save).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Remove Discord token?' })).toBeNull()
    await new Promise((resolve) => window.setTimeout(resolve, 800))
    expect(mocks.save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Remove token' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove token' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove token' }).at(-1)!)

    await waitFor(() => expect(mocks.save).toHaveBeenCalled(), { timeout: 1_200 })
    const saved = mocks.save.mock.calls.at(-1)?.[0] as PublicConnectorConfig
    expect(saved.adapters.discord.configuredSecrets).toEqual([])
    expect(saved.adapters.discord.settings.botToken).toBe('')
  })
})

function redactSecrets(config: PublicConnectorConfig): PublicConnectorConfig {
  return {
    ...config,
    adapters: Object.fromEntries(Object.entries(config.adapters).map(([id, adapter]) => {
      const secretKeys = id === 'slack' ? ['botToken', 'appToken'] : id === 'discord' || id === 'telegram' ? ['botToken'] : []
      const configuredSecrets = new Set(adapter.configuredSecrets)
      const settings = { ...adapter.settings }
      for (const key of secretKeys) {
        const value = settings[key]
        if (typeof value === 'string' && value.length > 0) configuredSecrets.add(key)
        delete settings[key]
      }
      return [id, { ...adapter, settings, configuredSecrets: [...configuredSecrets] }]
    })),
  }
}
