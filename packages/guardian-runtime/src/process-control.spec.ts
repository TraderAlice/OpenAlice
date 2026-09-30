import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  defaultProcessController,
  linuxProcessStartedAt,
  normalizeProcessExitCode,
  readProcessStartedAt,
  terminateProcessTree,
} from './process-control.js'

const taskkillHarness = vi.hoisted(() => ({
  failNextGracefulTaskkill: false,
  calls: [] as Array<{ args: string[]; delegated: boolean }>,
  wrapperPid: 0,
  descendantPid: 0,
  initialTreeAlive: false,
}))

vi.mock('node:child_process', async (importOriginal) => {
  const original = await importOriginal()
  const execFile = (...args: unknown[]) => {
    const command = args[0]
    const taskkillArgs = Array.isArray(args[1]) ? args[1].map(String) : []
    const failInitialTaskkill = command === 'taskkill'
      && taskkillHarness.failNextGracefulTaskkill
      && taskkillArgs[0] === '/pid'
      && taskkillArgs[1] === String(taskkillHarness.wrapperPid)
      && taskkillArgs.includes('/T')
      && !taskkillArgs.includes('/F')

    if (command === 'taskkill') {
      taskkillHarness.calls.push({ args: taskkillArgs, delegated: !failInitialTaskkill })
    }
    if (failInitialTaskkill) {
      taskkillHarness.failNextGracefulTaskkill = false
      taskkillHarness.initialTreeAlive =
        isAlive(taskkillHarness.wrapperPid) && isAlive(taskkillHarness.descendantPid)
      const callback = args.at(-1) as
        | ((error: Error | null, stdout: string, stderr: string) => void)
        | undefined
      callback?.(new Error('simulated initial taskkill /T failure'), '', '')
      return undefined
    }
    return Reflect.apply(original.execFile, undefined, args)
  }

  return {
    ...original,
    execFile: execFile as unknown as typeof original.execFile,
  }
})

const cleanupPids = new Set<number>()

afterEach(() => {
  for (const pid of cleanupPids) {
    try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
  }
  cleanupPids.clear()
  taskkillHarness.failNextGracefulTaskkill = false
  taskkillHarness.calls.length = 0
  taskkillHarness.wrapperPid = 0
  taskkillHarness.descendantPid = 0
  taskkillHarness.initialTreeAlive = false
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
  it('terminates descendants even when the package-manager-like wrapper exits first', async () => {
    const childProgram = [
      "process.on('SIGTERM',()=>process.exit(0))",
      "setInterval(()=>{},1000)",
    ].join(';')
    const wrapperProgram = [
      "const{spawn}=require('node:child_process')",
      `const child=spawn(process.execPath,['-e',${JSON.stringify(childProgram)}],{stdio:'ignore',detached:true})`,
      "console.log(child.pid)",
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

    await terminateProcessTree(wrapper.pid, { gracefulMs: 2_000, forceMs: 2_000 })

    expect(isAlive(wrapper.pid)).toBe(false)
    expect(isAlive(childPid)).toBe(false)
    cleanupPids.delete(wrapper.pid)
    cleanupPids.delete(childPid)
  })
})

describe('Windows process signaling', () => {
  it.skipIf(process.platform !== 'win32')('force-kills a process when graceful taskkill is rejected', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' })
    await once(child, 'spawn')
    if (!child.pid) throw new Error('child did not start')
    cleanupPids.add(child.pid)

    await defaultProcessController.signalTree(child.pid, 'SIGTERM')

    expect(isAlive(child.pid)).toBe(false)
    cleanupPids.delete(child.pid)
  })
  it.skipIf(process.platform !== 'win32')(
    'delegates the /F retry to taskkill for a live wrapper tree after /T fails',
    async () => {
      const descendantProgram = 'setInterval(()=>{},1000)'
      const wrapperProgram = [
        "const{spawn}=require('node:child_process')",
        `const child=spawn(process.execPath,['-e',${JSON.stringify(descendantProgram)}],{stdio:'ignore'})`,
        "child.once('spawn',()=>console.log(child.pid))",
        "setInterval(()=>{},1000)",
      ].join(';')
      const wrapper = spawn(process.execPath, ['-e', wrapperProgram], {
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      await once(wrapper, 'spawn')
      const wrapperPid = wrapper.pid
      if (!wrapperPid || !wrapper.stdout) throw new Error('wrapper did not start')
      cleanupPids.add(wrapperPid)

      const [chunk] = await once(wrapper.stdout, 'data') as [Buffer]
      const descendantPid = Number(chunk.toString('utf8').trim())
      if (!Number.isInteger(descendantPid) || descendantPid <= 0) {
        throw new Error('wrapper did not report a descendant PID')
      }
      cleanupPids.add(descendantPid)

      taskkillHarness.calls.length = 0
      taskkillHarness.wrapperPid = wrapperPid
      taskkillHarness.descendantPid = descendantPid
      taskkillHarness.initialTreeAlive = false
      taskkillHarness.failNextGracefulTaskkill = true

      try {
        await defaultProcessController.signalTree(wrapperPid, 'SIGTERM')
      } finally {
        taskkillHarness.failNextGracefulTaskkill = false
      }

      expect(taskkillHarness.initialTreeAlive).toBe(true)
      expect(taskkillHarness.calls).toEqual([
        { args: ['/pid', String(wrapperPid), '/T'], delegated: false },
        { args: ['/pid', String(wrapperPid), '/T', '/F'], delegated: true },
      ])

      const waitForExit = async (pid: number) => {
        const deadline = Date.now() + 2_000
        while (isAlive(pid) && Date.now() < deadline) {
          const { promise, resolve } = Promise.withResolvers<void>()
          setTimeout(resolve, 25)
          await promise
        }
        return !isAlive(pid)
      }
      expect(await waitForExit(wrapperPid)).toBe(true)
      expect(await waitForExit(descendantPid)).toBe(true)
      cleanupPids.delete(wrapperPid)
      cleanupPids.delete(descendantPid)
    },
    10_000,
  )
})

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}


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
