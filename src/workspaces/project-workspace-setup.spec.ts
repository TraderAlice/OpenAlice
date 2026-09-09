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
  return {
    resolveOrCreateChatWorkspace: vi.fn(async () => ({ ok: true, workspace: { id: 'chat-id' } })),
    resolveOrCreateAutoQuantWorkspace: vi.fn(async () => ({ ok: true, workspace: { id: 'quant-id' } })),
    resolveOrCreateAutoPredictionWorkspace: vi.fn(async () => ({ ok: true, workspace: { id: 'prediction-id' } })),
  }
}
it('prepares only requested workspaces, saves defaults, and consumes once across concurrent retries', async () => {
  const dir = await home(['chat', 'auto-quant']); const svc = service()
  await Promise.all([prepareProjectWorkspaces(svc as unknown as WorkspaceService, { home: dir }), prepareProjectWorkspaces(svc as unknown as WorkspaceService, { home: dir })])
  expect(svc.resolveOrCreateChatWorkspace).toHaveBeenCalledTimes(1)
  expect(svc.resolveOrCreateAutoPredictionWorkspace).not.toHaveBeenCalled()
  expect((await readProjectWorkspaceSetup(dir)).pending).toEqual([])
  const prefs = JSON.parse(await readFile(join(dir, 'data/preferences.json'), 'utf8'))
  expect(prefs.quickChat.recentChatWorkspaceId).toBe('chat-id')
  expect(prefs.autoQuant.defaultWorkspaceId).toBe('quant-id')
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
it('leaves old and explicitly skipped homes alone', async () => {
  const svc = service()
  for (const dir of [await home(), await home([])]) await prepareProjectWorkspaces(svc as unknown as WorkspaceService, { home: dir })
  expect(svc.resolveOrCreateChatWorkspace).not.toHaveBeenCalled()
})
it('rejects corrupt intent without creating workspaces', async () => {
  const dir = await home(['unknown']); const svc = service()
  await expect(prepareProjectWorkspaces(svc as unknown as WorkspaceService, { home: dir })).rejects.toThrow()
  expect(svc.resolveOrCreateChatWorkspace).not.toHaveBeenCalled()
})
