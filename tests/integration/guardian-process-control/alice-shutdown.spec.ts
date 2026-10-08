import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { requestAliceShutdown } from '../../../packages/guardian-runtime/src/process-control.js'

describe('owned Alice IPC shutdown', () => {
  it('finishes asynchronous descendant cleanup before the owned child exits without invoking fallback', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'alice-shutdown-'))
    const marker = join(directory, 'cleaned')
    const descendantProgram = "setInterval(() => {}, 1000); process.on('SIGTERM', () => setTimeout(() => process.exit(0), 60)); process.send('ready')"
    const program = [
      "const { spawn } = require('node:child_process')",
      "const { once } = require('node:events')",
      "const { writeFile } = require('node:fs/promises')",
      `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendantProgram)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })`,
      "descendant.once('message', () => process.send({ type: 'ready', descendantPid: descendant.pid }))",
      "process.on('message', async (message) => {",
      "  if (message?.type !== 'openalice:shutdown') return",
      "  const exited = once(descendant, 'exit')",
      "  descendant.kill('SIGTERM')",
      "  await exited",
      `  await writeFile(${JSON.stringify(marker)}, 'cleaned')`,
      "  process.exit(0)",
      "})",
    ].join('\n')
    const child = spawn(process.execPath, ['-e', program], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    let descendantPid: number | undefined
    try {
      const [ready] = await once(child, 'message') as [{ type: string; descendantPid: number }]
      expect(ready.type).toBe('ready')
      descendantPid = ready.descendantPid
      expect(() => process.kill(descendantPid!, 0)).not.toThrow()

      const fallback = vi.fn(() => child.kill('SIGTERM'))
      const exited = once(child, 'exit')
      requestAliceShutdown(child, fallback)
      await exited

      expect(readFileSync(marker, 'utf8')).toBe('cleaned')
      expect(() => process.kill(descendantPid!, 0)).toThrow()
      expect(fallback).not.toHaveBeenCalled()
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      if (descendantPid !== undefined) {
        try { process.kill(descendantPid, 'SIGKILL') } catch { /* already exited */ }
      }
      rmSync(directory, { recursive: true, force: true })
    }
  }, 10_000)

  it('uses fallback for a live child whose IPC channel is actually disconnected', async () => {
    const child = spawn(process.execPath, ['-e', "setInterval(() => {}, 1000); process.send('ready')"], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    })
    try {
      expect((await once(child, 'message'))[0]).toBe('ready')
      const pid = child.pid!
      const disconnected = once(child, 'disconnect')
      child.disconnect()
      await disconnected
      expect(() => process.kill(pid, 0)).not.toThrow()

      const fallback = vi.fn(() => child.kill('SIGTERM'))
      const exited = once(child, 'exit')
      requestAliceShutdown(child, fallback)
      await exited

      expect(fallback).toHaveBeenCalledOnce()
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
    }
  }, 10_000)
})

describe('built Guardian shutdown across a suspended connector read', () => {
  it.each(['startup', 'restart'] as const)('never starts a child after %s resumes past shutdown', async (phase) => {
    const directory = mkdtempSync(join(tmpdir(), 'guardian-shutdown-race-'))
    const home = join(directory, 'home')
    const attempts = join(directory, 'spawned.jsonl')
    const preload = join(directory, 'preload.cjs')
    writeFileSync(attempts, '')
    for (const entry of ['services/connector/dist/connector.cjs', 'dist/main.js']) {
      const path = join(directory, entry)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, [
        "process.on('SIGTERM', () => process.exit(0))",
        "process.on('message', message => { if (message?.type === 'openalice:shutdown') process.exit(0) })",
        'setInterval(() => {}, 1000)',
      ].join('\n'))
    }
    mkdirSync(join(home, 'data/config'), { recursive: true })
    const config = join(home, 'data/config/connector-service.json')
    writeFileSync(config, JSON.stringify({ enabled: true }))
    writeFileSync(preload, [
      "const childProcess = require('node:child_process')",
      "const fs = require('node:fs')",
      "const promises = require('node:fs/promises')",
      "const { syncBuiltinESMExports } = require('node:module')",
      "const { join } = require('node:path')",
      'const send = kind => process.send({ kind })',
      'const originalSpawn = childProcess.spawn',
      'childProcess.spawn = function (command, args, options) {',
      '  const child = originalSpawn.apply(this, arguments)',
      "  const role = args?.[0] === 'dist/main.js' ? 'alice' : args?.[0] === 'services/connector/dist/connector.cjs' ? 'connector' : null",
      '  if (role) fs.appendFileSync(process.env.FIXTURE_ATTEMPTS, JSON.stringify({ role, pid: child.pid }) + "\\n")',
      '  return child',
      '}',
      'const originalReadFile = promises.readFile',
      'let reads = 0, resume, trigger',
      'promises.readFile = function (path, ...args) {',
      "  if (String(path) === join(process.env.OPENALICE_HOME, 'data/config/connector-service.json') && ++reads === Number(process.env.FIXTURE_BLOCK_READ)) {",
      '    const held = Promise.withResolvers()',
      '    resume = () => originalReadFile(path, ...args).then(value => {',
      '      held.resolve(value)',
      "      setImmediate(() => send('read-resumed'))",
      '    }, held.reject)',
      "    send('read-blocked')",
      '    return held.promise',
      '  }',
      '  return originalReadFile(path, ...args)',
      '}',
      // A single controlled watcher event reaches the real restart handler on every OS.
      'promises.watch = function () {',
      '  return { async *[Symbol.asyncIterator]() {',
      "    send('watching')",
      '    const held = Promise.withResolvers()',
      '    trigger = held.resolve',
      '    await held.promise',
      "    yield { filename: process.platform === 'win32' ? join(process.env.OPENALICE_HOME, 'data/control/restart-connector.flag') : 'restart-connector.flag' }",
      '  } }',
      '}',
      'const exit = process.exit.bind(process)',
      // Keep the Guardian alive after shutdown owns its snapshot; Windows may kill children immediately.
      "process.exit = () => send('exit-requested')",
      "process.on('message', message => {",
      "  if (message === 'trigger') trigger()",
      "  if (message === 'stop') { process.emit('SIGTERM'); send('shutdown-entered') }",
      "  if (message === 'resume') resume()",
      "  if (message === 'finish') exit(0)",
      '})',
      'syncBuiltinESMExports()',
    ].join('\n'))

    const guardian = spawn(process.execPath, ['--require', preload, fileURLToPath(new URL('../../../scripts/guardian/prod.mjs', import.meta.url))], {
      cwd: directory,
      env: {
        ...process.env,
        NODE_OPTIONS: '',
        OPENALICE_HOME: home,
        AQ_LAUNCHER_ROOT: join(home, 'workspaces'),
        OPENALICE_RUNTIME_PROVIDER: 'source',
        OPENALICE_TRADING_MODE: 'lite',
        FIXTURE_ATTEMPTS: attempts,
        FIXTURE_BLOCK_READ: phase === 'startup' ? '1' : '2',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    const messages: { kind: string }[] = []
    guardian.on('message', message => messages.push(message as { kind: string }))
    let diagnostics = ''
    const closed = once(guardian, 'close')
    guardian.stderr?.on('data', chunk => { diagnostics += chunk.toString() })
    const receive = async (kind: string) => {
      const deadline = Date.now() + 7_000
      while (Date.now() < deadline) {
        const index = messages.findIndex(message => message?.kind === kind)
        if (index !== -1) return messages.splice(index, 1)[0]
        if (guardian.exitCode !== null || guardian.signalCode !== null) break
        await sleep(20)
      }
      throw new Error(`Guardian did not report ${kind}: ${diagnostics}`)
    }
    const spawned = () => readFileSync(attempts, 'utf8').trim().split('\n').filter(Boolean)
      .map(line => JSON.parse(line) as { role: string; pid: number })

    try {
      if (phase === 'restart') {
        await receive('watching')
        expect(spawned().map(child => child.role)).toEqual(['connector', 'alice'])
        guardian.send('trigger')
      }
      await receive('read-blocked')
      guardian.send('stop')
      await receive('shutdown-entered') // shutdown has already snapshotted its owned children.
      await receive('exit-requested') // Keep the fixture process alive while the held read resumes.
      guardian.send('resume')
      await receive('read-resumed')
      expect(spawned().map(child => child.role)).toEqual(phase === 'startup' ? [] : ['connector', 'alice'])
      guardian.send('finish')
      await closed
    } finally {
      if (guardian.exitCode === null && guardian.signalCode === null) guardian.kill('SIGKILL')
      await closed
      const children = spawned()
      for (const child of children) {
        try { process.kill(child.pid, 'SIGKILL') } catch { /* already exited */ }
      }
      const deadline = Date.now() + 2_000
      while (Date.now() < deadline && children.some(child => {
        try { process.kill(child.pid, 0); return true } catch { return false }
      })) await sleep(20)
      rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 })
    }
  }, 15_000)
})
