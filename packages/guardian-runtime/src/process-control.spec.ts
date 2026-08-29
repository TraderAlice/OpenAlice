import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  ensureHomeMachineIdentity,
  homeMachineIdPath,
  normalizeProcessExitCode,
  terminateProcessTree,
} from './process-control.js'

const cleanupPids = new Set<number>()
let home: string

afterEach(async () => {
  for (const pid of cleanupPids) {
    try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
  }
  cleanupPids.clear()
  if (home) await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
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

describe('ensureHomeMachineIdentity', () => {
  it('creates, persists, and reuses a home-scoped machine identity', async () => {
    home = join(tmpdir(), `guardian-machine-id-${process.pid}-${Math.random().toString(16).slice(2)}`)
    await mkdir(home, { recursive: true })
    const firstEnv: NodeJS.ProcessEnv = {}
    const first = await ensureHomeMachineIdentity(home, firstEnv)
    expect(firstEnv.OPENALICE_MACHINE_ID).toBe(first)
    expect((await readFile(homeMachineIdPath(home), 'utf8')).trim()).toBe(first)

    const secondEnv: NodeJS.ProcessEnv = {}
    await expect(ensureHomeMachineIdentity(home, secondEnv)).resolves.toBe(first)
    expect(secondEnv.OPENALICE_MACHINE_ID).toBe(first)
  })

  it('keeps an explicit OPENALICE_MACHINE_ID and writes it when the home file is missing', async () => {
    home = join(tmpdir(), `guardian-machine-id-${process.pid}-${Math.random().toString(16).slice(2)}`)
    await mkdir(home, { recursive: true })
    const env: NodeJS.ProcessEnv = { OPENALICE_MACHINE_ID: 'compose-fixed' }
    await expect(ensureHomeMachineIdentity(home, env)).resolves.toBe('compose-fixed')
    expect((await readFile(homeMachineIdPath(home), 'utf8')).trim()).toBe('compose-fixed')
  })

  it('does not overwrite a persisted identity with a later env override absence', async () => {
    home = join(tmpdir(), `guardian-machine-id-${process.pid}-${Math.random().toString(16).slice(2)}`)
    await mkdir(join(home, 'state'), { recursive: true })
    await writeFile(homeMachineIdPath(home), 'already-persisted\n', 'utf8')
    const env: NodeJS.ProcessEnv = {}
    await expect(ensureHomeMachineIdentity(home, env)).resolves.toBe('already-persisted')
    expect(env.OPENALICE_MACHINE_ID).toBe('already-persisted')
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
