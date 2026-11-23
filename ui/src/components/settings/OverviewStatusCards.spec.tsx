// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConnectorSettingsSnapshot, UTASummary } from '../../api'
import type { AgentInfo, AgentRuntimeReadinessSnapshot } from '../workspace/api'

const mocks = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
  ensureTradingModePolling: vi.fn(),
  tradingMode: 'pro' as 'lite' | 'readonly' | 'pro',
  project: { id: 'proj-1', key: 'main', displayName: 'Main', home: '/tmp/main', appRoot: null, product: 'trader' as 'trader' | 'nano' },
  catalog: [] as AgentInfo[],
  readiness: null as AgentRuntimeReadinessSnapshot | null,
  runtimesLoading: false,
  getCredentials: vi.fn(),
  listUTASummaries: vi.fn(),
  loadConnectors: vi.fn(),
}))

vi.mock('../../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) =>
    selector({ openOrFocus: mocks.openOrFocus }),
}))

vi.mock('../../hooks/useAliceProject', () => ({
  useAliceProject: () => ({ project: mocks.project, loading: false, error: null, refresh: vi.fn() }),
}))

vi.mock('../../hooks/useAgentRuntimes', () => ({
  useAgentRuntimes: () => ({
    catalog: mocks.catalog,
    readiness: mocks.readiness,
    loading: mocks.runtimesLoading,
  }),
}))

vi.mock('../../live/trading-mode', () => ({
  ensureTradingModePolling: mocks.ensureTradingModePolling,
  useTradingMode: (selector: (state: { status: { mode: 'lite' | 'readonly' | 'pro' } }) => unknown) =>
    selector({ status: { mode: mocks.tradingMode } }),
}))

vi.mock('../../api', () => ({
  api: {
    config: { getCredentials: mocks.getCredentials },
    trading: { listUTASummaries: mocks.listUTASummaries },
    connectors: { load: mocks.loadConnectors },
  },
}))

import '../../i18n'
import { i18n } from '../../i18n'
import { useLocaleStore } from '../../i18n/store'
import { useThemeStore } from '../../theme/store'
import { OverviewStatusCards } from './OverviewStatusCards'

function agentInfo(id: string): AgentInfo {
  return {
    id,
    displayName: id,
    kind: 'agent',
    installed: true,
    capabilities: { parallelPerCwd: true, resumeLast: true, resumeById: true, transcriptDiscovery: 'none' },
  }
}

function uta(id: string, status: 'healthy' | 'degraded' | 'offline', disabled = false): UTASummary {
  return {
    id,
    label: id,
    asVendor: false,
    capabilities: { supportedSecTypes: ['STK'], supportedOrderTypes: ['MKT'] },
    health: { status, reach: 'readable', tier: 'trading', consecutiveFailures: 0, recovering: false, connecting: false, disabled },
  }
}

function connectorSnapshot(adapters: Array<{ id: string; enabled: boolean; status: 'healthy' | 'degraded' | 'stopped' }>): ConnectorSettingsSnapshot {
  return {
    definitions: adapters.map((adapter) => ({
      id: adapter.id,
      label: adapter.id,
      description: adapter.id,
      fields: [{ key: 'token', label: 'Token', kind: 'secret', required: true }],
      commands: [],
    })),
    config: {
      serviceEnabled: true,
      adapters: Object.fromEntries(adapters.map((adapter) => [
        adapter.id,
        { enabled: adapter.enabled, settings: {}, configuredSecrets: ['token'] },
      ])),
    },
    health: {
      enabled: true,
      status: adapters.some((a) => a.enabled && a.status !== 'healthy') ? 'degraded' : 'healthy',
      service: {
        status: adapters.some((a) => a.enabled && a.status !== 'healthy') ? 'degraded' : 'healthy',
        startedAt: '2026-11-23T00:00:00.000Z',
        adapters: adapters.map((adapter) => ({
          id: adapter.id,
          enabled: adapter.enabled,
          status: adapter.status,
        })),
      },
    },
  }
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: false,
    media: '(prefers-color-scheme: dark)',
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  } satisfies MediaQueryList)))

  localStorage.clear()
  useThemeStore.setState({ theme: 'auto', dayPalette: 'codex', nightPalette: 'graphite', uiStyle: 'default', stylePaletteMode: 'saved' })
  useLocaleStore.setState({ locale: 'en' })
  await i18n.changeLanguage('en')

  mocks.project = { id: 'proj-1', key: 'main', displayName: 'Main', home: '/tmp/main', appRoot: null, product: 'trader' }
  mocks.tradingMode = 'pro'
  mocks.runtimesLoading = false
  mocks.catalog = [agentInfo('claude'), agentInfo('codex'), agentInfo('pi')]
  mocks.readiness = {
    overallReady: true,
    checkedAt: '2026-11-23T00:00:00.000Z',
    agents: {
      claude: { agent: 'claude', displayName: 'Claude', installed: true, binPath: '/bin/claude', status: 'ready', ready: true, source: 'global-login', checkedAt: null, durationMs: 5 },
      codex: { agent: 'codex', displayName: 'Codex', installed: true, binPath: '/bin/codex', status: 'ready', ready: true, source: 'global-login', checkedAt: null, durationMs: 5 },
      pi: { agent: 'pi', displayName: 'Pi', installed: true, binPath: '/bin/pi', status: 'auth_required', ready: false, source: 'unknown', checkedAt: null, durationMs: 5 },
    },
  }
  mocks.getCredentials.mockResolvedValue({ credentials: [{ slug: 'openai' }, { slug: 'anthropic' }] })
  mocks.listUTASummaries.mockResolvedValue({ utas: [uta('ibkr', 'healthy'), uta('alpaca', 'degraded'), uta('disabled-one', 'offline', true)] })
  mocks.loadConnectors.mockResolvedValue(connectorSnapshot([
    { id: 'telegram', enabled: true, status: 'healthy' },
    { id: 'discord', enabled: true, status: 'degraded' },
  ]))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('OverviewStatusCards', () => {
  it('renders the three operational cards with live counts and routes to settings categories', async () => {
    render(<OverviewStatusCards />)

    expect(screen.getByRole('heading', { name: 'Agents & Models' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Trading & Brokers' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Connectors' })).toBeTruthy()
    expect(mocks.ensureTradingModePolling).toHaveBeenCalledOnce()

    expect(screen.getByText('2/3')).toBeTruthy()
    expect(screen.getByText('CLI ready')).toBeTruthy()
    expect(screen.getByText('Mode: Pro')).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByText('2')).toBeTruthy()
      expect(screen.getByText('API keys')).toBeTruthy()
      expect(screen.getByText('1 connected · 1 needing attention')).toBeTruthy()
      expect(screen.getByText('1 active · 1 needing attention')).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Agent runtimes' }))
    expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'settings', params: { category: 'agent-runtimes' } })

    fireEvent.click(screen.getByRole('button', { name: 'AI Provider' }))
    expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'settings', params: { category: 'ai-provider' } })

    fireEvent.click(screen.getByRole('button', { name: 'Mode: Pro' }))
    expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'settings', params: { category: 'agent-permissions' } })

    fireEvent.click(screen.getByRole('button', { name: 'Mode' }))
    expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'settings', params: { category: 'agent-permissions' } })

    fireEvent.click(screen.getByRole('button', { name: 'Broker' }))
    expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'settings', params: { category: 'trading' } })

    fireEvent.click(screen.getByRole('button', { name: 'Manage connectors' }))
    expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'settings', params: { category: 'connectors' } })
  })

  it('hides Trading & Brokers for Nano products and skips trading fetches', async () => {
    mocks.project = { ...mocks.project, product: 'nano' }
    mocks.getCredentials.mockResolvedValue({ credentials: [] })
    mocks.loadConnectors.mockResolvedValue(connectorSnapshot([
      { id: 'telegram', enabled: false, status: 'stopped' },
    ]))

    render(<OverviewStatusCards />)

    expect(screen.getByRole('heading', { name: 'Agents & Models' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Trading & Brokers' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Connectors' })).toBeTruthy()
    expect(mocks.ensureTradingModePolling).not.toHaveBeenCalled()
    expect(mocks.listUTASummaries).not.toHaveBeenCalled()

    await waitFor(() => {
      expect(screen.getByText('No API keys stored (CLI auth only)')).toBeTruthy()
      expect(screen.getByText('No active connectors configured')).toBeTruthy()
    })
  })

  it('switches appearance theme mode and UI language inline and links to Appearance', () => {
    render(<OverviewStatusCards />)

    expect(screen.getByText('Codex')).toBeTruthy()
    const autoButton = screen.getByRole('button', { name: 'Auto' })
    const nightButton = screen.getByRole('button', { name: 'Night' })
    expect(autoButton.getAttribute('aria-pressed')).toBe('true')
    expect(nightButton.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(nightButton)
    expect(useThemeStore.getState().theme).toBe('night')
    expect(nightButton.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Graphite')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Customize skin' }))
    expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'settings', params: { category: 'appearance' } })

    const enButton = screen.getByRole('button', { name: 'English' })
    const zhButton = screen.getByRole('button', { name: '中文' })
    expect(enButton.getAttribute('aria-pressed')).toBe('true')
    expect(zhButton.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(zhButton)
    expect(useLocaleStore.getState().locale).toBe('zh')
  })

  it('shows healthy and empty broker/connector/runtime summaries cleanly', async () => {
    mocks.runtimesLoading = true
    mocks.catalog = []
    mocks.readiness = null
    mocks.listUTASummaries.mockResolvedValue({ utas: [uta('ibkr', 'healthy'), uta('alpaca', 'healthy')] })
    mocks.loadConnectors.mockResolvedValue(connectorSnapshot([
      { id: 'telegram', enabled: true, status: 'healthy' },
    ]))

    const { rerender } = render(<OverviewStatusCards />)
    expect(screen.getByText('Checking agent runtimes…')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getByText('2 broker accounts connected')).toBeTruthy()
      expect(screen.getByText('1 active channels')).toBeTruthy()
    })

    mocks.runtimesLoading = false
    rerender(<OverviewStatusCards />)
    expect(screen.getByText('Runtime status unavailable')).toBeTruthy()
  })
})
