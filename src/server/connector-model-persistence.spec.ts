import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Hono } from 'hono'
import { expect, it, vi } from 'vitest'
import { ResumeRegistry } from '../workspaces/resume-registry.js'
import { WorkspaceSessionRuntimeStore } from '../workspaces/session-runtime-store.js'
import { codexAdapter } from '../workspaces/adapters/codex.js'
import { createNativeSessionRuntimeBinding, resolveSessionRuntimeBinding } from '../workspaces/session-runtime-binding.js'
import { registerConnectorModelRoutes } from './connector-model.js'
vi.mock('../core/config.js', async original => ({ ...await original<typeof import('../core/config.js')>(), readCredentials: async () => ({}) }))

it('persists model controls to the Session dossier, survives reload and leaves the captured run unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'connector-model-persistence-'))
  try {
    const store = new WorkspaceSessionRuntimeStore(ws => [join(dir, ws, '.alice', 'sessions')])
    const logger = { warn() {}, error() {} } as never
    const path = join(dir, 'resumes.json')
    const registry = await ResumeRegistry.load(path, logger, store)
    const original = createNativeSessionRuntimeBinding({ adapter: codexAdapter, selection: { model: 'gpt-5.6-sol', reasoningEffort: 'medium' } }).binding
    const identity = await registry.ensure({ wsId: 'ws', agent: 'codex', runtimeBinding: original })
    const captured = await resolveSessionRuntimeBinding({ adapter: codexAdapter, cwd: dir, binding: original })
    const app = new Hono()
    registerConnectorModelRoutes(app, () => ({
      connectorDesk: async () => ({ wsId: 'ws', issue: { assignee: `@${identity.resumeId}` } }),
      resumeRegistry: registry, registry: { get: () => ({ dir }) }, adapters: { get: () => codexAdapter },
      headlessTasks: { latestForResumeId: () => ({ status: 'running' }) },
      sessionRegistry: { ensureLoaded: async () => {}, findByResumeId: () => ({ state: 'running', surface: 'headless' }) },
    }) as never)
    const post = async (body: unknown) => app.request('/cli/connector-model/telegram', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
    const panel = await (await post({})).json() as any
    const saved = await post({ resumeId: panel.resumeId, revision: panel.revision, selection: { ...panel.selection, effort: 'low' }, apply: true })
    expect(saved.status).toBe(200)
    expect(captured.binding.reasoningEffort).toBe('medium')
    const reloaded = await ResumeRegistry.load(path, logger, store)
    const next = await resolveSessionRuntimeBinding({ adapter: codexAdapter, cwd: dir, binding: reloaded.get(identity.resumeId)!.runtimeBinding! })
    expect(next.binding.reasoningEffort).toBe('low')
    expect(next.binding.model).toBe('gpt-5.6-sol')
    expect(reloaded.get(identity.resumeId)?.agent).toBe('codex')
  } finally { await rm(dir, { recursive: true, force: true }) }
})
