// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fetchJson } from '../api/client'
import { ProjectWorkspaceSetupProvider, projectSetupFailures, useProjectWorkspaceSetup } from './useProjectWorkspaceSetup'
const mocks = vi.hoisted(() => ({ refresh: vi.fn(async () => {}), generation: 0 }))
vi.mock('../api/client', () => ({ fetchJson: vi.fn() }))
vi.mock('../contexts/workspaces-context', () => ({ useWorkspaces: () => ({ refresh: mocks.refresh, refreshAutoQuantPreference: mocks.refresh, refreshAutoPredictionPreference: mocks.refresh }) }))
vi.mock('../auth/AuthContext', () => ({ useBackendRecoverySignal: () => ({ backendUnavailable: false, backendRecoveryGeneration: mocks.generation }) }))
beforeEach(() => { vi.mocked(fetchJson).mockReset(); mocks.refresh.mockClear(); mocks.generation = 0 })
afterEach(cleanup)
function Probe({ name }: { name: string }) {
  const state = useProjectWorkspaceSetup()
  return <button onClick={() => void state.retry()} disabled={state.busy}>{name}: {state.error ?? state.setup?.phase ?? 'loading'}</button>
}
it('shares preparation reads and retries across entry points and refreshes inventory on recovery', async () => {
  vi.mocked(fetchJson).mockResolvedValueOnce({ phase: 'complete', pending: ['chat'], errors: { chat: 'offline' } })
    .mockResolvedValueOnce({ phase: 'complete', pending: [] })
  render(<ProjectWorkspaceSetupProvider><Probe name="settings" /><Probe name="harness" /></ProjectWorkspaceSetupProvider>)
  await screen.findByText('settings: complete')
  expect(fetchJson).toHaveBeenCalledOnce()
  const initialRefreshes = mocks.refresh.mock.calls.length
  act(() => { screen.getByText('settings: complete').click(); screen.getByText('harness: complete').click() })
  await waitFor(() => expect(fetchJson).toHaveBeenCalledTimes(2))
  await waitFor(() => expect(mocks.refresh.mock.calls.length).toBe(initialRefreshes + 3))
})
it('retires old backend requests and starts fresh on recovery', async () => {
  let finishOld!: (value: unknown) => void
  vi.mocked(fetchJson).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    .mockResolvedValueOnce({ phase: 'complete', pending: [] })
  const { rerender } = render(<ProjectWorkspaceSetupProvider><Probe name="settings" /></ProjectWorkspaceSetupProvider>)
  await waitFor(() => expect(fetchJson).toHaveBeenCalledOnce())
  mocks.generation++
  rerender(<ProjectWorkspaceSetupProvider><Probe name="settings" /></ProjectWorkspaceSetupProvider>)
  await screen.findByText('settings: complete')
  await act(async () => { finishOld({ phase: 'preparing', pending: ['chat'] }) })
  expect(screen.getByText('settings: complete')).toBeTruthy()
})
it('selects only real preparation failures, including an unavailable status without a Workspace ID', () => {
  expect(projectSetupFailures(null, null)).toEqual([])
  expect(projectSetupFailures({ phase: 'preparing', pending: ['chat'], errors: { chat: 'previous failure' } }, null)).toEqual([])
  expect(projectSetupFailures({ phase: 'complete', pending: ['chat'] }, null)).toEqual([])
  expect(projectSetupFailures({ phase: 'complete', pending: [], errors: { chat: 'stale' } }, null)).toEqual([])
  expect(projectSetupFailures({ phase: 'complete', pending: ['chat'], errors: { chat: 'clone failed' } }, null)).toEqual([{ kind: 'chat', reason: 'clone failed' }])
  expect(projectSetupFailures(null, 'offline')).toEqual([{ kind: 'status', reason: 'offline' }])
})
