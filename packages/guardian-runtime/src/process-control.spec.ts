import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { afterEach, describe, expect, it } from 'vitest'

import { normalizeProcessExitCode, terminateProcessTree } from './process-control.js'

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
