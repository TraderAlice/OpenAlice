import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionExecutionManager, type ExecutionRequest } from './session-execution-manager.js'
const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true }))) })
const request: ExecutionRequest = { workspaceId: 'ws', resumeId: 'resume', recordId: 'row', agent: 'claude', surface: 'webpi', intent: 'fresh', origin: { kind: 'user', entry: 'quick-chat' }, configuration: { credentialSource: 'native' } }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
async function setup() { const dir = await mkdtemp(join(tmpdir(), 'execution-manager-')); directories.push(dir); const file = join(dir, 'executions.json'); const project = vi.fn(async () => {}); return { file, project, manager: await SessionExecutionManager.open(file, project) } }
describe('Session execution authority', () => {
  it('records startup before starting a child and rejects overlapping launches', async () => {
    const { manager, project } = await setup()
    const ready = deferred<{ value: number; completed: Promise<{ reason: string }> }>()
    const completed = deferred<{ reason: string }>()
    const start = vi.fn(() => ready.promise)
    const driver = { start, stop: vi.fn(async () => {}) }
    const launch = manager.start(request, driver)
    await vi.waitFor(() => expect(start).toHaveBeenCalled())
    expect(project.mock.calls.length).toBe(1)
    expect(manager.list()[0].phase).toBe('starting')
    await expect(manager.start(request, driver)).rejects.toThrow('busy')
    ready.resolve({ value: 42, completed: completed.promise })
    expect(await launch).toBe(42)
    expect(manager.list()[0].phase).toBe('running')
    completed.resolve({ reason: 'natural-exit' })
    await vi.waitFor(() => expect(manager.list()[0].phase).toBe('ended'))
  })
  it('waits for stop and ignores old execution callbacks after a new start', async () => {
    const { manager } = await setup()
    const completed = deferred<{ reason: string }>()
    const stopped = deferred<void>()
    await manager.start(request, { start: async () => ({ value: null, completed: completed.promise }), stop: () => stopped.promise })
    const stopping = manager.stop('resume', 'user-pause')
    await vi.waitFor(() => expect(manager.list()[0].phase).toBe('stopping'))
    completed.resolve({ reason: 'natural-exit' })
    await expect(manager.start(request, { start: vi.fn(), stop: vi.fn() })).rejects.toThrow('busy')
    stopped.resolve()
    await stopping
    expect(manager.list()[0].reason).toBe('user-pause')
    await manager.start({ ...request, intent: 'resume' }, { start: async () => ({ value: 2, completed: new Promise(() => {}) }), stop: async () => {} })
    expect(manager.list().map(row => row.phase)).toEqual(['ended', 'running'])
  })
  it('cleans a partial startup and records a failed execution', async () => {
    const { manager } = await setup()
    const stop = vi.fn(async () => {})
    await expect(manager.start(request, { start: async () => { throw new Error('handshake') }, stop })).rejects.toThrow('handshake')
    expect(stop).toHaveBeenCalledWith('startup-failed')
    expect(manager.list()[0].phase).toBe('failed')
  })
  it('records owner restart without inventing a new launch or changing its origin', async () => {
    const { manager, file } = await setup()
    await manager.start(request, { start: async () => ({ value: 1, completed: new Promise(() => {}) }), stop: async () => {} })
    const recovered = await SessionExecutionManager.open(file, async () => {})
    expect(recovered.list()[0]).toMatchObject({ phase: 'interrupted', reason: 'owner-restarted', origin: request.origin })
    const again = await SessionExecutionManager.open(file, async () => {})
    expect(again.list()[0].events).toHaveLength(3)
  })
})

it('cancels stalled startup without waiting for readiness', async () => {
  const { manager } = await setup()
  const ready = deferred<{ value: number; completed: Promise<{ reason: string }> }>()
  const stop = vi.fn(async () => {})
  const start = vi.fn(() => ready.promise)
  const launch = manager.start(request, { start, stop })
  const rejected = expect(launch).rejects.toThrow('interrupted')
  await vi.waitFor(() => expect(start).toHaveBeenCalled())
  const id = manager.current('resume')!.executionId
  await manager.interrupt('resume', id, request.origin)
  await rejected
  expect(manager.list()[0]).toMatchObject({ phase: 'interrupted', reason: 'user-interrupted' })
  expect(manager.admission.blocks('resume')).toHaveLength(1)
  ready.resolve({ value: 1, completed: new Promise(() => {}) })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(stop).toHaveBeenCalledTimes(1)
  expect(manager.current('resume')).toBeNull()
})

it('guards stale requests, shares duplicate stops, and retains occupancy on failed termination', async () => {
  const { manager } = await setup()
  const stop = vi.fn().mockRejectedValueOnce(new Error('still alive')).mockResolvedValue(undefined)
  await manager.start(request, { start: async () => ({ value: null, completed: new Promise(() => {}) }), stop })
  const id = manager.current('resume')!.executionId
  await expect(manager.interrupt('resume', 'other', request.origin)).rejects.toThrow('not found')
  await expect(manager.interrupt('resume', id, request.origin)).rejects.toThrow('still alive')
  expect(manager.current('resume')).toMatchObject({ phase: 'stopping', stopError: 'Error: still alive' })
  await Promise.all([manager.interrupt('resume', id, request.origin), manager.interrupt('resume', id, request.origin)])
  expect(stop).toHaveBeenCalledTimes(2)
  expect(manager.admission.blocks('resume')).toHaveLength(1)
  expect(manager.list()[0].phase).toBe('interrupted')
  await expect(manager.start(request, { start: vi.fn(), stop })).rejects.toMatchObject({ code: 'session_blocked' })
  await manager.admission.release('resume', manager.admission.blocks('resume')[0].id, request.origin)
  await manager.start(request, { start: async () => ({ value: null, completed: new Promise(() => {}) }), stop })
  expect(await manager.interrupt('resume', id, request.origin)).toBe(false)
  expect(manager.current('resume')?.executionId).not.toBe(id)
  await manager.stopAll('test-cleanup')
})

it('requires attribution and rejects accidental secret-bearing request payloads before spawning', async () => {
  const { manager } = await setup()
  const start = vi.fn()
  for (const invalid of [
    { ...request, origin: undefined },
    { ...request, origin: { kind: 'user', entry: '' } },
    { ...request, configuration: { credentialSource: 'vault', apiKey: 'NEVER_PERSIST_ME' } },
    { ...request, env: { API_KEY: 'NEVER_PERSIST_ME' } },
  ]) await expect(manager.start(invalid as unknown as ExecutionRequest, { start, stop: async () => {} })).rejects.toThrow()
  expect(start).not.toHaveBeenCalled()
  expect(manager.list()).toEqual([])
})

it('records runtime activity once per change and ignores callbacks from retired executions', async () => {
  const { manager } = await setup()
  let report!: (activity: string) => Promise<void>
  await manager.start(request, { start: async callback => {
    report = callback
    return { value: 1, completed: new Promise(() => {}) }
  }, stop: async () => {} })
  await report('working')
  await report('working')
  await report('awaiting-input')
  await manager.stop(request.resumeId, 'user-pause')
  await manager.start(request, { start: async () => ({ value: 2, completed: new Promise(() => {}) }), stop: async () => {} })
  await report('idle')
  const records = manager.list()
  expect(records[0].events.filter(event => event.activity)).toHaveLength(2)
  expect(records[1].activity).toBeUndefined()
})

it('records one-shot completion only after the real process has settled', async () => {
  const { manager } = await setup()
  const exit = deferred<number>()
  const running = manager.run({ ...request, surface: 'headless', taskId: 'task-1' }, async ready => {
    ready(123)
    return exit.promise
  }, value => ({ reason: `exit:${value}`, failed: value !== 0 }))
  await vi.waitFor(() => expect(manager.list()[0].phase).toBe('running'))
  exit.resolve(0)
  expect(await running).toBe(0)
  expect(manager.list()[0]).toMatchObject({ phase: 'ended', pid: 123, taskId: 'task-1' })
})

it('keeps user attribution when interruption overtakes an orderly handoff stop', async () => {
  const { manager } = await setup()
  const exit = deferred<void>()
  await manager.start(request, { start: async () => ({ value: null, completed: new Promise(() => {}) }), stop: () => exit.promise })
  const executionId = manager.current('resume')!.executionId
  const handoff = manager.stop('resume', 'takeover')
  const interrupt = manager.interrupt('resume', executionId, request.origin)
  exit.resolve()
  await Promise.all([handoff, interrupt])
  expect(manager.list()[0]).toMatchObject({ phase: 'interrupted', reason: 'user-interrupted', interruption: { actor: request.origin } })
})
