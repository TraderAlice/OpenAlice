// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoConnectorSnapshot } from '../demo/fixtures/connectors'
import { i18n } from '../i18n'
import { ConnectorStatusPage } from './ConnectorStatusPage'
import { ConnectorsPage } from './ConnectorsPage'

const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  mutateAdapter: vi.fn(),
  setService: vi.fn(),
  test: vi.fn(),
  reconnect: vi.fn(),
  deskLoad: vi.fn(),
  openOrFocus: vi.fn(),
  liveRuntime: {
    current: { health: null, error: null } as {
      health: ReturnType<typeof createDemoConnectorSnapshot>['health'] | null
      error: string | null
    },
  },
}))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      connectors: {
        load: mocks.load,
        mutateAdapter: mocks.mutateAdapter,
        setService: mocks.setService,
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

vi.mock('../live/connector-health', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../live/connector-health')>()
  return {
    ...actual,
    useConnectorRuntimeHealthState: () => mocks.liveRuntime.current,
  }
})

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  const connectorSnapshot = createDemoConnectorSnapshot()
  mocks.load.mockImplementation(async () => connectorSnapshot)
  mocks.mutateAdapter.mockImplementation(async (id, mutation) => {
    const current = connectorSnapshot.config.adapters[id] ?? { enabled: false, settings: {}, configuredSecrets: [] }
    const settings = { ...current.settings, ...(mutation.set ?? {}) }
    for (const key of mutation.unset ?? []) delete settings[key]
    const configuredSecrets = new Set(current.configuredSecrets)
    for (const key of Object.keys(mutation.setSecrets ?? {})) configuredSecrets.add(key)
    for (const key of mutation.removeSecrets ?? []) configuredSecrets.delete(key)
    const adapter = {
      enabled: mutation.enabled ?? current.enabled,
      settings,
      configuredSecrets: [...configuredSecrets],
    }
    const serviceChanged = adapter.enabled && !connectorSnapshot.config.serviceEnabled
    connectorSnapshot.config = {
      serviceEnabled: serviceChanged ? true : connectorSnapshot.config.serviceEnabled,
      adapters: { ...connectorSnapshot.config.adapters, [id]: adapter },
    }
    return {
      serviceEnabled: connectorSnapshot.config.serviceEnabled,
      serviceChanged,
      adapterChanged: true,
      adapter,
      runtime: { scope: serviceChanged ? 'service' : 'adapter', status: serviceChanged ? 'starting' : 'reconciled' },
    }
  })
  mocks.setService.mockImplementation(async (enabled) => {
    const serviceChanged = connectorSnapshot.config.serviceEnabled !== enabled
    connectorSnapshot.config = { ...connectorSnapshot.config, serviceEnabled: enabled }
    return { serviceEnabled: enabled, serviceChanged }
  })
  mocks.test.mockResolvedValue({ ok: true, probeId: 'connector-probe-demo' })
  mocks.reconnect.mockResolvedValue({ ok: true, scope: 'adapter', adapterId: 'telegram' })
  mocks.deskLoad.mockResolvedValue({ desk: null })
  mocks.liveRuntime.current = { health: null, error: null }
})

afterEach(() => cleanup())

describe('Connector demo routes', () => {
  it('renders the read-only operations route from the demo snapshot', async () => {
    render(<ConnectorStatusPage />)

    expect(await screen.findByRole('heading', { name: 'Choose a channel' })).toBeTruthy()
    expect(screen.getByText('Discord')).toBeTruthy()
    expect(screen.getByText('Telegram')).toBeTruthy()
    expect(screen.queryByText('Delivery service')).toBeNull()
    expect(screen.getAllByText('Inbox delivery')).toHaveLength(4)
    expect(screen.getAllByText('Workspace chat')).toHaveLength(2)
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
    const diagnostics = (await screen.findByText('Technical details')).closest('details') as HTMLDetailsElement
    expect(diagnostics.open).toBe(false)
    const diagnosticSummary = within(diagnostics).getByText('Technical details').closest('summary') as HTMLElement
    expect(diagnosticSummary.className).toContain('min-h-10')
    fireEvent.click(diagnosticSummary)
    expect(diagnostics.open).toBe(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Reconnect' }))

    await waitFor(() => expect(mocks.reconnect).toHaveBeenCalledWith('telegram'))
  })

  it('reconnects an unhealthy adapter without leaving its configuration surface', async () => {
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

    render(<ConnectorsPage />)
    const reconnect = await screen.findByRole('button', { name: 'Reconnect' })
    const lifecycle = reconnect.closest('section') as HTMLElement
    expect(within(lifecycle).getByText(
      'Telegram could not connect. Reconnect now; if it keeps failing, review the connection details below.',
    )).toBeTruthy()
    const diagnostics = within(lifecycle).getByText('Technical details').closest('details') as HTMLDetailsElement
    expect(diagnostics.open).toBe(false)
    expect(within(diagnostics).getByText('offline')).toBeTruthy()
    expect(within(diagnostics).getByText('Technical details').closest('summary')?.className).toContain('min-h-10')
    expect(reconnect.className).toContain('min-h-10')
    fireEvent.click(reconnect)

    await waitFor(() => expect(mocks.reconnect).toHaveBeenCalledWith('telegram'))
  })

  it('keeps a known stopped-adapter condition in product language only', async () => {
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
        adapters: [{
          id: 'telegram',
          enabled: true,
          status: 'stopped',
          detail: 'Adapter is configured but not running.',
        }],
      },
    }
    mocks.load.mockResolvedValue(snapshot)

    render(<ConnectorsPage />)

    const lifecycle = (await screen.findByText(
      'The Telegram bot is configured but is not running.',
    )).closest('section') as HTMLElement
    expect(within(lifecycle).queryByText('Technical details')).toBeNull()
    expect(within(lifecycle).queryByText('Adapter is configured but not running.')).toBeNull()
  })

  it('localizes the read-only operations route', async () => {
    await i18n.changeLanguage('zh')
    render(<ConnectorStatusPage />)

    expect(await screen.findByRole('heading', { name: '连接器' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '刷新' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '配置' })).toBeNull()
    expect(screen.getByRole('button', { name: '设置 Feishu' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '投递服务' })).toBeNull()
    expect(screen.getByRole('heading', { name: '选择聊天渠道' })).toBeTruthy()
    expect(screen.queryByText('将收件箱通知投递到你的私有 Discord 会话。')).toBeNull()
    expect(screen.queryByText('需要设置')).toBeNull()
    expect(screen.getAllByText('收件箱投递')).toHaveLength(4)
    expect(screen.getAllByText('工作区聊天')).toHaveLength(2)
    expect(screen.queryByText('Delivery connectors')).toBeNull()
    expect(i18n.t('connectorStatus.adapter.offDescription')).toBe('投递已暂停；开启此渠道即可恢复。')
    expect(i18n.t('connectorStatus.adapter.connectedDescription')).toBe('收件箱动态正在通过此渠道投递。')
    expect(i18n.t('connectorStatus.adapter.startingLinkedDescription', { name: 'Telegram' }))
      .toBe('Telegram 正在重新连接；准备就绪后会恢复投递。')

    fireEvent.click(screen.getByRole('button', { name: '设置 Feishu' }))
    expect(within(await screen.findByRole('dialog')).getByRole('button', { name: '关闭' })).toBeTruthy()
  })

  it('summarizes a linked connector without exposing its raw owner identifier', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.serviceEnabled = true
    snapshot.config.adapters.feishu = {
      enabled: true,
      settings: { appId: 'feishu-app' },
      configuredSecrets: ['appSecret'],
    }
    snapshot.health = {
      enabled: true,
      status: 'healthy',
      service: {
        status: 'healthy',
        startedAt: '2026-08-23T00:00:00.000Z',
        adapters: [{
          id: 'feishu',
          enabled: true,
          status: 'healthy',
          owner: 'ou_private_identifier',
          lastSuccessAt: new Date().toISOString(),
        }],
      },
    }
    mocks.load.mockResolvedValue(snapshot)

    render(<ConnectorStatusPage />)

    expect(await screen.findByText('Private chat linked')).toBeTruthy()
    expect(screen.getByText('Inbox updates are being delivered through this channel.')).toBeTruthy()
    expect(screen.getByText('Delivered just now')).toBeTruthy()
    expect(screen.queryByText('ou_private_identifier')).toBeNull()
  })

  it('keeps durable linking visible while a connector is paused', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.serviceEnabled = true
    snapshot.config.adapters.discord = {
      enabled: false,
      settings: { applicationId: 'discord-app', ownerUserId: 'owner-1' },
      configuredSecrets: ['botToken'],
    }
    snapshot.health = {
      enabled: true,
      status: 'healthy',
      service: {
        status: 'healthy',
        startedAt: '2026-08-23T00:00:00.000Z',
        adapters: [{ id: 'discord', enabled: false, status: 'disabled' }],
      },
    }
    mocks.load.mockResolvedValue(snapshot)

    render(<ConnectorStatusPage />)

    await screen.findByRole('button', { name: 'Manage Discord' })
    const card = (await screen.findByRole('heading', { name: 'Discord' })).closest('article') as HTMLElement
    expect(within(card).getByText('Paused')).toBeTruthy()
    expect(within(card).getByText('Private chat linked')).toBeTruthy()
    expect(within(card).getByText('Delivery is paused. Turn this channel on to resume.')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Manage Discord' })).toBeTruthy()
  })

  it('distinguishes saved credentials from a completed private-chat link', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.adapters.discord = {
      enabled: false,
      settings: { applicationId: 'discord-app' },
      configuredSecrets: ['botToken'],
    }
    mocks.load.mockResolvedValue(snapshot)

    render(<ConnectorStatusPage />)

    await screen.findByRole('button', { name: 'Discord setup details' })
    const card = (await screen.findByRole('heading', { name: 'Discord' })).closest('article') as HTMLElement
    expect(within(card).getByText('Ready to link')).toBeTruthy()
    expect(within(card).getByText('Private chat not linked')).toBeTruthy()
    expect(within(card).getByText('Start Discord')).toBeTruthy()
    const details = within(card).getByRole('button', { name: 'Discord setup details' })
    expect(details.className).toContain('bg-background/50')
    expect(details.className).not.toContain('bg-primary text-primary-foreground')
  })

  it('shows linked startup progress without offering a premature reconnect', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.serviceEnabled = true
    snapshot.config.adapters.telegram = {
      enabled: true,
      settings: { ownerUserId: 'owner-1', chatId: 'chat-1' },
      configuredSecrets: ['botToken'],
    }
    snapshot.health = {
      enabled: true,
      status: 'healthy',
      service: {
        status: 'healthy',
        startedAt: '2026-08-23T00:00:00.000Z',
        adapters: [{ id: 'telegram', enabled: true, status: 'starting' }],
      },
    }
    mocks.load.mockResolvedValue(snapshot)

    render(<ConnectorStatusPage />)

    await screen.findByRole('button', { name: 'View Telegram progress' })
    const card = (await screen.findByRole('heading', { name: 'Telegram' })).closest('article') as HTMLElement
    expect(within(card).getByText('Private chat linked')).toBeTruthy()
    expect(within(card).getByText('Telegram is reconnecting. Delivery will resume when ready.')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'View Telegram progress' })).toBeTruthy()
    expect(within(card).queryByRole('button', { name: 'Reconnect' })).toBeNull()
  })

  it('offers recovery when an enabled linked connector has no reachable runtime', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.serviceEnabled = true
    snapshot.config.adapters.telegram = {
      enabled: true,
      settings: { ownerUserId: 'owner-1', chatId: 'chat-1' },
      configuredSecrets: ['botToken'],
    }
    snapshot.health = {
      enabled: true,
      status: 'degraded',
      lastError: 'Connector Service is unreachable',
    }
    mocks.load.mockResolvedValue(snapshot)

    render(<ConnectorStatusPage />)

    const card = (await screen.findByRole('heading', { name: 'Telegram' })).closest('article') as HTMLElement
    expect(within(card).getByText('Needs attention')).toBeTruthy()
    expect(within(card).getByText('Private chat linked')).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Reconnect' })).toBeTruthy()
    expect(within(card).getByRole('button', { name: 'Review Telegram' })).toBeTruthy()
  })

  it('opens one connector configuration on its title and restores focus on close', async () => {
    render(<ConnectorStatusPage />)

    const trigger = await screen.findByRole('button', { name: 'Set up Feishu' })
    const before = window.location.pathname
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog')
    const close = within(dialog).getByRole('button', { name: 'Close' })
    expect(close.className).toContain('size-10')
    expect(close.className).toContain('sm:size-8')
    expect(dialog.className).toContain('h-[calc(100dvh-1rem)]')
    expect(dialog.className).toContain('sm:h-auto')
    expect(dialog.className).toContain('sm:max-h-[min(46rem,calc(100dvh-2rem))]')
    const title = within(dialog).getByRole('heading', { name: 'Configure Feishu' })
    expect(title.getAttribute('tabindex')).toBe('-1')
    await waitFor(() => expect(document.activeElement).toBe(title))
    expect(within(dialog).getByText('Connection, delivery, and chat settings for Feishu.')).toBeTruthy()
    expect(within(dialog).queryByText('Credentials required')).toBeNull()
    expect(within(dialog).queryByRole('switch', { name: 'Turn Feishu on or off' })).toBeNull()
    const connection = within(dialog).getByRole('button', { name: 'Hide Feishu connection details' })
    const delivery = within(dialog).getByRole('switch', { name: 'Push Inbox notifications' })
    expect(connection.getAttribute('aria-expanded')).toBe('true')
    expect(connection.compareDocumentPosition(delivery) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(within(dialog).getByText('Available after linking')).toBeTruthy()
    expect(within(dialog).getByText('Prepare Feishu first')).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Open Feishu developer console in a new tab' })).toBeTruthy()
    expect(within(dialog).getByRole('link', { name: 'Open Lark developer console in a new tab' })).toBeTruthy()
    expect(within(dialog).queryByRole('switch', { name: 'Turn Chat on Feishu on or off' })).toBeNull()
    expect(within(dialog).queryByText('Discord')).toBeNull()
    expect(window.location.pathname).toBe(before)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })

  it('describes configuration according to the connector capabilities', async () => {
    render(<ConnectorStatusPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Set up Slack' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Connection and delivery settings for Slack.')).toBeTruthy()
    expect(within(dialog).queryByText('Connection, delivery, and chat settings for Slack.')).toBeNull()
  })

  it('uses visible platform choices instead of free text for Feishu and Lark', async () => {
    render(<ConnectorStatusPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Set up Feishu' }))
    const dialog = await screen.findByRole('dialog')
    const feishu = within(dialog).getByRole('radio', { name: 'Feishu' }) as HTMLInputElement
    const lark = within(dialog).getByRole('radio', { name: 'Lark' }) as HTMLInputElement
    const group = feishu.closest('fieldset')?.querySelector('[class*="grid-cols-1"]')

    expect(feishu.checked).toBe(true)
    expect(lark.checked).toBe(false)
    expect(group?.className).toContain('sm:grid-cols-2')
    expect(within(dialog).queryByRole('textbox', { name: 'Feishu Open platform' })).toBeNull()

    fireEvent.click(lark)
    expect(feishu.checked).toBe(false)
    expect(lark.checked).toBe(true)

    await waitFor(() => expect(mocks.mutateAdapter).toHaveBeenCalled(), { timeout: 1_200 })
    expect(mocks.mutateAdapter.mock.calls.at(-1)).toEqual(['feishu', { set: { domain: 'lark' } }])
  })

  it('saves all missing Slack credentials as one connection', async () => {
    render(<ConnectorStatusPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Set up Slack' }))
    const dialog = await screen.findByRole('dialog')
    const saveConnection = await within(dialog).findByRole('button', { name: 'Save connection' }) as HTMLButtonElement
    const botToken = within(dialog).getByLabelText('Slack Bot token') as HTMLInputElement
    const appToken = within(dialog).getByLabelText('Slack App-level token') as HTMLInputElement
    const draftToggles = within(dialog).getAllByRole('button', { name: 'Show draft' })
    const setupLinks = within(dialog).getAllByRole('link')
    const botTokenLabel = within(dialog).getByText('Bot token', { exact: true }).closest('label') as HTMLLabelElement
    const appTokenLabel = within(dialog).getByText('App-level token', { exact: true }).closest('label') as HTMLLabelElement
    const firstSetupStep = within(dialog).getByText(
      'Create an app from scratch in the Slack workspace you want to use.',
    )

    expect(within(botTokenLabel).getByText('Required')).toBeTruthy()
    expect(within(appTokenLabel).getByText('Required')).toBeTruthy()
    expect(botToken.required).toBe(true)
    expect(appToken.required).toBe(true)
    const initialHint = within(dialog).getByText('Still needed: Bot token · App-level token.')
    expect(saveConnection.getAttribute('aria-describedby')).toBe(initialHint.id)
    expect(botToken.className).toContain('min-h-10')
    expect(appToken.className).toContain('min-h-10')
    draftToggles.forEach((button) => expect(button.className).toContain('min-w-10'))
    setupLinks.forEach((link) => expect(link.className).toContain('min-h-10'))
    expect(setupLinks[0].closest('[data-connector-setup-links]')).toBeTruthy()
    expect(setupLinks[0].compareDocumentPosition(firstSetupStep) & 4).toBe(4)
    expect(saveConnection.className).toContain('min-h-10')
    expect(saveConnection.disabled).toBe(true)
    expect(within(dialog).queryByRole('button', { name: 'Save token' })).toBeNull()
    fireEvent.change(botToken, { target: { value: 'xoxb-plausible-slack-bot-token' } })
    expect(within(botTokenLabel).queryByText('Required')).toBeNull()
    expect(botToken.required).toBe(false)
    expect(within(dialog).getByText('Still needed: App-level token.')).toBeTruthy()
    expect(saveConnection.disabled).toBe(true)
    fireEvent.change(appToken, { target: { value: 'xapp-plausible-slack-app-token' } })
    expect(within(appTokenLabel).queryByText('Required')).toBeNull()
    expect(within(dialog).getByText('Credential drafts above are saved together.')).toBeTruthy()
    expect(saveConnection.disabled).toBe(false)
    fireEvent.click(saveConnection)

    await waitFor(() => expect(mocks.mutateAdapter).toHaveBeenCalledTimes(1))
    expect(mocks.mutateAdapter).toHaveBeenCalledWith('slack', {
      setSecrets: {
        botToken: 'xoxb-plausible-slack-bot-token',
        appToken: 'xapp-plausible-slack-app-token',
      },
    })
    await waitFor(() => expect(within(dialog).queryByRole('button', { name: 'Save connection' })).toBeNull())
    const runtimeToggle = within(dialog).getByRole('switch', { name: 'Turn Slack on or off' })
    await waitFor(() => expect(document.activeElement).toBe(runtimeToggle))
    expect(runtimeToggle.getAttribute('aria-checked')).toBe('false')
    expect(within(dialog).getByText('Ready to link')).toBeTruthy()
    expect(mocks.mutateAdapter).toHaveBeenCalledTimes(1)
  })

  it('localizes the exact missing Feishu connection fields', async () => {
    await i18n.changeLanguage('zh')
    render(<ConnectorStatusPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Feishu/ }))
    const dialog = await screen.findByRole('dialog')

    expect(within(dialog).getByLabelText('Feishu 应用 ID')).toBeTruthy()
    expect(within(dialog).getByLabelText('Feishu 应用密钥')).toBeTruthy()
    expect(within(dialog).getByText('还需要填写：应用 ID · 应用密钥。')).toBeTruthy()
  })

  it('returns grouped token validation to the first invalid field', async () => {
    render(<ConnectorStatusPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Set up Slack' }))
    const dialog = await screen.findByRole('dialog')
    const botToken = within(dialog).getByLabelText('Slack Bot token') as HTMLInputElement
    const appToken = within(dialog).getByLabelText('Slack App-level token') as HTMLInputElement

    fireEvent.change(botToken, { target: { value: 'short-bot' } })
    fireEvent.change(appToken, { target: { value: 'short-app' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save connection' }))

    await waitFor(() => expect(document.activeElement).toBe(botToken))
    expect(mocks.mutateAdapter).not.toHaveBeenCalled()
    expect(botToken.getAttribute('aria-invalid')).toBe('true')
    expect(appToken.getAttribute('aria-invalid')).toBe('true')
    expect(botToken.className).toContain('!border-destructive/60')
    const botErrorId = botToken.getAttribute('aria-describedby')
    expect(botErrorId).toBeTruthy()
    expect(document.getElementById(botErrorId ?? '')?.textContent).toBe(
      'Token was not saved: Enter at least 20 non-whitespace characters.',
    )

    fireEvent.change(botToken, { target: { value: 'xoxb-plausible-slack-bot-token' } })
    expect(botToken.getAttribute('aria-invalid')).toBeNull()
    expect(botToken.getAttribute('aria-describedby')).toBeNull()
    expect(appToken.getAttribute('aria-invalid')).toBe('true')
  })

  it('finishes a pending auto-save after the configuration dialog closes', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.adapters.discord = {
      enabled: false,
      settings: { applicationId: 'discord-app', ownerUserId: 'owner-1' },
      configuredSecrets: ['botToken'],
    }
    mocks.load.mockResolvedValue(snapshot)
    render(<ConnectorStatusPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Manage Discord' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('switch', {
      name: 'Turn Discord on or off',
    }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(mocks.mutateAdapter).toHaveBeenCalled(), { timeout: 1_200 })
    expect(mocks.mutateAdapter).toHaveBeenCalledWith('discord', { enabled: true })
  })

  it('keeps auto-save feedback in the configuration dialog header', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.adapters.discord = {
      enabled: false,
      settings: { applicationId: 'discord-app', ownerUserId: 'owner-1' },
      configuredSecrets: ['botToken'],
    }
    mocks.load.mockResolvedValue(snapshot)
    mocks.mutateAdapter.mockReturnValue(new Promise(() => {}))
    render(<ConnectorStatusPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Manage Discord' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('switch', {
      name: 'Turn Discord on or off',
    }))

    await waitFor(() => expect(mocks.mutateAdapter).toHaveBeenCalled(), { timeout: 1_200 })
    const status = await within(dialog).findByRole('status')
    expect(status.textContent).toBe('Saving…')
    expect(status.closest('[data-slot="dialog-header"]')).toBeTruthy()
  })

  it('renders the Connector configuration route from the demo snapshot', async () => {
    render(<ConnectorsPage />)

    expect(await screen.findByText('Allow external delivery')).toBeTruthy()
    expect(screen.getByRole('switch', { name: 'Allow external delivery for all Connectors' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Discord' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Telegram' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Slack' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Feishu' })).toBeTruthy()
    expect(screen.getByText('Application ID')).toBeTruthy()
    expect(screen.getAllByText('Bot token')).toHaveLength(3)
    expect(screen.getByText('Prepare Slack first')).toBeTruthy()
    expect(screen.queryByText('Credentials required')).toBeNull()
    const slackSetup = screen.getByRole('link', { name: 'Open Slack app settings in a new tab' })
    expect(slackSetup.getAttribute('href')).toBe('https://api.slack.com/apps')
    expect(slackSetup.getAttribute('target')).toBe('_blank')
    expect(screen.queryByRole('button', { name: 'Send test' })).toBeNull()
  })

  it('jumps from the channel navigator to a focused settings section', async () => {
    render(<ConnectorsPage />)

    const navigation = await screen.findByRole('navigation', { name: 'Channel settings' })
    const channelGrid = navigation.querySelector('[data-connector-channel-grid]') as HTMLElement
    expect(channelGrid.className).toContain('grid-cols-1')
    expect(channelGrid.className).toContain('min-[380px]:grid-cols-2')
    expect(navigation.className).toContain('md:sticky')
    expect(navigation.className).toContain('md:top-0')
    const scrollArea = navigation.closest('[data-settings-scroll-area]') as HTMLElement
    expect(scrollArea.className).not.toContain('py-5')
    expect(scrollArea.querySelector('[data-connector-settings-top-spacer]')?.className).toContain('h-5')
    const navigationButtons = within(navigation).getAllByRole('button')
    expect(navigationButtons).toHaveLength(4)
    navigationButtons.forEach((button) => {
      expect(button.className).toContain('min-h-10')
      expect(button.className).toContain('min-[380px]:min-h-12')
      expect(button.className).toContain('min-[380px]:flex-col')
      expect(button.className).toContain('sm:flex-row')
    })
    const discordNavigation = within(navigation).getByRole('button', { name: /^Discord settings,/ })
    const slackNavigation = within(navigation).getByRole('button', { name: /^Slack settings,/ })
    const feishuNavigation = within(navigation).getByRole('button', { name: /^Feishu settings,/ })
    expect(discordNavigation.getAttribute('aria-current')).toBe('location')
    expect(slackNavigation.hasAttribute('aria-current')).toBe(false)
    const discordSection = screen.getByRole('region', { name: 'Discord' })
    const telegramSection = screen.getByRole('region', { name: 'Telegram' })
    const slackSection = screen.getByRole('region', { name: 'Slack' })
    const feishuSection = screen.getByRole('region', { name: 'Feishu' })
    const slackHeading = within(slackSection).getByRole('heading', { name: 'Slack' })
    expect(slackSection.className).toContain('md:scroll-mt-[9.5rem]')
    expect(slackSection.hasAttribute('tabindex')).toBe(false)
    expect(slackHeading.getAttribute('tabindex')).toBe('-1')
    expect(slackHeading.className).toContain('focus:ring-2')
    navigation.style.position = 'sticky'
    discordSection.style.scrollMarginTop = '152px'
    scrollArea.getBoundingClientRect = () => ({ top: 101 }) as DOMRect
    navigation.getBoundingClientRect = () => ({ height: 132 }) as DOMRect
    discordSection.getBoundingClientRect = () => ({ top: -900 }) as DOMRect
    telegramSection.getBoundingClientRect = () => ({ top: -240 }) as DOMRect
    slackSection.getBoundingClientRect = () => ({ top: 253 }) as DOMRect
    feishuSection.getBoundingClientRect = () => ({ top: 820 }) as DOMRect
    Object.defineProperties(scrollArea, {
      scrollTop: { configurable: true, value: 500 },
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 2_000 },
    })
    fireEvent.scroll(scrollArea)

    expect(slackNavigation.getAttribute('aria-current')).toBe('location')
    expect(discordNavigation.hasAttribute('aria-current')).toBe(false)

    const scrollIntoView = vi.fn()
    slackSection.scrollIntoView = scrollIntoView

    fireEvent.click(slackNavigation)

    expect(document.activeElement).toBe(slackHeading)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' })
    expect(slackNavigation.getAttribute('aria-current')).toBe('location')
    expect(discordNavigation.hasAttribute('aria-current')).toBe(false)

    Object.defineProperty(scrollArea, 'scrollTop', { configurable: true, value: 1_500 })
    fireEvent.scroll(scrollArea)

    expect(feishuNavigation.getAttribute('aria-current')).toBe('location')
    expect(slackNavigation.hasAttribute('aria-current')).toBe(false)
  })

  it('recovers when connection settings fail to load', async () => {
    mocks.load.mockRejectedValueOnce(new Error('socket closed'))
    render(<ConnectorsPage />)

    expect(await screen.findByRole('heading', { name: 'Connection settings are unavailable' })).toBeTruthy()
    expect(screen.queryByText('socket closed')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('Allow external delivery')).toBeTruthy()
    expect(mocks.load).toHaveBeenCalledTimes(2)
  })

  it('accepts shared live health without replacing a credential draft', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.serviceEnabled = true
    snapshot.health = {
      enabled: true,
      status: 'degraded',
    }
    mocks.load.mockResolvedValue(snapshot)

    const { rerender } = render(<ConnectorsPage />)
    await screen.findByRole('heading', { name: 'Delivery service' })
    expect(screen.getByText('Unavailable')).toBeTruthy()

    const draft = screen.getByLabelText('Slack Bot token') as HTMLInputElement
    fireEvent.change(draft, { target: { value: 'xoxb-unsaved-local-draft' } })

    mocks.liveRuntime.current = {
      health: {
        enabled: true,
        status: 'degraded',
        service: {
          status: 'degraded',
          startedAt: '2026-08-30T00:00:00.000Z',
          adapters: [],
        },
      },
      error: null,
    }
    rerender(<ConnectorsPage />)

    await waitFor(() => expect(screen.getByText('Running')).toBeTruthy())
    expect(draft.value).toBe('xoxb-unsaved-local-draft')

    mocks.liveRuntime.current = {
      ...mocks.liveRuntime.current,
      error: 'socket closed',
    }
    rerender(<ConnectorsPage />)

    expect(await screen.findByText('Couldn’t refresh live connection status. Your current settings are still shown.')).toBeTruthy()
    expect(screen.getByText('Running')).toBeTruthy()
    expect(draft.value).toBe('xoxb-unsaved-local-draft')
  })

  it('localizes Connector setup state and credential controls', async () => {
    await i18n.changeLanguage('zh')
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.adapters.telegram.configuredSecrets = ['botToken']
    mocks.load.mockResolvedValue(snapshot)
    render(<ConnectorsPage />)

    expect(await screen.findByRole('heading', { name: '连接器' })).toBeTruthy()
    expect(await screen.findByText('允许外部投递')).toBeTruthy()
    expect(screen.getByRole('switch', { name: '允许所有连接器进行外部投递' })).toBeTruthy()
    expect(screen.queryByText('需要凭据')).toBeNull()
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
    const sendTest = screen.getByRole('button', { name: 'Send test' })
    const lifecycle = sendTest.closest('section') as HTMLElement
    const runtimeToggle = within(lifecycle).getByRole('switch', { name: 'Turn Discord on or off' })
    expect(sendTest).toBeTruthy()
    expect(sendTest.className).toContain('min-h-10')
    expect(runtimeToggle.parentElement?.className).not.toContain('border')
    expect(runtimeToggle.parentElement?.className).not.toContain('rounded')
    expect(screen.queryByText('owner-1')).toBeNull()

    fireEvent.click(manage)
    expect(screen.getByRole('button', { name: 'Hide Discord connection details' }).getAttribute('aria-expanded'))
      .toBe('true')
    expect(screen.getByRole('textbox', { name: 'Discord Application ID' })).toBeTruthy()

    fireEvent.click(sendTest)
    await waitFor(() => expect(mocks.test).toHaveBeenCalledWith('discord'))
    const success = await within(lifecycle).findByRole('status')
    expect(success.textContent).toBe('Test sent. Check your private Discord chat.')
    expect(within(success).queryByText('connector-probe-demo')).toBeNull()
    const testDetails = within(lifecycle).getByText('Test details').closest('details') as HTMLDetailsElement
    expect(testDetails.open).toBe(false)
    expect(within(testDetails).getByText('connector-probe-demo')).toBeTruthy()
    fireEvent.click(within(testDetails).getByText('Test details'))
    expect(testDetails.open).toBe(true)
  })

  it('keeps a failed test delivery beside the connector action', async () => {
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
    mocks.test.mockRejectedValueOnce(new Error('delivery offline'))

    render(<ConnectorsPage />)

    const sendTest = await screen.findByRole('button', { name: 'Send test' })
    const lifecycle = sendTest.closest('section') as HTMLElement
    fireEvent.click(sendTest)

    const alert = await within(lifecycle).findByRole('alert')
    expect(alert.textContent).toBe('Test message wasn’t sent: delivery offline')
    expect(screen.getAllByText(/delivery offline/)).toHaveLength(1)
  })

  it('starts and stops a configured connector from its runtime switch', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.adapters.discord = {
      enabled: false,
      settings: { applicationId: 'discord-app', ownerUserId: 'owner-1' },
      configuredSecrets: ['botToken'],
    }
    mocks.load.mockResolvedValue(snapshot)

    render(<ConnectorsPage />)

    const runtimeSwitch = await screen.findByRole('switch', {
      name: 'Turn Discord on or off',
    })
    expect(runtimeSwitch.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(runtimeSwitch)

    await waitFor(() => expect(mocks.mutateAdapter).toHaveBeenCalled(), { timeout: 1_200 })
    expect(mocks.mutateAdapter).toHaveBeenCalledWith('discord', { enabled: true })
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

    fireEvent.click(await screen.findByRole('button', { name: 'Manage Discord connection details' }))
    const unlink = await screen.findByRole('button', { name: 'Unlink' })
    expect(unlink.className).toContain('min-h-10')
    fireEvent.click(unlink)
    expect(screen.getByRole('heading', { name: 'Unlink Discord?' })).toBeTruthy()
    await new Promise((resolve) => window.setTimeout(resolve, 800))
    expect(mocks.mutateAdapter).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Unlink Discord?' })).toBeNull()
    await new Promise((resolve) => window.setTimeout(resolve, 800))
    expect(mocks.mutateAdapter).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Unlink' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Unlink' }).at(-1)!)

    await waitFor(() => expect(mocks.mutateAdapter).toHaveBeenCalled(), { timeout: 1_200 })
    expect(mocks.mutateAdapter).toHaveBeenCalledWith('discord', { unset: ['ownerUserId'] })
  })

  it('keeps a secret as a local draft until the user saves a plausible token', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.adapters.discord.settings.applicationId = 'discord-app'
    mocks.load.mockResolvedValue(snapshot)
    render(<ConnectorsPage />)

    await screen.findByText('Allow external delivery')
    const input = screen.getAllByPlaceholderText('Stored locally and sealed')[0] as HTMLInputElement

    fireEvent.change(input, { target: { value: 'a' } })
    expect(input.value).toBe('a')
    await new Promise((resolve) => window.setTimeout(resolve, 800))
    expect(mocks.mutateAdapter).not.toHaveBeenCalled()
    expect(input.value).toBe('a')

    fireEvent.change(input, { target: { value: 'qweqw' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save connection' })[0])
    expect((await screen.findByRole('alert')).textContent).toContain('at least 20 non-whitespace characters')
    expect(mocks.mutateAdapter).not.toHaveBeenCalled()

    expect(input.type).toBe('password')
    fireEvent.click(screen.getAllByRole('button', { name: 'Show draft' })[0])
    expect(input.type).toBe('text')
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide draft' })[0])
    expect(input.type).toBe('password')

    fireEvent.change(input, { target: { value: '123456789:AAHplausible-bot-token' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save connection' })[0])

    await waitFor(() => expect(mocks.mutateAdapter).toHaveBeenCalled())
    expect(mocks.mutateAdapter).toHaveBeenCalledWith('discord', {
      setSecrets: { botToken: '123456789:AAHplausible-bot-token' },
    })
    await waitFor(() => expect(input.value).toBe(''))
    expect(input.placeholder).toBe('Configured — enter a new value to replace')
    fireEvent.click(screen.getByRole('button', { name: 'Manage Discord connection details' }))
    expect((screen.getAllByRole('button', { name: 'Replace token' })[0] as HTMLButtonElement).disabled).toBe(true)
  })

  it('retains a secret draft when saving fails', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.adapters.discord.settings.applicationId = 'discord-app'
    mocks.load.mockResolvedValue(snapshot)
    mocks.mutateAdapter.mockRejectedValueOnce(new Error('Connector settings unavailable'))
    render(<ConnectorsPage />)

    await screen.findByText('Allow external delivery')
    const input = screen.getAllByPlaceholderText('Stored locally and sealed')[0] as HTMLInputElement
    fireEvent.change(input, { target: { value: '123456789:AAHstill-here-bot-token' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save connection' })[0])

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Connection was not saved: Connector settings unavailable',
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
    const replace = screen.getByRole('button', { name: 'Replace token' })
    const remove = screen.getByRole('button', { name: 'Remove token' })
    expect(replace.className).toContain('min-h-10')
    expect(remove.className).toContain('min-h-10')
    fireEvent.click(replace)
    expect(screen.getByRole('heading', { name: 'Replace Discord token?' })).toBeTruthy()
    expect(mocks.mutateAdapter).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: 'Replace token' }).at(-1)!)
    await waitFor(() => expect(mocks.mutateAdapter).toHaveBeenCalled())
    expect(mocks.mutateAdapter.mock.calls.at(-1)).toEqual(['discord', {
      setSecrets: { botToken: '123456789:AAHreplacement-bot-token' },
    }])
  })

  it('rejects a short replacement draft before asking for confirmation', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.adapters.discord.configuredSecrets = ['botToken']
    mocks.load.mockResolvedValue(snapshot)
    render(<ConnectorsPage />)

    await screen.findByText('Allow external delivery')
    const input = screen.getByLabelText('Discord Bot token') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'qweqw' } })
    fireEvent.click(screen.getByRole('button', { name: 'Replace token' }))

    expect((await screen.findByRole('alert')).textContent).toContain('at least 20 non-whitespace characters')
    expect(screen.queryByRole('heading', { name: 'Replace Discord token?' })).toBeNull()
    expect(mocks.mutateAdapter).not.toHaveBeenCalled()
  })

  it('requires confirmation before removing a configured secret', async () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.adapters.discord.configuredSecrets = ['botToken']
    mocks.load.mockResolvedValue(snapshot)
    render(<ConnectorsPage />)

    await screen.findByText('Allow external delivery')
    fireEvent.click(screen.getByRole('button', { name: 'Remove token' }))

    expect(screen.getByRole('heading', { name: 'Remove Discord token?' })).toBeTruthy()
    expect(screen.getByText(/OpenAlice cannot recover this token after removal/)).toBeTruthy()
    await new Promise((resolve) => window.setTimeout(resolve, 800))
    expect(mocks.mutateAdapter).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('heading', { name: 'Remove Discord token?' })).toBeNull()
    await new Promise((resolve) => window.setTimeout(resolve, 800))
    expect(mocks.mutateAdapter).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Remove token' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Remove token' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove token' }).at(-1)!)

    await waitFor(() => expect(mocks.mutateAdapter).toHaveBeenCalled(), { timeout: 1_200 })
    expect(mocks.mutateAdapter).toHaveBeenCalledWith('discord', { removeSecrets: ['botToken'] })
  })
})
