// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import '../../i18n'
import { SessionControlPanel } from './SessionControlPanel'
it('saves the configured cooldown through the shared control hook', () => {
  const configure = vi.fn(async () => {})
  render(<SessionControlPanel control={{ data: { execution: null, blocks: [], cooldownSeconds: 600, serverNow: Date.now() }, error: null, busy: false, configure, interrupt: vi.fn(), release: vi.fn() }} />)
  fireEvent.click(screen.getByText('Interruption cooldown'))
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Seconds' }), { target: { value: '120' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(configure).toHaveBeenCalledWith(120)
})

it('confirms an interruption before sending the execution ID', async () => {
  const interrupt = vi.fn(async () => {})
  render(<SessionControlPanel sessionName="Scan Open" control={{
    data: { execution: { executionId: 'run-7', phase: 'running', surface: 'headless', requestedAt: 1,
      origin: { kind: 'user', entry: 'issue-scan-open' }, configuration: { credentialSource: 'native' } },
      blocks: [], cooldownSeconds: 600, serverNow: Date.now() },
    error: null, busy: false, configure: vi.fn(), interrupt, release: vi.fn(),
  }} />)
  fireEvent.click(screen.getByRole('button', { name: 'Interrupt run' }))
  const confirmation = screen.getByRole('group', { name: 'Interrupt Scan Open?' })
  expect(within(confirmation).getByText(/blocks new starts for 10 minutes/)).toBeTruthy()
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(interrupt).not.toHaveBeenCalled()
  fireEvent.click(within(confirmation).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Interrupt Scan Open?' })).toBeNull())
  expect(interrupt).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Interrupt run' }))
  fireEvent.keyDown(within(screen.getByRole('group', { name: 'Interrupt Scan Open?' })).getByRole('button', { name: 'Cancel' }), { key: 'Escape' })
  expect(screen.queryByRole('group', { name: 'Interrupt Scan Open?' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Interrupt run' }))
  fireEvent.click(within(screen.getByRole('group', { name: 'Interrupt Scan Open?' })).getByRole('button', { name: 'Confirm interruption' }))
  await waitFor(() => expect(interrupt).toHaveBeenCalledExactlyOnceWith('run-7'))
})
