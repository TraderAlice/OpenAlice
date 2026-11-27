// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getBackendConnection: vi.fn(),
  useAliceProject: vi.fn(),
  useRelayConnection: vi.fn(),
}))

vi.mock('../../auth/backendConnection', () => ({ getBackendConnection: mocks.getBackendConnection }))
vi.mock('../../hooks/useAliceProject', () => ({ useAliceProject: mocks.useAliceProject }))
vi.mock('../../hooks/useRelayConnection', () => ({ useRelayConnection: mocks.useRelayConnection }))

import '../../i18n'
import { i18n } from '../../i18n'
import { AliceLocationSection } from './AliceLocationSection'

beforeAll(async () => { await i18n.changeLanguage('en') })
beforeEach(() => {
  mocks.useRelayConnection.mockReturnValue({
    status: null, fleet: [], startup: null, loading: false, busy: false, error: null,
    refresh: vi.fn(), connect: vi.fn(),
  })
})
afterEach(() => { cleanup(); vi.clearAllMocks(); Reflect.deleteProperty(window, 'openAlice') })

describe('AliceLocationSection', () => {
  it('renders current machine/project without Switch location modal and reveals technical IDs + embedded Data location', () => {
    mocks.getBackendConnection.mockReturnValue({ kind: 'local', endpoint: '127.0.0.1:54000' })
    mocks.useRelayConnection.mockReturnValue({
      status: { target: { machine: 'studio', machineName: 'Studio Mac', project: 'research' } },
      fleet: [{
        key: 'studio',
        displayName: 'Studio Mac',
        connection: 'online',
        projects: [{ key: 'research', id: 'project-1', displayName: 'Research desk', available: true, runtime: { class: 'running', state: 'running', webEndpoint: 'http://127.0.0.1:55000' } }],
        issue: null,
      }],
      startup: { target: { machine: 'studio', project: 'research' }, error: null },
      loading: false,
      busy: false,
      error: null,
      refresh: vi.fn(),
      connect: vi.fn(),
    })
    mocks.useAliceProject.mockReturnValue({
      project: { id: 'project-1', key: 'research', displayName: 'Research desk', home: '/data/research', appRoot: '/opt/openalice' },
      loading: false, error: null, refresh: vi.fn(),
    })

    render(<AliceLocationSection />)
    expect(screen.getByText('Where Alice is working')).toBeTruthy()
    expect(screen.getByText('Studio Mac')).toBeTruthy()
    expect(screen.getByText('Research desk')).toBeTruthy()
    expect(screen.getByText('Connected · Remote')).toBeTruthy()
    expect(screen.getByText('Default:')).toBeTruthy()
    expect(screen.getByText('Studio Mac / Research desk')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Switch location' })).toBeNull()
    expect(screen.queryByText('127.0.0.1:54000')).toBeNull()
    expect(screen.queryByText('Data location')).toBeNull()

    const disclosure = screen.getByRole('button', { name: 'Environment & location details' })
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(disclosure)
    expect(disclosure.getAttribute('aria-expanded')).toBe('true')

    expect(screen.getByText(window.location.host)).toBeTruthy()
    expect(screen.getByText('project-1')).toBeTruthy()
    expect(screen.getByText('research')).toBeTruthy()
    expect(screen.getByText('/data/research')).toBeTruthy()
    expect(screen.getByText('Data location')).toBeTruthy()
    expect(screen.getByText(/belongs to the connected remote Runtime/i)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the integrated Electron owner and startup errors without a modal switcher', () => {
    Object.defineProperty(window, 'openAlice', { value: {
      runtime: { info: vi.fn() },
      desktopConnection: { status: vi.fn(), fleet: vi.fn(), connect: vi.fn(), returnIntegrated: vi.fn() },
    }, configurable: true })
    mocks.getBackendConnection.mockReturnValue({ kind: 'electron' })
    mocks.useRelayConnection.mockReturnValue({
      status: { schemaVersion: 1, generation: 0, target: { machine: 'local', project: '@electron-current' }, switching: false },
      fleet: [],
      startup: { target: null, error: 'Saved remote target is offline' },
      loading: false, busy: false, error: null, refresh: vi.fn(), connect: vi.fn(),
    })
    mocks.useAliceProject.mockReturnValue({
      project: { id: 'local-1', key: '@electron-current', displayName: 'Local Alice', home: '/home/alice', appRoot: null },
      loading: false, error: null, refresh: vi.fn(),
    })

    render(<AliceLocationSection />)
    expect(screen.getByText('This machine')).toBeTruthy()
    expect(screen.getByText('Local Alice')).toBeTruthy()
    expect(screen.getByText('Connected · Integrated mode')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Saved remote target is offline')
    expect(screen.queryByRole('button', { name: 'Switch location' })).toBeNull()
  })

  it('shows Use local integrated mode and Retry when separated and project is unavailable', () => {
    const returnIntegrated = vi.fn().mockResolvedValue(undefined)
    const refresh = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'openAlice', { value: {
      desktopConnection: { status: vi.fn(), fleet: vi.fn(), connect: vi.fn(), returnIntegrated },
    }, configurable: true })
    mocks.getBackendConnection.mockReturnValue({ kind: 'local', endpoint: '127.0.0.1:54000' })
    mocks.useRelayConnection.mockReturnValue({
      status: { target: { machine: 'studio', machineName: 'Studio Mac', project: 'research' } },
      fleet: [], startup: { target: null, error: null },
      loading: false, busy: false, error: null, refresh: vi.fn(), connect: vi.fn(),
    })
    mocks.useAliceProject.mockReturnValue({
      project: null,
      loading: false, error: 'Connection refused', refresh,
    })

    render(<AliceLocationSection />)
    expect(screen.getByText(/Unavailable · Remote/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Use local integrated mode' }))
    expect(returnIntegrated).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refresh).toHaveBeenCalledOnce()
  })
})
