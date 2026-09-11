import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { registerConnectorModelRoutes } from './connector-model.js'
import { createSessionRuntimeBinding } from '../workspaces/session-runtime-binding.js'
import { readCredentials } from '../core/config.js'
vi.mock('../core/config.js', async original => ({ ...await original<typeof import('../core/config.js')>(), readCredentials: vi.fn() }))
vi.mock('../workspaces/credential-injection.js', () => ({ compatibleCredentials: (vault: Record<string, unknown>) => Object.entries(vault) }))
vi.mock('../workspaces/session-runtime-binding.js', () => ({ createSessionRuntimeBinding: vi.fn() }))

function fixture() {
  const identity = { wsId: 'ws', agent: 'codex', lifecycle: 'active', runtimeBinding: { credential: { source: 'native' }, model: 'gpt-5.6-sol', reasoningEffort: 'medium' } }
  const desk = { wsId: 'ws', issue: { assignee: '@resume-session' } }
  const replace = vi.fn(async ({ runtimeBinding }) => { identity.runtimeBinding = runtimeBinding })
  const svc = { connectorDesk: vi.fn(async () => desk), resumeRegistry: { get: () => identity, replaceRuntimeBinding: replace },
    registry: { get: () => ({ dir: '/workspace' }) }, adapters: { get: () => ({ capabilities: { aiProvider: { credentialSource: 'runtime-or-workspace' } } }) },
    headlessTasks: { latestForResumeId: () => ({ status: 'running' }) }, sessionRegistry: { ensureLoaded: vi.fn(async () => {}), findByResumeId: vi.fn(() => undefined as unknown) } }
  const app = new Hono(); registerConnectorModelRoutes(app, () => svc as never)
  const post = async (body: unknown) => { const res = await app.request('/cli/connector-model/telegram', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: res.status, body: await res.json() as any } }
  return { post, svc, identity, desk, replace }
}
beforeEach(() => {
  vi.mocked(readCredentials).mockResolvedValue({ account: { vendor: 'openai', label: 'My account', apiKey: 'SECRET' } } as never)
  vi.mocked(createSessionRuntimeBinding).mockImplementation(async ({ selection }) => ({ binding: { credential: { source: 'native' }, model: selection?.model, reasoningEffort: selection?.reasoningEffort } }) as never)
})
describe('Connector Session model control', () => {
  it('returns metadata only, previews without writing, saves the binding while a headless run continues', async () => {
    const f = fixture(); const { body: panel, status } = await f.post({})
    expect(status).toBe(200); expect(panel.running).toBe(true)
    expect(JSON.stringify(panel)).not.toContain('SECRET')
    expect(panel.credentials).toContainEqual({ id: 'vault:account', label: 'My account' })
    const request = { resumeId: panel.resumeId, revision: panel.revision, selection: { ...panel.selection, effort: 'low' } }
    expect((await f.post(request)).status).toBe(200); expect(f.replace).not.toHaveBeenCalled()
    const saved = await f.post({ ...request, apply: true })
    expect(saved.status).toBe(200); expect(saved.body.saved).toBe(true)
    expect(f.identity.runtimeBinding.reasoningEffort).toBe('low')
    expect(saved.body.revision).not.toBe(panel.revision)
    expect((await f.post({ ...request, apply: true })).status).toBe(400)
    expect(f.replace).toHaveBeenCalledTimes(1)
  })
  it('rejects stale desk ownership, invalid choices, runtime mutation and active interactive sessions', async () => {
    const f = fixture(); const { body: p } = await f.post({})
    const base = { resumeId: p.resumeId, revision: p.revision, selection: p.selection, apply: true }
    expect((await f.post({ ...base, runtime: 'pi' })).status).toBe(400)
    expect((await f.post({ ...base, selection: { ...p.selection, credential: 'vault:missing' } })).status).toBe(400)
    expect((await f.post({ ...base, selection: { ...p.selection, effort: 'banana' } })).status).toBe(400)
    f.svc.sessionRegistry.findByResumeId.mockReturnValue({ state: 'running', surface: 'web' })
    expect((await f.post(base)).body.error).toContain('Disconnect')
    f.desk.issue.assignee = '@resume-other'
    expect((await f.post(base)).body.error).toContain('changed')
    expect(f.replace).not.toHaveBeenCalled()
  })
  it('detects a handoff during credential resolution', async () => {
    const f = fixture(); const { body: p } = await f.post({})
    vi.mocked(createSessionRuntimeBinding).mockImplementationOnce(async () => { f.desk.issue.assignee = '@resume-other'; return { binding: f.identity.runtimeBinding } as never })
    expect((await f.post({ resumeId: p.resumeId, revision: p.revision, selection: p.selection, apply: true })).status).toBe(400)
    expect(f.replace).not.toHaveBeenCalled()
  })
})

it('accepts custom model IDs just like Chat and resets effort explicitly', async () => {
  const f = fixture(); const { body: p } = await f.post({})
  const selection = { ...p.selection, model: 'private/model', effort: null }
  const preview = await f.post({ resumeId: p.resumeId, revision: p.revision, selection })
  expect(preview.status).toBe(200)
  expect(preview.body.models).toContainEqual({ id: 'private/model', label: 'private/model' })
  const saved = await f.post({ resumeId: p.resumeId, revision: p.revision, selection, apply: true })
  expect(saved.status).toBe(200)
  expect(f.identity.runtimeBinding.reasoningEffort).toBeUndefined()
})

it('reports the resolved credential default, not the pre-save null placeholder', async () => {
  const f = fixture(); const { body: p } = await f.post({})
  vi.mocked(createSessionRuntimeBinding).mockResolvedValueOnce({ binding: { version: 1, credential: { source: 'vault', credentialSlug: 'account' }, model: 'resolved-default' } } as never)
  const saved = await f.post({ resumeId: p.resumeId, revision: p.revision, selection: { credential: 'vault:account', model: null, effort: null }, apply: true })
  expect(saved.body.selection.model).toBe('resolved-default')
  expect(saved.body.models).toContainEqual({ id: 'resolved-default', label: 'resolved-default' })
})
