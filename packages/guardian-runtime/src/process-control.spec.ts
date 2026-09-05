import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'

import {
  compareProcessIdentity,
  currentProcessStartedAt,
  defaultProcessController,
  normalizeProcessExitCode,
  parseProcBootTimeSeconds,
  parseProcStatStartTicks,
  terminateProcessTree,
} from './process-control.js'

const cleanupPids = new Set<number>()

afterEach(() => {
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

describe('procfs process start time parsing', () => {
  const commWithParens = '4242 (my (weird) proc name) S 1 4242 4242 0 -1 4194304 1234 0 0 0 12 7 0 0 20 0 9 0 8675309 123456 789 18446744073709551615 1 1 0 0 0 0 0 0 0 0 0 0 17 3 0 0 0 0 0\n'

  it('reads field 22 past a comm containing spaces and parentheses', () => {
    expect(parseProcStatStartTicks(commWithParens)).toBe(8_675_309)
  })

  it('reads a plain comm', () => {
    expect(parseProcStatStartTicks('7 (node) S 0 7 7 0 -1 4194304 1 0 0 0 1 1 0 0 20 0 11 0 4242 1 1')).toBe(4_242)
  })

  it('rejects malformed stat lines', () => {
    expect(parseProcStatStartTicks('')).toBeNull()
    expect(parseProcStatStartTicks('7 node S 1 2 3')).toBeNull()
    expect(parseProcStatStartTicks('7 (node) S 1')).toBeNull()
  })

  it('reads btime from /proc/stat and ignores other rows', () => {
    const content = [
      'cpu  1 2 3 4',
      'intr 0 0 0',
      'btime 1756800000',
      'processes 4242',
    ].join('\n')
    expect(parseProcBootTimeSeconds(content)).toBe(1_756_800_000)
    expect(parseProcBootTimeSeconds('cpu 1 2 3\nprocesses 4')).toBeNull()
  })
})

describe('compareProcessIdentity', () => {
  const controller = {
    isAlive: () => true,
    startedAt: async () => {
      throw new Error('startedAt must not be consulted for our own pid')
    },
    machineId: async () => 'machine-a',
    signalTree: async () => undefined,
    sleep: async () => undefined,
  }

  it('reports a recorded owner that reuses our own pid as a different process', async () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1_000).toISOString()
    await expect(compareProcessIdentity(process.pid, twoDaysAgo, controller)).resolves.toBe('different')
  })

  it('recognizes our own pid when the recorded start time is ours', async () => {
    const ours = new Date(currentProcessStartedAt()).toISOString()
    await expect(compareProcessIdentity(process.pid, ours, controller)).resolves.toBe('same')
  })

  it('records our own start time on the same clock the controller reports', async () => {
    // A guardian writes `currentProcessStartedAt()` into the lock; a different
    // process reads that pid back through the controller. Any systematic gap
    // between the two is spent out of the pid-reuse tolerance before reuse is
    // even considered.
    const reported = await defaultProcessController.startedAt(process.pid)
    expect(reported).not.toBeNull()
    if (process.platform === 'linux') expect(currentProcessStartedAt()).toBe(reported)
    else expect(Math.abs(reported! - currentProcessStartedAt())).toBeLessThan(2_000)
  })

  it('reads a real foreign pid start time on Linux without shelling out', async () => {
    if (process.platform !== 'linux') return
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' })
    if (!child.pid) throw new Error('child did not start')
    cleanupPids.add(child.pid)
    const startedAt = new Date().toISOString()
    await expect(compareProcessIdentity(child.pid, startedAt)).resolves.toBe('same')
    await expect(compareProcessIdentity(child.pid, '2020-01-01T00:00:00.000Z')).resolves.toBe('different')
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

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
