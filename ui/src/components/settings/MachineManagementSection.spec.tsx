// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MachineManagementSection } from './MachineManagementSection'

const manager = vi.hoisted(() => ({
  refresh: vi.fn(), clearPlan: vi.fn(), probe: vi.fn(async () => undefined),
  status: { target: { machine: 'cloud', project: 'research' } },
  loading: false, probing: false, applying: false, plan: null, operation: null,
  fleet: [{ key: 'cloud', displayName: 'Cloud', sshTarget: 'fixture.test',
    connection: 'online', cliVersion: '0.94.1', defaultProject: 'research',
    projects: [{ key: 'research', displayName: 'Research', available: true, runtime: { class: 'absent' } }],
  }],
}))
vi.mock('../../hooks/useUpdateLifecycle', () => ({ useUpdateLifecycle: () => ({ machines: manager }) }))
vi.mock('./MachineUpgradeDialog', () => ({ MachineUpgradeDialog: () => null }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('keeps a stopped project selectable for reviewed activation recovery', async () => {
  render(<MachineManagementSection />)
  fireEvent.click(screen.getByRole('button', { name: /Cloud/ }))
  expect(screen.getByRole('combobox', { name: 'AliceProject' }).textContent).toBe('Research')
  fireEvent.click(screen.getByRole('button', { name: 'Probe and review' }))
  await waitFor(() => expect(manager.probe).toHaveBeenCalledWith({ mode: 'upgrade', machineKey: 'cloud', projectKey: 'research' }))
})
