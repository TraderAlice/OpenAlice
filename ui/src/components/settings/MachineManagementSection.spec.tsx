// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MachineManagementSection } from './MachineManagementSection'

const manager = vi.hoisted(() => ({
  refresh: vi.fn(),
  clearPlan: vi.fn(),
  probe: vi.fn(async () => undefined),
  connect: vi.fn(async () => undefined),
  status: { target: { machine: 'cloud', project: 'research' } } as { target: { machine: string; project: string } } | null,
  startup: undefined as { target: { machine: string; project: string } | null; error: string | null } | undefined,
  loading: false,
  probing: false,
  applying: false,
  busy: false as boolean | undefined,
  plan: null,
  operation: null,
  error: null as string | null,
  operationError: null as string | null,
  fleet: [
    {
      key: 'cloud',
      displayName: 'Cloud',
      sshTarget: 'fixture.test',
      connection: 'online',
      cliVersion: '0.94.1',
      defaultProject: 'research',
      projects: [{ key: 'research', displayName: 'Research', available: true, runtime: { class: 'absent', webEndpoint: null } }],
    },
  ] as Array<{
    key: string
    displayName: string
    sshTarget?: string | null
    connection: string
    cliVersion?: string | null
    defaultProject?: string | null
    projects: Array<{ key: string; displayName: string; available: boolean; runtime: { class: string; state?: string; webEndpoint?: string | null } }>
    issue?: { message: string } | null
  }>,
}))

vi.mock('../../hooks/useUpdateLifecycle', () => ({ useUpdateLifecycle: () => ({ machines: manager }) }))
vi.mock('./MachineUpgradeDialog', () => ({ MachineUpgradeDialog: () => null }))

beforeEach(() => {
  manager.status = { target: { machine: 'cloud', project: 'research' } }
  manager.startup = undefined
  manager.loading = false
  manager.probing = false
  manager.applying = false
  manager.busy = false
  manager.error = null
  manager.operationError = null
  manager.fleet = [
    {
      key: 'cloud',
      displayName: 'Cloud',
      sshTarget: 'fixture.test',
      connection: 'online',
      cliVersion: '0.94.1',
      defaultProject: 'research',
      projects: [{ key: 'research', displayName: 'Research', available: true, runtime: { class: 'absent', webEndpoint: null } }],
    },
  ]
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('MachineManagementSection', () => {
  it('keeps a stopped project selectable for reviewed activation recovery', async () => {
    render(<MachineManagementSection />)
    fireEvent.click(screen.getByRole('button', { name: /Cloud/ }))
    expect(screen.getByRole('combobox', { name: 'AliceProject' }).textContent).toBe('Research')
    fireEvent.click(screen.getByRole('button', { name: 'Probe and review' }))
    await waitFor(() => expect(manager.probe).toHaveBeenCalledWith({ mode: 'upgrade', machineKey: 'cloud', projectKey: 'research' }))
  })

  it('supports 1-click inline Switch for This computer and single-project online machines with zero nested buttons', async () => {
    manager.status = { target: { machine: 'cloud', project: 'research' } }
    manager.startup = { target: { machine: 'local', project: 'default' }, error: null }
    manager.fleet = [
      {
        key: 'local',
        displayName: 'This computer',
        connection: 'local',
        cliVersion: '0.95.0',
        projects: [{ key: 'default', displayName: 'Default Desk', available: true, runtime: { class: 'running', webEndpoint: 'http://127.0.0.1:47331' } }],
      },
      {
        key: 'cloud',
        displayName: 'Cloud',
        sshTarget: 'cloud.example.com',
        connection: 'online',
        cliVersion: '0.94.1',
        defaultProject: 'research',
        projects: [{ key: 'research', displayName: 'Research', available: true, runtime: { class: 'running', webEndpoint: 'http://127.0.0.1:49001' } }],
      },
    ]

    const { container } = render(<MachineManagementSection />)

    expect(container.querySelectorAll('button button, button a, button select, [role="button"] button')).toHaveLength(0)
    expect(screen.getByText('Current')).toBeTruthy()
    expect(screen.getByText('Default')).toBeTruthy()

    const switchButton = screen.getByRole('button', { name: 'Switch' })
    fireEvent.click(switchButton)
    await waitFor(() => expect(manager.connect).toHaveBeenCalledWith('local', 'default'))

    // Expanding This computer shows its projects without remote SSH health controls
    fireEvent.click(screen.getByRole('button', { name: /This computer/ }))
    expect(screen.getByText('AliceProjects on this Machine')).toBeTruthy()
    expect(screen.getByText('Default Desk')).toBeTruthy()
    expect(screen.queryByText('Health & installation')).toBeNull()
  })

  it('shows Switching… on inline Switch while busy', () => {
    manager.status = { target: { machine: 'cloud', project: 'research' } }
    manager.busy = true
    manager.fleet = [
      {
        key: 'local',
        displayName: 'This computer',
        connection: 'local',
        projects: [{ key: 'default', displayName: 'Default Desk', available: true, runtime: { class: 'running', webEndpoint: 'http://127.0.0.1:47331' } }],
      },
      {
        key: 'cloud',
        displayName: 'Cloud',
        sshTarget: 'cloud.example.com',
        connection: 'online',
        projects: [{ key: 'research', displayName: 'Research', available: true, runtime: { class: 'running', webEndpoint: 'http://127.0.0.1:49001' } }],
      },
    ]

    render(<MachineManagementSection />)
    const switchingButton = screen.getByRole('button', { name: 'Switching…' })
    expect(switchingButton).toHaveProperty('disabled', true)
  })

  it('expands multi-project machines on Switch and connects to the chosen running project', async () => {
    manager.status = { target: { machine: 'local', project: 'default' } }
    manager.fleet = [
      {
        key: 'local',
        displayName: 'This computer',
        connection: 'local',
        projects: [{ key: 'default', displayName: 'Default Desk', available: true, runtime: { class: 'running', webEndpoint: 'http://127.0.0.1:47331' } }],
      },
      {
        key: 'studio',
        displayName: 'Studio Mac',
        sshTarget: 'alice@studio.local',
        connection: 'online',
        cliVersion: '0.95.0',
        projects: [
          { key: 'alpha', displayName: 'Alpha Desk', available: true, runtime: { class: 'running', webEndpoint: 'http://127.0.0.1:48001' } },
          { key: 'beta', displayName: 'Beta Desk', available: true, runtime: { class: 'running', webEndpoint: 'http://127.0.0.1:48002' } },
          { key: 'gamma', displayName: 'Gamma Desk', available: true, runtime: { class: 'absent', webEndpoint: null } },
        ],
      },
    ]

    const { container } = render(<MachineManagementSection />)

    fireEvent.click(screen.getByRole('button', { name: 'Switch' }))
    expect(manager.connect).not.toHaveBeenCalled()

    expect(screen.getByText('AliceProjects on this Machine')).toBeTruthy()
    const projectsPanel = screen.getByText('AliceProjects on this Machine').parentElement!
    expect(container.querySelectorAll('button button, button a, button select, [role="button"] button')).toHaveLength(0)

    const alphaRow = within(projectsPanel).getByText('Alpha Desk').closest('li')!
    expect(within(alphaRow).getByText('Running')).toBeTruthy()
    const betaRow = within(projectsPanel).getByText('Beta Desk').closest('li')!
    expect(within(betaRow).getByText('Running')).toBeTruthy()
    const gammaRow = within(projectsPanel).getByText('Gamma Desk').closest('li')!
    expect(within(gammaRow).getByText('Not running · start from CLI first')).toBeTruthy()
    expect(within(gammaRow).queryByRole('button', { name: 'Connect' })).toBeNull()

    fireEvent.click(within(betaRow).getByRole('button', { name: 'Connect' }))
    await waitFor(() => expect(manager.connect).toHaveBeenCalledWith('studio', 'beta'))
  })

  it('marks the active project as Connected without rendering a redundant Connect button', () => {
    manager.status = { target: { machine: 'studio', project: 'alpha' } }
    manager.fleet = [
      {
        key: 'studio',
        displayName: 'Studio Mac',
        sshTarget: 'alice@studio.local',
        connection: 'online',
        projects: [
          { key: 'alpha', displayName: 'Alpha Desk', available: true, runtime: { class: 'running', webEndpoint: 'http://127.0.0.1:48001' } },
          { key: 'beta', displayName: 'Beta Desk', available: true, runtime: { class: 'running', webEndpoint: 'http://127.0.0.1:48002' } },
        ],
      },
    ]

    render(<MachineManagementSection />)
    fireEvent.click(screen.getByRole('button', { name: /Studio Mac/ }))

    const projectsPanel = screen.getByText('AliceProjects on this Machine').parentElement!
    const alphaRow = within(projectsPanel).getByText('Alpha Desk').closest('li')!
    expect(within(alphaRow).getByText('Connected')).toBeTruthy()
    expect(within(alphaRow).queryByRole('button', { name: 'Connect' })).toBeNull()

    const betaRow = within(projectsPanel).getByText('Beta Desk').closest('li')!
    expect(within(betaRow).getByRole('button', { name: 'Connect' })).toBeTruthy()
  })
})
