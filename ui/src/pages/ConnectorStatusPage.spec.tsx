// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
}))

vi.mock('../live/connector-health', () => ({
  useConnectorHealthState: () => mocks.state.current,
  refreshConnectorHealth: mocks.refresh,
  reconnectConnector: mocks.reconnect,
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

    expect(screen.getByRole('heading', { name: 'Your channels' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Showing the last known state')
    expect(screen.queryByRole('heading', { name: 'Couldn’t load your channels' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })
})
