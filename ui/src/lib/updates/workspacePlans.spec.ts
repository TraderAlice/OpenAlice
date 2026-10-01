import { beforeEach, expect, it, vi } from 'vitest'
import {
  getTemplateUpgradePlan, getHarnessSourceUpgradePlan, TemplateUpgradeApiError,
  type TemplateUpgradePlan, type Workspace,
} from '../../components/workspace/api'
import { WorkspacePlanStore, workspacePlanIsCurrent, workspacePlanKey, workspacePlanRequest } from './workspacePlans'

vi.mock('../../components/workspace/api', async importOriginal => ({
  ...await importOriginal<typeof import('../../components/workspace/api')>(),
  getTemplateUpgradePlan: vi.fn(), getHarnessSourceUpgradePlan: vi.fn(),
}))
const request = { workspaceId: 'chat', kind: 'template' as const }
const plan: TemplateUpgradePlan = {
  workspaceId: 'chat', template: 'chat', fromVersion: '1', toVersion: '2',
  strategy: 'managed-context', planDigest: 'one', source: 'recorded-baseline',
  blocked: false, blockers: [], activity: { busy: false, sessions: [], headless: [] },
  files: [], summary: { ready: 0, conflicts: 0, unchanged: 0, preserved: 0 },
}
const workspace: Workspace = { id: 'chat', tag: 'chat', dir: '/fixture/chat', createdAt: '', template: 'chat', sessions: [], currentVersion: '1', upgradeAvailable: { from: '1', to: '2' } }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(finish => { resolve = finish })
  return { promise, resolve }
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getTemplateUpgradePlan).mockResolvedValue(plan)
})

it('shares a pending automatic/manual read and reuses its exact plan when reopened', async () => {
  const pending = deferred<TemplateUpgradePlan>()
  vi.mocked(getTemplateUpgradePlan).mockReturnValueOnce(pending.promise)
  const store = new WorkspacePlanStore()
  const automatic = store.ensure(request)
  expect(store.refresh(request)).toBe(automatic)
  expect(store.ensure({ ...request, layer: 'template' })).toBe(automatic)
  await Promise.resolve()
  expect(getTemplateUpgradePlan).toHaveBeenCalledOnce()
  pending.resolve(plan)
  await automatic
  expect((await store.ensure(request))?.plan).toBe(plan)
  expect(store.peek(request)).toBe(plan)
  expect(getTemplateUpgradePlan).toHaveBeenCalledOnce()
  await store.refresh(request)
  expect(getTemplateUpgradePlan).toHaveBeenCalledTimes(2)
})

it('isolates Workspace, template, Alice Harness, skill and source scopes', async () => {
  const store = new WorkspacePlanStore()
  const requests = [request, { ...request, workspaceId: 'other' }, { ...request, layer: 'alice-harness' as const },
    { ...request, layer: 'alice-harness' as const, projection: { skill: 'alice', action: 'update' as const } },
    { ...request, layer: 'alice-harness' as const, projection: { skill: 'alice', action: 'remove' as const } }]
  vi.mocked(getTemplateUpgradePlan).mockImplementation(async id => ({ ...plan, workspaceId: id }))
  await Promise.all(requests.map(item => store.ensure(item)))
  expect(new Set(requests.map(workspacePlanKey)).size).toBe(5)
  expect(getTemplateUpgradePlan).toHaveBeenCalledTimes(5)
  expect(getTemplateUpgradePlan).toHaveBeenCalledWith('chat', 'alice-harness', { skill: 'alice', action: 'remove' })
  const source = { ...plan, strategy: 'source-merge' as const, fromCommit: 'a', toCommit: 'b', verified: true, protocolCompatible: true, manifestVersion: 1, changedPaths: [], conflictedPaths: [] }
  vi.mocked(getHarnessSourceUpgradePlan).mockResolvedValue(source)
  await store.ensure({ workspaceId: 'chat', kind: 'source' })
  expect(store.peek(request)).toMatchObject({ strategy: 'managed-context' })
  expect(store.peek({ workspaceId: 'chat', kind: 'source' })).toBe(source)
})

it('keeps the last successful plan and its error until an explicit or automatic refresh', async () => {
  const store = new WorkspacePlanStore()
  await store.ensure(request)
  vi.mocked(getTemplateUpgradePlan).mockRejectedValueOnce(new Error('offline'))
  expect(await store.refresh(request)).toBeNull()
  await store.ensure(request)
  expect(store.resource(request).getSnapshot()).toMatchObject({ value: { plan }, error: 'offline', checking: false })
  expect(getTemplateUpgradePlan).toHaveBeenCalledTimes(2)
  await store.refresh(request)
  expect(store.resource(request).getSnapshot().error).toBeNull()
})

it('uses a backend conflict plan and fences an older preview completion', async () => {
  const store = new WorkspacePlanStore()
  const pending = deferred<TemplateUpgradePlan>()
  vi.mocked(getTemplateUpgradePlan).mockReturnValueOnce(pending.promise)
  const old = store.ensure(request)
  await Promise.resolve()
  const replacement = { ...plan, planDigest: 'new', blocked: true, blockers: ['active_sessions'] }
  await store.replace(request, replacement)
  pending.resolve(plan)
  expect(await old).toBeNull()
  expect(store.peek(request)).toBe(replacement)
  expect(getTemplateUpgradePlan).toHaveBeenCalledOnce()
})

it('retires all late responses when the backend generation changes', async () => {
  const oldStore = new WorkspacePlanStore(), newStore = new WorkspacePlanStore()
  const pending = deferred<TemplateUpgradePlan>()
  vi.mocked(getTemplateUpgradePlan).mockReturnValueOnce(pending.promise)
  const old = oldStore.ensure(request)
  await Promise.resolve()
  oldStore.retire()
  await newStore.ensure(request)
  pending.resolve({ ...plan, planDigest: 'previous-backend' })
  await old
  expect(oldStore.peek(request)).toBeNull()
  expect(newStore.peek(request)?.planDigest).toBe('one')
  await oldStore.refresh(request)
  expect(getTemplateUpgradePlan).toHaveBeenCalledTimes(2)
})

it('invalidates content changes and removal without changing another Workspace', async () => {
  const store = new WorkspacePlanStore()
  store.reconcile([workspace, { ...workspace, id: 'other' }], true)
  await store.ensure(request)
  await store.replace({ ...request, workspaceId: 'other' }, { ...plan, workspaceId: 'other' })
  store.reconcile([{ ...workspace, currentVersion: '2', upgradeAvailable: null }, { ...workspace, id: 'other' }], true)
  expect(store.peek(request)).toBeNull()
  expect(store.peek({ ...request, workspaceId: 'other' })).not.toBeNull()
  await store.ensure(request)
  store.reconcile([{ ...workspace, id: 'other' }], true)
  expect(store.peek(request)).toBeNull()
  store.invalidateReviews()
  await Promise.resolve()
  expect(getTemplateUpgradePlan).toHaveBeenCalledTimes(2) // invalidation does not discover or plan
})

it('invalidates a changed discovery target without generating a plan', async () => {
  const store = new WorkspacePlanStore()
  store.observe([{ workspaceId: 'chat', phase: 'available', fromVersion: '1', toVersion: '2' }])
  await store.ensure({ ...request, targetVersion: '2' })
  store.observe([{ workspaceId: 'chat', phase: 'current', fromVersion: '2' }])
  expect(store.peek({ ...request, targetVersion: '2' })).toBeNull()
  expect(getTemplateUpgradePlan).toHaveBeenCalledOnce()
  await store.ensure({ ...request, targetVersion: '3' })
  expect(store.resource({ ...request, targetVersion: '3' }).getSnapshot().error).toContain('target changed')
})

it('rejects a mismatched Workspace response and retains unsupported API evidence', async () => {
  const store = new WorkspacePlanStore()
  vi.mocked(getTemplateUpgradePlan).mockResolvedValueOnce({ ...plan, workspaceId: 'foreign' })
  await store.ensure(request)
  expect(store.peek(request)).toBeNull()
  expect(store.resource(request).getSnapshot().error).toContain('does not match')
  vi.mocked(getTemplateUpgradePlan).mockRejectedValueOnce(new TemplateUpgradeApiError('unsupported', 'not supported', 400))
  await store.refresh(request)
  expect(store.resource(request).getSnapshot().value).toMatchObject({ plan: null, unsupported: true, error: 'not supported' })
})

it('keeps source commit identity even when version labels are equal', () => {
  const source = { ...plan, fromVersion: 'snapshot', toVersion: 'snapshot', strategy: 'source-merge' as const,
    fromCommit: 'a', toCommit: 'b', verified: true, protocolCompatible: true, manifestVersion: 1, changedPaths: [], conflictedPaths: [] }
  expect(workspacePlanIsCurrent(source)).toBe(false)
  expect(workspacePlanIsCurrent({ ...source, toCommit: 'a' })).toBe(true)
  expect(workspacePlanRequest({ ...workspace, template: 'auto-quant-v2', upgradeAvailable: null }).kind).toBe('source')
})
