// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDemoConnectorSnapshot } from '../demo/fixtures/connectors'
import { i18n } from '../i18n'
import { ConnectorStatusPage } from './ConnectorStatusPage'

const mocks = vi.hoisted(() => ({
  state: {
    current: {
      snapshot: null,
      loading: true,
      refreshing: false,
      error: null,
      lastUpdatedAt: null,
    } as {
      snapshot: ReturnType<typeof createDemoConnectorSnapshot> | null
      loading: boolean
      refreshing: boolean
      error: string | null
      lastUpdatedAt: string | null
    },
  },
  refresh: vi.fn(),
  reconnect: vi.fn(),
  toggle: vi.fn(),
}))

vi.mock('../live/connector-health', () => ({
  useConnectorHealthState: () => mocks.state.current,
  refreshConnectorHealth: mocks.refresh,
  reconnectConnector: mocks.reconnect,
  setConnectorEnabled: mocks.toggle,
}))

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  mocks.state.current = {
    snapshot: null,
    loading: true,
    refreshing: false,
    error: null,
    lastUpdatedAt: null,
  }
  mocks.reconnect.mockResolvedValue('adapter')
  mocks.toggle.mockResolvedValue(undefined)
})

afterEach(() => cleanup())

describe('Connector overview state hierarchy', () => {
  it('shows a layout-matched skeleton during the first load', () => {
    render(<ConnectorStatusPage />)

    expect(screen.getByRole('status', { name: 'Loading your channels' })).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(4)
    expect(screen.queryByText('Your channels')).toBeNull()
  })

  it('offers focused recovery when no snapshot can be loaded', () => {
    mocks.state.current = {
      ...mocks.state.current,
      loading: false,
      error: 'socket closed',
    }
    render(<ConnectorStatusPage />)

    expect(screen.getByRole('heading', { name: 'Couldn’t load your channels' })).toBeTruthy()
    expect(screen.queryByText('socket closed')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('keeps last-known channels visible after a refresh failure', () => {
    mocks.state.current = {
      snapshot: createDemoConnectorSnapshot(),
      loading: false,
      refreshing: false,
      error: 'socket closed',
      lastUpdatedAt: '2026-08-30T00:00:00.000Z',
    }
    render(<ConnectorStatusPage />)

    expect(screen.getByRole('heading', { name: 'Choose a channel' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Showing the last known state')
    expect(screen.queryByRole('heading', { name: 'Couldn’t load your channels' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('separates owned or in-progress channels from pristine availability', () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.adapters.discord = {
      enabled: false,
      settings: { ownerUserId: 'owner-1' },
      configuredSecrets: ['botToken'],
    }
    snapshot.config.adapters.slack = {
      enabled: false,
      settings: {},
      configuredSecrets: ['botToken'],
    }
    snapshot.config.adapters.feishu = {
      enabled: false,
      settings: { appId: 'demo-app', ownerUserId: 'owner-2' },
      configuredSecrets: ['appSecret'],
    }
    mocks.state.current = {
      snapshot,
      loading: false,
      refreshing: false,
      error: null,
      lastUpdatedAt: null,
    }
    render(<ConnectorStatusPage />)

    const owned = screen.getByRole('heading', { name: 'Your channels' }).closest('section') as HTMLElement
    const available = screen.getByRole('heading', { name: 'Available channels' }).closest('section') as HTMLElement
    const headings = (section: HTMLElement) => within(section).getAllByRole('article').map((article) =>
      within(article).getByRole('heading', { level: 4 }).textContent)

    expect(headings(owned)).toEqual(['Discord', 'Slack', 'Feishu'])
    expect(headings(available)).toEqual(['Telegram'])
  })

  it('starts with a concise capability-aware channel chooser', () => {
    mocks.state.current = loaded(createDemoConnectorSnapshot())
    render(<ConnectorStatusPage />)

    expect(screen.queryByRole('heading', { name: 'Delivery service' })).toBeNull()
    const chooser = screen.getByRole('heading', { name: 'Choose a channel' }).closest('section') as HTMLElement
    expect(within(chooser).getByText(
      'Connect the private chat you already use. You can add other channels later.',
    )).toBeTruthy()
    expect(within(chooser).queryByText('Needs setup')).toBeNull()
    expect(within(chooser).getAllByText('Inbox delivery')).toHaveLength(4)
    expect(within(chooser).getAllByText('Workspace chat')).toHaveLength(2)
    expect(within(chooser).getAllByRole('article')).toHaveLength(4)
    const discord = within(chooser).getByRole('heading', { name: 'Discord' }).closest('article') as HTMLElement
    const setup = within(discord).getByRole('button', { name: 'Set up Discord' })
    const glyph = discord.querySelector('[data-connector-glyph]') as HTMLElement
    expect(discord.className).toContain('rounded-xl')
    expect(glyph.className).toContain('bg-secondary/60')
    expect(glyph.className).not.toContain('bg-primary')
    expect(setup.className).toContain('bg-background/60')
    expect(setup.className).toContain('min-h-10')
    expect(setup.className).not.toContain('bg-primary')
  })

  it('offers the runtime switch on a credential-ready channel card', async () => {
    const snapshot = readyDiscordSnapshot()
    // Pause all preserves the adapter's preference, but the visible runtime
    // switch still reflects that the channel is not currently running.
    snapshot.config.adapters.discord.enabled = true
    mocks.state.current = loaded(snapshot)
    render(<ConnectorStatusPage />)

    const discord = screen.getByRole('heading', { name: 'Discord' }).closest('article') as HTMLElement
    const toggle = within(discord).getByRole('switch', { name: 'Turn Discord on or off' })
    const actionRail = discord.querySelector('[data-connector-card-action-rail]') as HTMLElement
    const runtimeControl = discord.querySelector('[data-connector-runtime-control]') as HTMLElement
    const manage = within(discord).getByRole('button', { name: 'Manage Discord' })
    const glyph = discord.querySelector('[data-connector-glyph]') as HTMLElement
    expect(glyph.className).toContain('bg-secondary/60')
    expect(glyph.className).not.toContain('bg-primary')
    expect(actionRail.className).toContain('flex-wrap')
    expect(actionRail.className).toContain('gap-y-3')
    expect(runtimeControl.className).toContain('flex-1')
    expect(manage.className).toContain('min-h-10')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('switch', { name: 'Turn Slack on or off' })).toBeNull()

    fireEvent.click(toggle)
    await waitFor(() => expect(mocks.toggle).toHaveBeenCalledWith('discord', true))
  })

  it('makes starting the channel the only emphasized ready-to-link action', () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.adapters.discord = {
      enabled: false,
      settings: { applicationId: 'discord-app' },
      configuredSecrets: ['botToken'],
    }
    mocks.state.current = loaded(snapshot)
    render(<ConnectorStatusPage />)

    const discord = screen.getByRole('heading', { name: 'Discord' }).closest('article') as HTMLElement
    expect(within(discord).getByText('Start Discord').className).toContain('text-primary')
    expect(within(discord).getByRole('switch', { name: 'Turn Discord on or off' })).toBeTruthy()
    const details = within(discord).getByRole('button', { name: 'Discord setup details' })
    expect(details.className).toContain('bg-background/50')
    expect(details.className).not.toContain('bg-primary text-primary-foreground')
  })

  it('promotes linking instructions only after the channel is awaiting /link', () => {
    const snapshot = createDemoConnectorSnapshot()
    snapshot.config.serviceEnabled = true
    snapshot.config.adapters.discord = {
      enabled: true,
      settings: { applicationId: 'discord-app' },
      configuredSecrets: ['botToken'],
    }
    snapshot.health = {
      enabled: true,
      status: 'healthy',
      service: {
        status: 'healthy',
        startedAt: '2026-08-30T00:00:00.000Z',
        adapters: [{ id: 'discord', enabled: true, status: 'awaiting_link' }],
      },
    }
    mocks.state.current = loaded(snapshot)
    render(<ConnectorStatusPage />)

    const discord = screen.getByRole('heading', { name: 'Discord' }).closest('article') as HTMLElement
    expect(within(discord).getByText('Waiting for /link')).toBeTruthy()
    expect(within(discord).getByText('Use Discord')).toBeTruthy()
    const linkingSteps = within(discord).getByRole('button', { name: 'Show Discord linking steps' })
    expect(linkingSteps.className).toContain('bg-primary text-primary-foreground')
  })

  it('announces a channel runtime change inside the affected card', async () => {
    let resolveToggle!: () => void
    mocks.toggle.mockReturnValueOnce(new Promise<void>((resolve) => { resolveToggle = resolve }))
    mocks.state.current = loaded(readyDiscordSnapshot())
    render(<ConnectorStatusPage />)

    const discord = screen.getByRole('heading', { name: 'Discord' }).closest('article') as HTMLElement
    const toggle = within(discord).getByRole('switch', { name: 'Turn Discord on or off' })
    fireEvent.click(toggle)

    expect((await within(discord).findByRole('status')).textContent).toBe('Turning Discord on…')
    expect(toggle.hasAttribute('disabled')).toBe(true)
    resolveToggle()
    await waitFor(() => expect(within(discord).queryByRole('status')).toBeNull())
  })

  it('keeps a failed runtime change inside the affected card', async () => {
    mocks.toggle.mockRejectedValueOnce(new Error('service unavailable'))
    mocks.state.current = loaded(readyDiscordSnapshot())
    render(<ConnectorStatusPage />)

    const discord = screen.getByRole('heading', { name: 'Discord' }).closest('article') as HTMLElement
    fireEvent.click(within(discord).getByRole('switch', { name: 'Turn Discord on or off' }))

    const alert = await within(discord).findByRole('alert')
    expect(alert.textContent).toBe('Couldn’t turn Discord on: service unavailable')
    expect(screen.getAllByText(/service unavailable/)).toHaveLength(1)
  })

  it('keeps a failed reconnect inside the affected card', async () => {
    mocks.reconnect.mockRejectedValueOnce(new Error('socket closed'))
    mocks.state.current = loaded(readyDiscordSnapshot({ degraded: true }))
    render(<ConnectorStatusPage />)

    const discord = screen.getByRole('heading', { name: 'Discord' }).closest('article') as HTMLElement
    const reconnect = within(discord).getByRole('button', { name: 'Reconnect' })
    const review = within(discord).getByRole('button', { name: 'Review Discord' })
    expect(reconnect.className).toContain('min-h-10')
    expect(review.className).toContain('min-h-10')
    fireEvent.click(reconnect)

    const alert = await within(discord).findByRole('alert')
    expect(alert.textContent).toBe('Couldn’t reconnect Discord: socket closed')
    expect(screen.getAllByText(/socket closed/)).toHaveLength(1)
  })

  it('keeps reachable channel degradation on the owning channel card', () => {
    const snapshot = readyDiscordSnapshot({ degraded: true })
    snapshot.health.lastError = 'discord: connection lost'
    mocks.state.current = loaded(snapshot)
    render(<ConnectorStatusPage />)

    const service = screen.getByRole('heading', { name: 'Delivery service' }).closest('section') as HTMLElement
    expect(within(service).getByText('Running')).toBeTruthy()
    expect(within(service).getByText(
      'Delivery remains available for healthy channels. Review the flagged channel below.',
    )).toBeTruthy()
    expect(service.className).toContain('border-warning/25')
    expect(within(service).queryByText('Technical details')).toBeNull()

    const discord = screen.getByRole('heading', { name: 'Discord' }).closest('article') as HTMLElement
    expect(within(discord).getByText('Needs attention')).toBeTruthy()
    expect(within(discord).getByText('Technical details')).toBeTruthy()
  })

  it('reserves the service-level error treatment for an unreachable service', () => {
    const snapshot = readyDiscordSnapshot({ degraded: true })
    snapshot.health.service = undefined
    snapshot.health.reason = 'unreachable'
    snapshot.health.lastError = 'ECONNREFUSED'
    mocks.state.current = loaded(snapshot)
    render(<ConnectorStatusPage />)

    const service = screen.getByRole('heading', { name: 'Delivery service' }).closest('section') as HTMLElement
    expect(within(service).getByText('Unavailable')).toBeTruthy()
    expect(within(service).getByText(
      'OpenAlice could not reach the delivery service. Your Inbox keeps working.',
    )).toBeTruthy()
    expect(service.className).toContain('border-destructive/25')
    expect(within(service).getByText('Technical details')).toBeTruthy()
    expect(within(service).getByText('ECONNREFUSED')).toBeTruthy()
  })
})

function loaded(snapshot: ReturnType<typeof createDemoConnectorSnapshot>) {
  return {
    snapshot,
    loading: false,
    refreshing: false,
    error: null,
    lastUpdatedAt: '2026-08-30T00:00:00.000Z',
  }
}

function readyDiscordSnapshot({ degraded = false }: { degraded?: boolean } = {}) {
  const snapshot = createDemoConnectorSnapshot()
  snapshot.config.serviceEnabled = degraded
  snapshot.config.adapters.discord = {
    enabled: degraded,
    settings: { applicationId: 'discord-app', ownerUserId: 'owner-1' },
    configuredSecrets: ['botToken'],
  }
  snapshot.health = degraded
    ? {
        enabled: true,
        status: 'degraded',
        service: {
          status: 'degraded',
          startedAt: '2026-08-30T00:00:00.000Z',
          adapters: [{ id: 'discord', enabled: true, status: 'degraded', lastError: 'connection lost' }],
        },
      }
    : { enabled: false, status: 'disabled' }
  return snapshot
}
