import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultProcessController, linuxProcessStartedAt, readProcessStartedAt, normalizeProcessExitCode, terminateProcessTree } from '../../../packages/guardian-runtime/src/process-control.js'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, readFileSync: vi.fn(actual.readFileSync) }
})

const cleanupPids = new Set<number>()

function processStat(state: string, threads = '1', name = 'worker (alice)'): string {
  // Fields after comm: state (3), num_threads (20), starttime (22).
  return `42 (${name}) ${[state, ...Array(16).fill('0'), threads, '0', '12345', '0'].join(' ')}`
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.mocked(readFileSync).mockReset()
  for (const pid of cleanupPids) {
    try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
  }
  cleanupPids.clear()
})

describe('normalizeProcessExitCode', () => {
  it('preserves valid integer exit codes', () => {
    expect(normalizeProcessExitCode(0)).toBe(0)
    expect(normalizeProcessExitCode(1)).toBe(1)
    expect(normalizeProcessExitCode(137)).toBe(137)
  })

  it('maps signal callback payloads and invalid numbers to success', () => {
    expect(normalizeProcessExitCode('SIGINT')).toBe(0)
    expect(normalizeProcessExitCode('SIGTERM')).toBe(0)
    expect(normalizeProcessExitCode(Number.NaN)).toBe(0)
    expect(normalizeProcessExitCode(-1)).toBe(0)
  })
})

describe('terminateProcessTree', () => {
  // Windows taskkill /T owns tree termination, rather than POSIX TERM handlers.
  it.each(process.platform === 'win32' ? [false] : [false, true])('terminates descendants even when the package-manager-like wrapper exits first (ignore TERM: %s)', async (ignoreTerm) => {
    const childProgram = [
      "if(process.platform==='linux')process.title='worker) Z 1 x'",
      ignoreTerm ? "process.on('SIGTERM',()=>{})" : "process.on('SIGTERM',()=>process.exit(0))",
      "process.send('ready')",
      "setInterval(()=>{},1000)",
    ].join(';')
    const wrapperProgram = [
      "if(process.platform==='linux')process.title='worker) Z 1 x'",
      "const{spawn}=require('node:child_process')",
      `const child=spawn(process.execPath,['-e',${JSON.stringify(childProgram)}],{stdio:['ignore','ignore','ignore','ipc'],detached:true})`,
      "child.once('message',()=>console.log(child.pid))",
      "process.on('SIGTERM',()=>process.exit(0))",
      "setInterval(()=>{},1000)",
    ].join(';')
    const wrapper = spawn(process.execPath, ['-e', wrapperProgram], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    if (!wrapper.pid || !wrapper.stdout) throw new Error('wrapper did not start')
    cleanupPids.add(wrapper.pid)
    const [chunk] = await once(wrapper.stdout, 'data') as [Buffer]
    const childPid = Number(chunk.toString('utf8').trim())
    expect(Number.isInteger(childPid)).toBe(true)
    cleanupPids.add(childPid)

    if (process.platform === 'linux') {
      for (const pid of [wrapper.pid, childPid]) {
        expect(readFileSync(`/proc/${pid}/stat`, 'utf8')).toContain('(worker) Z 1 x)')
      }
    }
    expect(defaultProcessController.isAlive(childPid)).toBe(true)
    const wrapperExited = once(wrapper, 'exit')
    const signalTree = vi.spyOn(defaultProcessController, 'signalTree')

    await terminateProcessTree(wrapper.pid, { gracefulMs: 2_000, forceMs: 2_000 })
    await wrapperExited
    expect(signalTree.mock.calls[0]?.[1]).toBe('SIGTERM')
    if (process.platform !== 'win32') {
      expect(signalTree.mock.calls.map((call) => call[1])).toEqual(ignoreTerm ? ['SIGTERM', 'SIGKILL'] : ['SIGTERM'])
      if (ignoreTerm) expect(signalTree.mock.calls[1]?.[2]).toContain(childPid)
    }

    expect(defaultProcessController.isAlive(wrapper.pid)).toBe(false)
    // Independent OS oracle: an existing Linux PID must be an exited zombie,
    // never a sleeping/stopped live descendant accepted by our implementation.
    if (process.platform === 'linux') {
      try {
        const stat = readFileSync(`/proc/${childPid}/stat`, 'utf8')
        const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)
        expect(fields[0]).toBe('Z')
        expect(fields[17]).toBe('1')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    } else {
      expect(() => process.kill(childPid, 0)).toThrow()
    }
    expect(defaultProcessController.isAlive(childPid)).toBe(false)
    cleanupPids.delete(wrapper.pid)
    cleanupPids.delete(childPid)
  })
})

describe('process liveness', () => {
  it('does not treat permission errors as proof of exit', () => {
    vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }) })
    expect(defaultProcessController.isAlive(42)).toBe(true)
  })

  it('rejects invalid PIDs and recognizes an absent process', () => {
    const signal = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('gone'), { code: 'ESRCH' }) })
    for (const pid of [0, -1, 1.5, Number.NaN]) expect(defaultProcessController.isAlive(pid)).toBe(false)
    expect(signal).not.toHaveBeenCalled()
    expect(defaultProcessController.isAlive(42)).toBe(false)
    signal.mockImplementation(() => { throw Object.assign(new RangeError('invalid pid'), { code: 'ERR_OUT_OF_RANGE' }) })
    expect(defaultProcessController.isAlive(Number.MAX_SAFE_INTEGER)).toBe(false)
  })

  it.skipIf(process.platform !== 'linux')('only excludes an explicit zombie state, including names with parentheses', () => {
    vi.spyOn(process, 'kill').mockReturnValue(true)
    for (const state of ['R', 'S', 'D', 'T', 't', 'I', 'Z']) {
      vi.mocked(readFileSync).mockReturnValue(processStat(state))
      expect(defaultProcessController.isAlive(42)).toBe(state !== 'Z')
    }
    vi.mocked(readFileSync).mockReturnValue('42 malformed Z')
    expect(defaultProcessController.isAlive(42)).toBe(true)
    vi.mocked(readFileSync).mockImplementation(() => { throw new Error('restricted procfs') })
    expect(defaultProcessController.isAlive(42)).toBe(true)
  })

  it.skipIf(process.platform !== 'linux')('keeps adversarial live process names authoritative through forced termination', async () => {
    vi.spyOn(process, 'kill').mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(processStat('S', '1', 'worker) Z 1 x'))
    expect(defaultProcessController.isAlive(42)).toBe(true)
    const signalTree = vi.fn(async (_pid: number, _signal: NodeJS.Signals) => [42])
    await expect(terminateProcessTree(42, { gracefulMs: 0, forceMs: 0,
      controller: { ...defaultProcessController, signalTree },
    })).rejects.toThrow('survivors: 42')
    expect(signalTree.mock.calls.map((call) => call[1])).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it.skipIf(process.platform !== 'linux')('keeps a zombie leader alive while workers or unknown thread counts remain', async () => {
    vi.spyOn(process, 'kill').mockReturnValue(true)
    for (const threads of ['2', '8', '0', '-1', 'unknown']) {
      vi.mocked(readFileSync).mockReturnValue(processStat('Z', threads))
      expect(defaultProcessController.isAlive(42)).toBe(true)
    }
    vi.mocked(readFileSync).mockReturnValue('42 (leader) Z 1 0 0')
    expect(defaultProcessController.isAlive(42)).toBe(true)
    vi.mocked(readFileSync).mockReturnValue(processStat('Z', '2'))
    const signalTree = vi.fn(async (_pid: number, _signal: NodeJS.Signals) => [42])
    await expect(terminateProcessTree(42, { gracefulMs: 0, forceMs: 0,
      controller: { ...defaultProcessController, signalTree },
    })).rejects.toThrow('survivors: 42')
    expect(signalTree.mock.calls.map((call) => call[1])).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('still rejects a live descendant after both signal phases', async () => {
    const signals: NodeJS.Signals[] = []
    const alive = new Set([41, 42])
    const controller = { ...defaultProcessController,
      isAlive: (pid: number) => alive.has(pid),
      signalTree: async (_pid: number, signal: NodeJS.Signals) => {
        signals.push(signal)
        alive.delete(41)
        return [42]
      },
      sleep: async () => {},
    }
    await expect(terminateProcessTree(41, { controller, gracefulMs: 0, forceMs: 0 })).rejects.toThrow('survivors: 42')
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
  })
})


describe('Linux process identity', () => {
  it('reads start ticks despite spaces and parentheses in the process name', () => {
    const fields = ['S', ...Array(18).fill('0'), '12345', '0']
    expect(linuxProcessStartedAt(`42 (worker (alice)) ${fields.join(' ')}`, 'cpu 1 2\nbtime 1700000000\n', 100)).toBe(1700000123450)
    expect(linuxProcessStartedAt('42 broken', 'btime 1700000000', 100)).toBeNull()
    expect(linuxProcessStartedAt(`42 (x) ${fields.join(' ')}`, 'cpu 1', 100)).toBeNull()
    expect(linuxProcessStartedAt(`42 (x) ${fields.join(' ')}`, 'btime 1700000000', 0)).toBeNull()
  })
  it.skipIf(process.platform !== 'linux')('reads the real process start without locale-dependent ps output', async () => {
    const started = await readProcessStartedAt(process.pid)
    expect(started).not.toBeNull()
    expect(Math.abs(started! - (Date.now() - process.uptime() * 1000))).toBeLessThan(3000)
  })
})
