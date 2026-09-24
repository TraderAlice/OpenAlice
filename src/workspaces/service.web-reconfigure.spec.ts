import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WorkspaceService } from './service.js'
import type { WebSessionSnapshot } from './web-session/model.js'

let root: string
let service: WorkspaceService
let Host: typeof import('./web-session-host.js').WebSessionHost
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'web-reconfigure-'))
  for (const key of ['OPENALICE_HOME', 'AQ_LAUNCHER_ROOT', 'OPENALICE_GLOBAL_DIR', 'HOME', 'USERPROFILE']) vi.stubEnv(key, root)
  vi.resetModules()
  service = await (await import('./service.js')).createWorkspaceService({ webPort: 0, mcpPort: 0, toolBaseUrl: 'http://127.0.0.1:0/cli', scheduleScannerIntervalMs: 600_000 })
  Host = (await import('./web-session-host.js')).WebSessionHost
  const dir = join(root, 'workspace')
  await mkdir(dir)
  await service.registry.add({ id: 'ws', tag: 'ws', dir, createdAt: new Date(0).toISOString() })
  await service.sessionCoordinator.ensure({ resumeId: 'resume-test', wsId: 'ws', agent: 'codex', namePrefix: 'x', agentSessionId: 'native-test', surface: 'webpi', now: 1000 })
})
afterEach(async () => {
  await service?.dispose('test complete')
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetModules()
  await rm(root, { recursive: true, force: true })
})

it('waits for the old child to stop, saves the binding, and restarts the exact native Session', async () => {
  const record = service.sessionRegistry.listFor('ws')[0]!
  const meta = service.registry.get('ws')!
  const snapshot = { phase: 'idle' } as WebSessionSnapshot
  let current: WebSessionSnapshot | null = null
  vi.spyOn(Host.prototype, 'get').mockImplementation(() => current)
  let release!: () => void
  const stop = vi.spyOn(Host.prototype, 'stop').mockImplementation(async () => {
    await new Promise<void>(resolve => { release = resolve })
    current = null
    return true
  })
  const start = vi.spyOn(Host.prototype, 'start').mockImplementation(async (_input, completion) => {
    completion?.(new Promise(() => {}))
    current = snapshot
    return snapshot
  })
  await service.executions.web(meta, record, { kind: 'user', entry: 'web-open' })
  start.mockClear()
  const operation = service.executions.web(meta, record, { kind: 'user', entry: 'web-reconfigure' }, { runtimeSelection: { credentialSource: 'native', model: 'gpt-5.6-sol', reasoningEffort: 'high' } })
  await vi.waitFor(() => expect(stop).toHaveBeenCalled())
  expect(start).not.toHaveBeenCalled()
  expect(service.isResumeActive(record.resumeId)).toBe(true)
  release()
  await operation
  expect(start).toHaveBeenCalledWith(expect.objectContaining({ recordId: record.id, nativeSessionId: 'native-test', model: 'gpt-5.6-sol', reasoningEffort: 'high' }), expect.any(Function))
  expect(service.resumeRegistry.get(record.resumeId)?.runtimeBinding).toMatchObject({ credential: { source: 'native' }, model: 'gpt-5.6-sol', reasoningEffort: 'high' })
  expect(service.isResumeActive(record.resumeId)).toBe(false)
  stop.mockImplementation(async () => { current = null; return true })
})

it.each(['working', 'awaiting-input', 'compacting'] as const)('does not interrupt a %s turn', async phase => {
  const record = service.sessionRegistry.listFor('ws')[0]!
  vi.spyOn(Host.prototype, 'get').mockReturnValue({ phase } as WebSessionSnapshot)
  const stop = vi.spyOn(Host.prototype, 'stop')
  await expect(service.executions.web(service.registry.get('ws')!, record, { kind: 'user', entry: 'web-reconfigure' }, { runtimeSelection: { credentialSource: 'native', model: 'gpt-5.6-sol' } })).rejects.toThrow('Wait for the current response')
  expect(stop).not.toHaveBeenCalled()
  expect(service.isResumeActive(record.resumeId)).toBe(false)
})

it('validates credentials before stopping the old child', async () => {
  const record = service.sessionRegistry.listFor('ws')[0]!
  const stop = vi.spyOn(Host.prototype, 'stop')
  await expect(service.executions.web(service.registry.get('ws')!, record, { kind: 'user', entry: 'web-reconfigure' }, { runtimeSelection: { credentialSlug: 'missing-key' } })).rejects.toThrow()
  expect(stop).not.toHaveBeenCalled()
  expect(service.isResumeActive(record.resumeId)).toBe(false)
})
