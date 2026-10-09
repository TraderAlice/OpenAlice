// @vitest-environment jsdom
import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { en } from '../../i18n/locales/en'
import { AddMachineDialog } from './AddMachineDialog'
import { useMachineControls } from '../../hooks/useMachineControls'
import type { MachinePlan } from '../../lib/updates/machine-types'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key.split('.').reduce((value: any, part) => value?.[part], en) ?? key }) }))

const relay = vi.hoisted(() => ({ refresh: vi.fn(async () => undefined) }))
vi.mock('../../hooks/useRelayConnection', () => ({ useRelayConnection: () => ({ ...relay, fleet: [], status: null, loading: false }) }))
const plan: MachinePlan = {
  id: 'new-plan', mode: 'add', machine: { key: null, label: 'Cloud', sshTarget: 'alice@example.com' },
  project: null, platform: 'Linux x64', activeVersion: '0.94.1', installedVersion: '0.94.1', targetVersion: '0.94.1', runtime: 'running',
  actions: [], blocker: null, deferredUpdate: false, expiresAt: '2099-01-01T00:00:00Z',
}
function Harness() {
  const manager = useMachineControls()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  return <><button ref={button} onClick={() => setOpen(true)}>Add Machine</button>{saved && <p>Saved</p>}
    {open && <AddMachineDialog manager={manager} onClose={() => setOpen(false)} onAdded={() => { setSaved(true); setOpen(false) }} restoreFocusRef={button} />}</>
}
function fill() {
  fireEvent.change(screen.getByLabelText('SSH target'), { target: { value: ' alice@example.com ' } })
  fireEvent.change(screen.getByLabelText('Machine label'), { target: { value: ' Cloud ' } })
}
function mutationCalls(path: string) { return vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith(path)) }
beforeEach(() => {
  relay.refresh.mockClear()
  Object.defineProperty(window, 'openAlice', { value: undefined, configurable: true })
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    if (String(url).endsWith('/operation')) return Response.json(null)
    if (String(url).endsWith('/plan')) return Response.json(plan)
    return Response.json({ machineKey: 'cloud' })
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Add Machine reviewed dialog', () => {
  it('validates required fields and port, uses blank SSH defaults, and only saves after approval', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByText('Add Machine'))
    fireEvent.click(screen.getByText('Probe Machine'))
    expect(screen.getByText('Enter an SSH target.')).toBeTruthy()
    expect(mutationCalls('/plan')).toHaveLength(0)
    fill()
    const port = screen.getByLabelText('SSH port (optional)')
    fireEvent.change(port, { target: { value: '65536' } })
    expect(screen.getByText('Enter a port from 1 to 65535.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Probe Machine' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(port, { target: { value: '' } })
    fireEvent.click(screen.getByText('Probe Machine'))
    await screen.findByText('No remote changes')
    expect(mutationCalls('/plan')).toHaveLength(1)
    expect(JSON.parse(mutationCalls('/plan')[0][1]!.body as string)).toEqual({ mode: 'add', sshTarget: 'alice@example.com', label: 'Cloud' })
    expect(mutationCalls('/apply')).toHaveLength(0)
    expect(screen.getByText('Adding this Machine does not switch your current connection.')).toBeTruthy()
    fireEvent.click(screen.getByText('Approve and add Machine'))
    await screen.findByText('Saved')
    expect(mutationCalls('/apply')).toHaveLength(1)
    expect(relay.refresh).toHaveBeenCalledOnce()
    expect(mutationCalls('/connect')).toHaveLength(0)
  })

  it('returns to editable inputs with Back and blocks approval of a blocked plan', async () => {
    vi.mocked(fetch).mockImplementation(async url => Response.json(String(url).endsWith('/plan') ? { ...plan, blocker: 'Remote platform is unsupported' } : null))
    render(<Harness />)
    fireEvent.click(screen.getByText('Add Machine')); fill()
    fireEvent.click(screen.getByText('Probe Machine'))
    await screen.findByText('Remote platform is unsupported')
    expect(screen.queryByText('Approve and add Machine')).toBeNull()
    fireEvent.click(screen.getByText('Back'))
    expect((screen.getByLabelText('SSH target') as HTMLInputElement).value).toBe(' alice@example.com ')
    expect(screen.queryByText('Review Machine plan')).toBeNull()
    expect(mutationCalls('/apply')).toHaveLength(0)
  })

  it('discards a closed probe and opens a fresh draft even when the old response arrives late', async () => {
    let finish!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(async url => String(url).endsWith('/plan') ? new Promise(resolve => { finish = resolve }) : Response.json(null))
    render(<Harness />)
    fireEvent.click(screen.getByText('Add Machine')); fill()
    fireEvent.click(screen.getByText('Probe Machine'))
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    fireEvent.click(screen.getByText('Cancel'))
    fireEvent.click(screen.getByText('Add Machine'))
    expect((screen.getByLabelText('SSH target') as HTMLInputElement).value).toBe('')
    await act(async () => { finish(Response.json(plan)) })
    expect(screen.queryByText('Review Machine plan')).toBeNull()
    expect(mutationCalls('/apply')).toHaveLength(0)
  })

  it('keeps probe errors inside the dialog and retains entered values for retry', async () => {
    let failed = false
    vi.mocked(fetch).mockImplementation(async url => {
      if (!String(url).endsWith('/plan')) return Response.json(null)
      if (!failed) { failed = true; return Response.json({ error: 'SSH unavailable' }, { status: 502 }) }
      return Response.json(plan)
    })
    render(<Harness />)
    fireEvent.click(screen.getByText('Add Machine')); fill()
    fireEvent.click(screen.getByText('Probe Machine'))
    expect(await within(screen.getByRole('dialog')).findByText('SSH unavailable')).toBeTruthy()
    expect((screen.getByLabelText('Machine label') as HTMLInputElement).value).toBe(' Cloud ')
    fireEvent.click(screen.getByText('Retry probe'))
    await screen.findByText('Review Machine plan')
    expect(mutationCalls('/plan')).toHaveLength(2)
  })

  it('requires another probe and approval after failure and never offers cancellation while applying', async () => {
    let finish!: (response: Response) => void
    vi.mocked(fetch).mockImplementation(async url => {
      if (String(url).endsWith('/operation')) return Response.json(null)
      if (String(url).endsWith('/plan')) return Response.json(plan)
      return new Promise(resolve => { finish = resolve })
    })
    render(<Harness />)
    fireEvent.click(screen.getByText('Add Machine')); fill()
    fireEvent.click(screen.getByText('Probe Machine'))
    fireEvent.click(await screen.findByText('Approve and add Machine'))
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => { finish(Response.json({ error: 'Verification failed' }, { status: 502 })) })
    await screen.findByText('Could not add Machine')
    fireEvent.click(screen.getByText('Review again'))
    await screen.findByText('Approve and add Machine')
    expect(mutationCalls('/apply')).toHaveLength(1)
    expect(mutationCalls('/plan')).toHaveLength(2)
  })
})

it('restores only the active add operation and requires re-entry when restored execution fails without a draft', async () => {
  const close = vi.fn()
  const manager = {
    ...relay, clearPlan: vi.fn(), probe: vi.fn(), apply: vi.fn(), probing: false, applying: false, plan: null,
    operation: { id: 'running-add', planId: 'approved-before-navigation', mode: 'add', phase: 'running', stage: 'verifying', startedAt: '', error: null },
  } as unknown as Parameters<typeof AddMachineDialog>[0]['manager']
  const ref = { current: null }
  const view = render(<AddMachineDialog manager={manager} onClose={close} onAdded={vi.fn()} restoreFocusRef={ref} />)
  expect(screen.getByRole('heading', { name: 'Adding Machine' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
  expect(close).not.toHaveBeenCalled()
  view.rerender(<AddMachineDialog manager={{ ...manager, operation: { ...manager.operation!, phase: 'failed', error: 'Remote verification failed' } }} onClose={close} onAdded={vi.fn()} restoreFocusRef={ref} />)
  await screen.findByRole('heading', { name: 'Could not add Machine' })
  fireEvent.click(screen.getByText('Review again'))
  expect((screen.getByLabelText('SSH target') as HTMLInputElement).value).toBe('')
  expect(manager.apply).not.toHaveBeenCalled()
})

it.each([false, true])('refreshes a restored add before announcing success (late discovery: %s)', async lateDiscovery => {
  const onAdded = vi.fn()
  let finishRefresh!: () => void
  const refresh = vi.fn(() => new Promise<void>(resolve => { finishRefresh = resolve }))
  const running = { id: 'restore-add', planId: 'restore-plan', mode: 'add' as const, phase: 'running' as const, stage: 'verifying' as const, startedAt: '', error: null }
  const manager = {
    refresh, clearPlan: vi.fn(), probe: vi.fn(), apply: vi.fn(), probing: false, applying: false, plan: null,
    operation: lateDiscovery ? null : running,
  } as unknown as Parameters<typeof AddMachineDialog>[0]['manager']
  const ref = { current: null }
  const view = render(<AddMachineDialog manager={manager} onClose={vi.fn()} onAdded={onAdded} restoreFocusRef={ref} />)
  if (lateDiscovery) {
    expect(screen.getByRole('heading', { name: 'Add a Machine' })).toBeTruthy()
    view.rerender(<AddMachineDialog manager={{ ...manager, operation: running }} onClose={vi.fn()} onAdded={onAdded} restoreFocusRef={ref} />)
  }
  expect(await screen.findByRole('heading', { name: 'Adding Machine' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull()
  const succeeded = { ...running, phase: 'succeeded' as const }
  view.rerender(<AddMachineDialog manager={{ ...manager, operation: succeeded }} onClose={vi.fn()} onAdded={onAdded} restoreFocusRef={ref} />)
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce())
  expect(onAdded).not.toHaveBeenCalled()
  view.rerender(<AddMachineDialog manager={{ ...manager, operation: { ...succeeded } }} onClose={vi.fn()} onAdded={onAdded} restoreFocusRef={ref} />)
  await act(async () => finishRefresh())
  expect(onAdded).toHaveBeenCalledOnce()
  expect(refresh).toHaveBeenCalledOnce()
  expect(manager.apply).not.toHaveBeenCalled()
})

it('does not duplicate the refresh owned by a surviving apply flight', async () => {
  const onAdded = vi.fn()
  const refresh = vi.fn(async () => undefined)
  const running = { id: 'same-renderer', planId: 'approved-plan', mode: 'add' as const, phase: 'running' as const, stage: 'verifying' as const, startedAt: '', error: null }
  const manager = { refresh, clearPlan: vi.fn(), applying: true, operation: running } as unknown as Parameters<typeof AddMachineDialog>[0]['manager']
  const ref = { current: null }
  const view = render(<AddMachineDialog manager={manager} onClose={vi.fn()} onAdded={onAdded} restoreFocusRef={ref} />)
  view.rerender(<AddMachineDialog manager={{ ...manager, applying: false, operation: { ...running, phase: 'succeeded' } }} onClose={vi.fn()} onAdded={onAdded} restoreFocusRef={ref} />)
  await waitFor(() => expect(onAdded).toHaveBeenCalledOnce())
  expect(refresh).not.toHaveBeenCalled()
})

it.each([
  { mode: 'upgrade', phase: 'running' },
  { mode: 'add', phase: 'succeeded' },
] as const)('does not adopt an unrelated $mode/$phase response into the form', async state => {
  const onAdded = vi.fn()
  const refresh = vi.fn(async () => undefined)
  const manager = { refresh, clearPlan: vi.fn(), applying: false, operation: null } as unknown as Parameters<typeof AddMachineDialog>[0]['manager']
  const ref = { current: null }
  const view = render(<AddMachineDialog manager={manager} onClose={vi.fn()} onAdded={onAdded} restoreFocusRef={ref} />)
  view.rerender(<AddMachineDialog manager={{ ...manager, operation: { id: 'unrelated', planId: 'unrelated-plan', ...state, stage: 'verifying', startedAt: '', error: null } }} onClose={vi.fn()} onAdded={onAdded} restoreFocusRef={ref} />)
  expect(screen.getByRole('heading', { name: 'Add a Machine' })).toBeTruthy()
  expect(refresh).not.toHaveBeenCalled()
  expect(onAdded).not.toHaveBeenCalled()
})
