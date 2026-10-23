// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ updates: {} as any, openAgentConfig: vi.fn(), install: vi.fn(async () => {}), probe: vi.fn(async () => {}), generation: 0, setup: null as any }))
vi.mock('../../hooks/useUpdateLifecycle', () => ({ useUpdateLifecycle: () => mocks.updates }))
vi.mock('../../hooks/useProjectWorkspaceSetup', async importOriginal => ({ ...await importOriginal<any>(), useSharedProjectWorkspaceSetup: () => mocks.setup }))
vi.mock('../../hooks/useAliceProject', () => ({ useAliceProject: () => ({ project: { displayName: 'Main Cloud' } }) }))
vi.mock('../../contexts/workspaces-context', () => ({ useWorkspaces: () => ({ openAgentConfig: mocks.openAgentConfig, refresh: vi.fn(async () => {}) }) }))
vi.mock('../../auth/backendConnection', () => ({ getBackendConnection: () => ({ kind: 'local' }) }))
vi.mock('../../auth/AuthContext', () => ({ useBackendRecoverySignal: () => ({ backendUnavailable: false, backendRecoveryGeneration: mocks.generation }) }))
import '../../i18n'
import { i18n } from '../../i18n'
import { WorkspacePlanStore } from '../../lib/updates/workspacePlans'
import { VersionOverviewSection } from './VersionOverviewSection'
beforeAll(async () => { await i18n.changeLanguage('en') })
beforeEach(async () => {
  mocks.generation = 0; mocks.setup = null
  const workspacePlans = new WorkspacePlanStore()
  await workspacePlans.replace({ kind: 'template', workspaceId: 'chat', targetVersion: '2' }, { workspaceId: 'chat', template: 'chat', strategy: 'managed-context', update: { status: 'available', reason: 'newer-release' }, fromVersion: '1', toVersion: '2', planDigest: 'exact', blocked: false, blockers: [], files: [], summary: { ready: 1, conflicts: 0, unchanged: 0, preserved: 0 } } as any)
  mocks.updates = {
    machines: { status: { target: { machine: 'cloud', machineName: 'Railway Linux', project: 'main-cloud' } }, plan: null, operation: null, probe: mocks.probe, applying: false },
    client: { kind: 'cli', currentVersion: '0.94.1', discovery: { value: { status: 'current', channel: 'stable' } } },
    versionInfo: { current: '0.93.1', latest: '0.94.1', hasUpdate: true, channel: 'stable', updateAuthority: 'cli' },
    workspacePlans, workspaceStates: [{ workspaceId: 'chat', template: 'chat', phase: 'available', fromVersion: '1', toVersion: '2' }],
    projectWorkspaces: [{ kind: 'chat', label: 'Chat', loaded: true, workspace: { id: 'chat', tag: 'my-chat', template: 'chat', currentVersion: '1' } }, { kind: 'auto-quant', label: 'Quant', loaded: true, workspace: null }, { kind: 'auto-prediction', label: 'Prediction', loaded: true, workspace: null }],
    installClient: mocks.install, refresh: vi.fn(async () => {}), openClientRelease: vi.fn(async () => {}),
    review: vi.fn(async () => ({ id: 'project-review', proposals: [{ unit: { id: 'template:chat', desired: { version: '2' } }, fingerprint: 'exact' }], steps: [], blockers: [], fingerprint: 'exact' })),
    approve: vi.fn(async () => {}), resume: vi.fn(async () => {}), abandon: vi.fn(async () => {}),
  }
})
afterEach(() => { cleanup(); vi.clearAllMocks(); Reflect.deleteProperty(window, 'openAlice') })
it('shows three parent objects with optional read-only default content, without selection or a chooser', () => {
  render(<VersionOverviewSection />)
  expect(screen.getAllByRole('heading', { level: 3 }).map(node => node.textContent)).toEqual(['App', 'Backend', 'Alice Project'])
  expect(screen.queryByText('my-chat')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Project details' }))
  expect(screen.getByText('my-chat')).toBeTruthy()
  expect(screen.getByText('Quant')).toBeTruthy()
  expect(screen.getByText('Prediction')).toBeTruthy()
  expect(screen.queryByRole('checkbox')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Review updates' })).toBeNull()
  expect(mocks.updates.review).not.toHaveBeenCalled()
})
it('prepares the project directly, then requires one explicit update action', async () => {
  render(<VersionOverviewSection />)
  fireEvent.click(within(document.getElementById('settings-version-project')!).getByRole('button', { name: 'View update' }))
  await waitFor(() => expect(mocks.updates.review).toHaveBeenCalledWith({ client: false, backend: false, projectUnits: ['template:chat'] }))
  const apply = await screen.findByRole('button', { name: 'Update Alice Project' })
  await waitFor(() => expect(apply.hasAttribute('disabled')).toBe(false))
  expect(mocks.updates.approve).not.toHaveBeenCalled()
  fireEvent.click(apply)
  await waitFor(() => expect(mocks.updates.approve).toHaveBeenCalledOnce())
  expect(mocks.openAgentConfig).not.toHaveBeenCalled()
})
it('keeps a stale review response from approving a changed default', async () => {
  let finish!: (value: unknown) => void
  mocks.updates.review.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const { rerender } = render(<VersionOverviewSection />)
  fireEvent.click(within(document.getElementById('settings-version-project')!).getByRole('button', { name: 'View update' }))
  mocks.updates.projectWorkspaces[0] = { ...mocks.updates.projectWorkspaces[0], workspace: null }
  rerender(<VersionOverviewSection />)
  finish({ blockers: [], fingerprint: 'stale' })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Update Alice Project' }).hasAttribute('disabled')).toBe(true))
  expect(mocks.updates.approve).not.toHaveBeenCalled()
})
it('opens native confirmation directly, without a second review step', async () => {
  mocks.updates.nativeReady = { phase: 'downloaded', version: '0.94.2' }
  render(<VersionOverviewSection />)
  fireEvent.click(within(document.getElementById('settings-version-app')!).getByRole('button', { name: 'View update' }))
  expect(mocks.install).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Restart and update' }))
  await waitFor(() => expect(mocks.install).toHaveBeenCalledOnce())
})
it('does not label failed checks as current', () => {
  mocks.updates.clientError = 'feed offline'; mocks.updates.versionError = 'probe offline'
  render(<VersionOverviewSection />)
  expect(screen.getAllByText('Update check failed')).toHaveLength(2)
})
it('retains setup recovery inside project details without inventing a default', () => {
  mocks.setup = { setup: { phase: 'complete', pending: ['auto-quant'], errors: { 'auto-quant': 'Clone unavailable' } }, busy: false, retry: vi.fn() }
  render(<VersionOverviewSection />)
  expect(within(document.getElementById('settings-version-project')!).getByText('Needs attention')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Project details' }))
  expect(screen.getByText('Clone unavailable')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(mocks.setup.retry).toHaveBeenCalledOnce()
})
it('keeps recovery reachable even when no new update is available', () => {
  mocks.updates.projectWorkspaces = []
  mocks.updates.operation = { id: 'pending', phase: 'blocked', error: 'Reconnect the approved target', completed: {}, plan: { steps: [] } }
  render(<VersionOverviewSection />)
  fireEvent.click(screen.getByRole('button', { name: 'View progress' }))
  expect(screen.getByRole('dialog').textContent).toContain('Reconnect the approved target')
  expect(mocks.updates.resume).not.toHaveBeenCalled()
})

it('renders successful current discovery even if an old plan cache contains a failure', async () => {
  mocks.updates.workspaceStates = [{ workspaceId: 'chat', template: 'chat', phase: 'current', fromVersion: '2' }]
  await mocks.updates.workspacePlans.resource({ kind: 'template', workspaceId: 'chat' }).check(async () => { throw new Error('old preview failure') })
  render(<VersionOverviewSection />)
  const project = within(document.getElementById('settings-version-project')!)
  expect(project.getByText('Up to date')).toBeTruthy()
  expect(project.queryByText('Needs attention')).toBeNull()
  expect(project.queryByRole('button', { name: 'View update' })).toBeNull()
})
it.each(['check', 'review', 'apply'])('shows %s failures without misclassifying their stage', stage => {
  mocks.updates.workspaceStates = [{ workspaceId: 'chat', template: 'chat', phase: 'failed', failureStage: stage, reason: 'operation failed' }]
  render(<VersionOverviewSection />)
  fireEvent.click(screen.getByRole('button', { name: 'Project details' }))
  const project = within(document.getElementById('settings-version-project')!)
  expect(Boolean(project.queryByText('Update check failed'))).toBe(stage === 'check')
  expect(project.getByText('operation failed')).toBeTruthy()
})

it('retains a blocked release decision and explains it without an update action', () => {
  mocks.updates.client.discovery.value = { status: 'blocked', reason: 'older-release', latestVersion: '0.94.0', channel: 'stable' }
  render(<VersionOverviewSection />)
  const app = within(document.getElementById('settings-version-app')!)
  expect(app.getByText('Needs attention')).toBeTruthy()
  expect(app.queryByRole('button', { name: 'View update' })).toBeNull()
  fireEvent.click(app.getByRole('button', { name: 'App: Details' }))
  expect(screen.getByText('The available release is older than the running version. An ordinary update cannot downgrade it.')).toBeTruthy()
})

it('does not offer installation from a retained candidate after discovery fails', () => {
  mocks.updates.client.discovery.value = { status: 'available', latestVersion: '0.95.0', channel: 'stable' }
  mocks.updates.clientError = 'feed offline'
  render(<VersionOverviewSection />)
  const app = within(document.getElementById('settings-version-app')!)
  expect(app.getByText('Update check failed')).toBeTruthy()
  expect(app.queryByRole('button', { name: 'View update' })).toBeNull()
})
