import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events')
  const child = Object.assign(new EventEmitter(), { pid: 4321, stdout: new EventEmitter(), stderr: new EventEmitter(), stdin: { write: vi.fn() } })
  return { child, spawn: vi.fn(), execFile: vi.fn(), writeFile: vi.fn(), rm: vi.fn() }
})
vi.mock('node:child_process', () => ({ spawn: mocks.spawn, execFile: mocks.execFile }))
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('Missing'), { code: 'ENOENT' })),
  writeFile: mocks.writeFile, rm: mocks.rm,
}))
vi.mock('@traderalice/guardian-runtime', () => ({
  defaultProcessController: { startedAt: async () => 1, machineId: async () => 'test', isAlive: () => false },
  terminateProcessTree: vi.fn().mockResolvedValue(undefined),
}))
import { NewsWorkerHost } from './host.js'

let host: NewsWorkerHost
const message = (type: string) => mocks.child.stdout.emit('data', Buffer.from(JSON.stringify({ type }) + '\n'))
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('TEMP', 'F:/owned-news-temp')
  vi.stubEnv('TMP', 'F:/owned-news-temp')
  mocks.child.removeAllListeners(); mocks.child.stdout.removeAllListeners(); mocks.child.stderr.removeAllListeners()
  mocks.spawn.mockReset().mockReturnValue(mocks.child)
  mocks.execFile.mockReset().mockImplementation((...args: unknown[]) => {
    mocks.child.emit('close', 0)
    const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void
    callback(null, '', '')
    return mocks.child
  })
  mocks.writeFile.mockReset().mockResolvedValue(undefined)
  mocks.rm.mockReset().mockResolvedValue(undefined)
  host = new NewsWorkerHost('unused', 'a'.repeat(64), { command: 'node', args: [] })
})
afterEach(async () => { await host.stop(); vi.useRealTimers(); vi.unstubAllEnvs() })

describe.skipIf(process.platform !== 'win32')('Windows news supervisor readiness', () => {
  it('allows supervisor preparation before starting the five-second module deadline', async () => {
    const starting = host.start('entry.mjs', 'test', '1')
    void starting.catch(() => {})
    await vi.advanceTimersByTimeAsync(6000)
    message('supervisor-ready')
    await vi.advanceTimersByTimeAsync(4000)
    message('ready')
    await expect(starting).resolves.toBeUndefined()
    expect(host.isLoaded()).toBe(true)
    await host.stop()
    expect(mocks.execFile.mock.lastCall?.[2].env).toMatchObject({ TEMP: 'F:/owned-news-temp', TMP: 'F:/owned-news-temp' })
  })

  it('still rejects a module that does not become ready within five seconds', async () => {
    let rejected = false
    const starting = host.start('entry.mjs', 'test', '1')
    void starting.catch(() => { rejected = true })
    await vi.advanceTimersByTimeAsync(0)
    message('supervisor-ready')
    await vi.advanceTimersByTimeAsync(4999)
    expect(rejected).toBe(false)
    await vi.advanceTimersByTimeAsync(2)
    await expect(starting).rejects.toThrow('Module worker failed')
    expect(host.isLoaded()).toBe(false)
  })

  it('rejects a second supervisor greeting instead of renewing the module deadline', async () => {
    const starting = host.start('entry.mjs', 'test', '1')
    void starting.catch(() => {})
    await vi.advanceTimersByTimeAsync(0)
    message('supervisor-ready')
    await vi.advanceTimersByTimeAsync(4000)
    message('supervisor-ready')
    await expect(starting).rejects.toThrow('Module worker failed')
  })

  it('bounds supervisor preparation even when no worker has started', async () => {
    const starting = host.start('entry.mjs', 'test', '1')
    void starting.catch(() => {})
    await vi.advanceTimersByTimeAsync(10_001)
    await expect(starting).rejects.toThrow('Module worker failed')
    expect(host.isLoaded()).toBe(false)
  })

  it('refuses module readiness before the Windows supervisor greeting', async () => {
    const starting = host.start('entry.mjs', 'test', '1')
    void starting.catch(() => {})
    await vi.advanceTimersByTimeAsync(0)
    message('ready')
    await expect(starting).rejects.toThrow('Module worker failed')
  })
})
