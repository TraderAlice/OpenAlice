// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MachineUpgradeDialog } from './MachineUpgradeDialog'
import type { MachinePlan, MachineOperation } from '../../lib/updates/machine-types'
const plan: MachinePlan = { id: 'p1', mode: 'upgrade', machine: { key: 'cloud', label: 'Cloud', sshTarget: 'example.test' }, project: null, platform: 'linux', activeVersion: '1.0.0', installedVersion: '1.0.0', targetVersion: '1.1.0', runtime: 'running', actions: ['Restart backend'], blocker: null, deferredUpdate: false, expiresAt: '2099-01-01' }
const operation: MachineOperation = { id: 'o1', planId: 'p1', mode: 'upgrade', phase: 'running', stage: 'restarting', startedAt: '2026-09-29', error: null }
afterEach(cleanup)
it('shows probe loading without exposing an approval button', () => {
  render(<MachineUpgradeDialog open plan={null} operation={null} busy={false} error={null} onClose={vi.fn()} onApply={vi.fn()} onRetry={vi.fn()}/> )
  expect(screen.getByRole('status').textContent).toContain('Preparing')
  expect(screen.queryByRole('button', { name: 'Approve update' })).toBeNull()
})
it('only applies after approval and renders expected restart instead of a fake percentage', () => {
  const apply = vi.fn()
  const { rerender } = render(<MachineUpgradeDialog open plan={plan} operation={null} busy={false} error={null} onClose={vi.fn()} onApply={apply} onRetry={vi.fn()}/> )
  expect(apply).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Approve update' }))
  expect(apply).toHaveBeenCalledOnce()
  rerender(<MachineUpgradeDialog open plan={plan} operation={operation} busy error={null} onClose={vi.fn()} onApply={apply} onRetry={vi.fn()}/> )
  expect(screen.getByText(/brief disconnect is expected/)).toBeTruthy()
  expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
})
it('offers review rather than blind application when probing failed', () => {
  const retry = vi.fn(), apply = vi.fn()
  render(<MachineUpgradeDialog open plan={null} operation={null} busy={false} error="SSH unavailable" onClose={vi.fn()} onApply={apply} onRetry={retry}/> )
  fireEvent.click(screen.getByRole('button', { name: 'Review again' }))
  expect(retry).toHaveBeenCalledOnce()
  expect(apply).not.toHaveBeenCalled()
})
it('shows retained preview evidence while preventing approval during refresh or failure', () => {
  const props = { open: true, plan, operation: null, busy: false, onClose: vi.fn(), onApply: vi.fn(), onRetry: vi.fn() }
  const { rerender } = render(<MachineUpgradeDialog {...props} checking error={null}/>)
  expect(screen.getByText('Planned changes')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Approve update' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.queryByRole('progressbar')).toBeNull()
  rerender(<MachineUpgradeDialog {...props} error="probe offline"/>)
  expect((screen.getByRole('button', { name: 'Approve update' }) as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByRole('alert').textContent).toBe('probe offline')
})
