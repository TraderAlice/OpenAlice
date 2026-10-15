// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ useRelayConnection: vi.fn(), refresh: vi.fn(), connect: vi.fn() }))
vi.mock('../hooks/useRelayConnection', () => ({ useRelayConnection: mocks.useRelayConnection }))

import '../i18n'
import { i18n } from '../i18n'
import { RelayConnectionChooser } from './RelayConnectionChooser'

const status = { schemaVersion: 1 as const, generation: 0, switching: false, target: {
  machine: 'local', machineName: 'This computer', project: 'demo', projectName: 'Demo AliceProject',
} }
const fleet = [
  { key: 'local', displayName: 'This computer', connection: 'local', issue: null, projects: [
    { key: 'demo', id: 'demo', displayName: 'Demo AliceProject', available: true, runtime: { class: 'running', state: 'ready', webEndpoint: 'http://localhost:47331' } },
  ] },
  { key: 'studio', displayName: 'Studio Mac', connection: 'online', issue: null, projects: [
    { key: 'research', id: 'research', displayName: 'Research desk', available: true, runtime: { class: 'running', state: 'ready', webEndpoint: 'http://localhost:47332' } },
    { key: 'stopped', id: 'stopped', displayName: 'Stopped project', available: false, runtime: { class: 'absent', state: 'stopped', webEndpoint: null } },
  ] },
]

beforeAll(async () => { await i18n.changeLanguage('en') })
beforeEach(() => {
  mocks.connect.mockResolvedValue(undefined)
  mocks.useRelayConnection.mockReturnValue({ status, fleet, loading: false, busy: false, error: null, refresh: mocks.refresh, connect: mocks.connect })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('RelayConnectionChooser', () => {
  it('keeps a stable selection surface and disabled switch action while discovery is pending', () => {
    mocks.useRelayConnection.mockReturnValue({ status, fleet: [], loading: true, busy: false, error: null, refresh: mocks.refresh, connect: mocks.connect })
    render(<RelayConnectionChooser open onOpenChange={vi.fn()} initialStatus={status} />)
    expect(screen.getByText('Current location:')).toBeTruthy()
    expect(screen.getByText('Finding locations…')).toBeTruthy()
    expect(screen.getByText('Checking AliceProjects…')).toBeTruthy()
    expect(screen.getByText('Destination')).toBeTruthy()
    expect(screen.getByRole('dialog').querySelector('button[disabled]')?.textContent).toContain('Reconnect')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
  })

  it('shows the destination before switching and refuses stopped projects', () => {
    render(<RelayConnectionChooser open onOpenChange={vi.fn()} initialStatus={status} />)
    fireEvent.click(screen.getByRole('button', { name: /Studio Mac/ }))
    expect(screen.getByRole('button', { name: /Stopped project/ }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: /Research desk/ }))
    expect(screen.getByText('Studio Mac · Research desk')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Switch location' }))
    expect(mocks.connect).toHaveBeenCalledWith('studio', 'research')
  })
})
