import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it, vi } from 'vitest'
import { prepareProjectWorkspaces, readProjectWorkspaceSetup } from './project-workspace-setup.js'
import type { WorkspaceService } from './service.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(home => rm(home, { recursive: true, force: true }))) })
async function home(pending?: string[]) {
  const dir = await mkdtemp(join(tmpdir(), 'project-setup-')); roots.push(dir)
  if (pending) await writeFile(join(dir, 'workspace-setup.json'), JSON.stringify({ schemaVersion: 1, pending }))
  return dir
}
function service() {
  const registry = new Map<string, { template: string }>()
  return {
    registry: { get: (id: string) => registry.get(id) },
    resolveOrCreateChatWorkspace: vi.fn(async () => { registry.set('chat-id', { template: 'chat' }); return { ok: true, workspace: { id: 'chat-id' } } }),
    resolveOrCreateAutoQuantWorkspace: vi.fn(async () => { registry.set('quant-id', { template: 'auto-quant-v2' }); return { ok: true, workspace: { id: 'quant-id' } } }),
    resolveOrCreateAutoPredictionWorkspace: vi.fn(async () => { registry.set('prediction-id', { template: 'auto-prediction' }); return { ok: true, workspace: { id: 'prediction-id' } } }),
  }
}
it('fills all missing default Workspaces after activation and consumes once across concurrent retries', async () => {
  const dir = await home(['chat', 'auto-quant']); const svc = service()
  await Promise.all([prepareProjectWorkspaces(svc as unknown as WorkspaceService, { home: dir }), prepareProjectWorkspaces(svc as unknown as WorkspaceService, { home: dir })])
  expect(svc.resolveOrCreateChatWorkspace).toHaveBeenCalledTimes(1)
  expect(svc.resolveOrCreateAutoPredictionWorkspace).toHaveBeenCalledTimes(1)
  expect((await readProjectWorkspaceSetup(dir)).pending).toEqual([])
  const prefs = JSON.parse(await readFile(join(dir, 'data/preferences.json'), 'utf8'))
  expect(prefs.quickChat.recentChatWorkspaceId).toBe('chat-id')
  expect(prefs.autoQuant.defaultWorkspaceId).toBe('quant-id')
  expect(prefs.autoPrediction.defaultWorkspaceId).toBe('prediction-id')
})
it('keeps failures retryable while preparing other workspaces', async () => {
  const dir = await home(['chat', 'auto-quant', 'auto-prediction']); const svc = service()
  svc.resolveOrCreateAutoQuantWorkspace.mockRejectedValueOnce(new Error('offline'))
  await prepareProjectWorkspaces(svc as unknown as WorkspaceService, { home: dir })
  expect(await readProjectWorkspaceSetup(dir)).toMatchObject({ pending: ['auto-quant'], errors: { 'auto-quant': 'offline' } })
  await prepareProjectWorkspaces(svc as unknown as WorkspaceService, { home: dir })
  expect(svc.resolveOrCreateChatWorkspace).toHaveBeenCalledTimes(1)
  expect(await readProjectWorkspaceSetup(dir)).toMatchObject({ pending: [], errors: {} })
})
it('prepares old and previously skipped homes on activation', async () => {
  const svc = service()
  for (const dir of [await home(), await home([])]) await prepareProjectWorkspaces(svc as unknown as WorkspaceService, { home: dir })
  expect(svc.resolveOrCreateChatWorkspace).toHaveBeenCalledTimes(2)
  expect(svc.resolveOrCreateAutoQuantWorkspace).toHaveBeenCalledTimes(2)
  expect(svc.resolveOrCreateAutoPredictionWorkspace).toHaveBeenCalledTimes(2)
})
it('rejects corrupt intent without creating workspaces', async () => {
  const dir = await home(['unknown']); const svc = service()
  await expect(prepareProjectWorkspaces(svc as unknown as WorkspaceService, { home: dir })).rejects.toThrow()
  expect(svc.resolveOrCreateChatWorkspace).not.toHaveBeenCalled()
})
