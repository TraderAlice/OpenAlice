import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { SessionExecutionManager, type ExecutionRequest } from './session-execution-manager.js'
import { SessionTakeovers } from './session-takeover.js'
const roots: string[] = []
const managers: SessionExecutionManager[] = []
afterEach(async () => { vi.useRealTimers(); await Promise.all(managers.splice(0).map(m => m.stopAll('test-cleanup'))); await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))) })
const request: ExecutionRequest = { workspaceId: 'ws', resumeId: 'resume', recordId: 'record', agent: 'pi', surface: 'webpi', intent: 'resume', origin: { kind: 'user', entry: 'chat' }, configuration: { credentialSource: 'native' } }
const target = { workspaceId: 'ws', resumeId: 'resume', recordId: 'record' }
const origin = { kind: 'issue' as const, entry: 'schedule', issueId: 'scan' }
async function setup(surface: 'webpi' | 'terminal' = 'webpi') {
  const root = await mkdtemp(join(tmpdir(), 'takeover-')); roots.push(root)
  const file = join(root, 'executions.json')
  const manager = await SessionExecutionManager.open(file, async () => {}); managers.push(manager)
  let report!: (s: string) => Promise<void>
  const stop = vi.fn(async () => {})
  await manager.start({ ...request, surface }, { start: async cb => { report = cb; await cb('idle'); return { value: null, completed: new Promise(() => {}) } }, stop })
  return { manager, stop, report, file }
}
it('keeps input available while pending; activity delays auto handoff and working turns are never stopped', async () => {
  const { manager, stop, report } = await setup()
  let now = Date.now()
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  const admission = manager.takeovers.acquire(target, origin, 60)
  await vi.waitFor(() => expect(manager.takeovers.list()).toHaveLength(1))
  expect(manager.takeovers.isHandingOff('resume')).toBe(false)
  now += 59000; manager.takeovers.activity('resume'); now += 2000
  await report('working')
  expect(manager.takeovers.list()[0].deadline).toBe(now + 58000)
  now += 60000
  await vi.waitFor(() => expect(manager.takeovers.list()[0].state).toBe('waiting-idle'))
  expect(stop).not.toHaveBeenCalled()
  await report('idle')
  const release = await admission
  expect(stop).toHaveBeenCalledTimes(1)
  expect(manager.takeovers.list()[0]).toMatchObject({ state: 'running', decision: 'idle-timeout', origin })
  await expect(manager.start(request, { start: vi.fn(), stop })).rejects.toThrow('handoff')
  release(); expect(manager.takeovers.list()[0].state).toBe('completed')
  vi.restoreAllMocks()
})
it('explicit approval also waits for a GUI turn to finish', async () => {
  const { manager, report, stop } = await setup()
  await report('working')
  const pending = manager.takeovers.acquire(target, origin, 60)
  await vi.waitFor(() => expect(manager.takeovers.list()).toHaveLength(1))
  await manager.takeovers.decide(manager.takeovers.list()[0].id, 'approve')
  expect(stop).not.toHaveBeenCalled()
  await report('idle'); const release = await pending; release()
})
it('rechecks activity after journaling before stopping an owner', async () => {
  const { manager, file } = await setup()
  const owner = manager.list('resume')[0]!
  let reads = 0
  const stop = vi.fn(async () => true)
  const takeovers = await SessionTakeovers.open(`${file}.race.json`, () => {
    if (++reads === 2) owner.activity = 'working'
    return owner
  }, stop)
  const admission = takeovers.acquire(target, origin, 0)
  await vi.waitFor(() => expect(takeovers.list()[0]?.state).toBe('waiting-idle'))
  expect(stop).not.toHaveBeenCalled()
  owner.activity = 'idle'
  const release = await admission
  expect(stop).toHaveBeenCalledTimes(1)
  release()
  await takeovers.close()
})
it('requires manual approval for unknown terminal activity, serializes queued callers and rejects stale decisions', async () => {
  const { manager, stop } = await setup('terminal')
  const first = manager.takeovers.acquire(target, origin, 0)
  await vi.waitFor(() => expect(manager.takeovers.list()[0]?.blocker).toBe('terminal'))
  expect(stop).not.toHaveBeenCalled()
  const second = manager.takeovers.acquire(target, { ...origin, issueId: 'other' }, 60)
  let entered = false; void second.then(() => { entered = true })
  await manager.takeovers.decide(manager.takeovers.list()[0].id, 'approve')
  const releaseFirst = await first
  expect(entered).toBe(false)
  await expect(manager.takeovers.decide(manager.takeovers.list()[0].id, 'approve')).rejects.toThrow('no longer')
  releaseFirst(); const releaseSecond = await second; releaseSecond()
  expect(stop).toHaveBeenCalledTimes(1)
})
it('decline leaves the owner running; restart cancels requests instead of silently resuming work', async () => {
  const { manager, stop, file } = await setup()
  const pending = manager.takeovers.acquire(target, origin, 60)
  const rejected = expect(pending).rejects.toThrow('declined')
  await vi.waitFor(() => expect(manager.takeovers.list()).toHaveLength(1))
  await manager.takeovers.decide(manager.takeovers.list()[0].id, 'reject'); await rejected
  expect(stop).not.toHaveBeenCalled()
  const next = manager.takeovers.acquire(target, origin, 60)
  void next.catch(() => {})
  await vi.waitFor(() => expect(manager.takeovers.list()).toHaveLength(2))
  // Acquisition persists before returning to its awaiting caller.
  await new Promise(resolve => setTimeout(resolve, 30))
  const { SessionTakeovers } = await import('./session-takeover.js')
  const recovered = await SessionTakeovers.open(`${file}.takeovers.json`, () => undefined, async () => false)
  expect(recovered.list()[1]).toMatchObject({ state: 'canceled', decision: 'owner-restarted' })
  await recovered.close()
})
it('validates timing and prevents self takeover', async () => {
  const { manager } = await setup()
  await expect(manager.takeovers.configure(0)).rejects.toThrow('10–3600')
  await manager.takeovers.configure(120)
  expect(manager.takeovers.idleSeconds).toBe(120)
  await expect(manager.takeovers.acquire(target, { kind: 'session', entry: 'ask', resumeId: 'resume' }, 60)).rejects.toThrow('own takeover')
})

it('does not let a slow stop block another Session and still stops on journal shutdown failure', async () => {
  const { manager, stop } = await setup()
  let finishStop!: () => void
  stop.mockImplementationOnce(() => new Promise<void>(resolve => { finishStop = resolve }))
  const first = manager.takeovers.acquire(target, origin, 60)
  await vi.waitFor(() => expect(manager.takeovers.list()).toHaveLength(1))
  await manager.takeovers.decide(manager.takeovers.list()[0].id, 'approve')
  await vi.waitFor(() => expect(stop).toHaveBeenCalled())
  const second = await manager.takeovers.acquire({ ...target, resumeId: 'other', recordId: 'other' }, origin, 60)
  second()
  finishStop(); const release = await first; release()
  await manager.start(request, { start: async () => ({ value: null, completed: new Promise(() => {}) }), stop })
  const close = vi.spyOn(manager.takeovers, 'close').mockRejectedValueOnce(new Error('disk failed'))
  await expect(manager.stopAll('shutdown')).rejects.toThrow('shutdown failed')
  expect(stop).toHaveBeenCalledTimes(2)
  close.mockRestore()
})

it('user interruption cancels queued offers and approval cannot bypass its cooldown', async () => {
  const { manager } = await setup('terminal')
  const pending = manager.takeovers.acquire(target, origin, 60)
  const rejected = expect(pending).rejects.toThrow()
  await vi.waitFor(() => expect(manager.takeovers.list()).toHaveLength(1))
  const id = manager.takeovers.list()[0].id
  await manager.interrupt('resume', manager.current('resume')!.executionId, request.origin)
  await rejected
  expect(manager.takeovers.list()[0].state).toBe('canceled')
  await expect(manager.takeovers.decide(id, 'approve')).rejects.toThrow()
  await expect(manager.takeovers.acquire(target, origin, 60)).rejects.toMatchObject({ code: 'session_blocked' })
})
