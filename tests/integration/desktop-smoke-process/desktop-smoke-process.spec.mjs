import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { desktopSmokeGroupAlive, spawnDesktopSmoke, stopDesktopSmoke } from '../../../scripts/desktop-smoke-process.mjs'

function alive(pid) {
  try { process.kill(pid, 0) } catch { return false }
  if (process.platform === 'linux') {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)
      if (fields[0] === 'Z' && fields[17] === '1') return false
    } catch { /* A positive probe with unknown procfs state stays live. */ }
  }
  return true
}

function stat(pid, state = 'Z', threads = '1', { comm = 'worker', group = 42, session = group, started = '100' } = {}) {
  const fields = Array.from({ length: 20 }, () => '0')
  fields[0] = state; fields[2] = String(group); fields[3] = String(session)
  fields[17] = threads; fields[19] = started
  return `${pid} (${comm}) ${fields.join(' ')}`
}

function procFixture(entries, lists = [Object.keys(entries)]) {
  let scans = 0
  return {
    platform: 'linux', probe: vi.fn(),
    list: () => lists[Math.min(scans++, lists.length - 1)],
    read: (path) => {
      if (path === '/proc/self/mountinfo') return '1 0 0:1 / /proc rw - proc proc rw'
      const value = entries[path.split('/')[2]]
      if (value === undefined) throw Object.assign(new Error('gone'), { code: 'ENOENT' })
      return value
    },
  }
}

describe('desktop smoke group liveness', () => {
  it('excludes only a stable nonempty group of exited single-thread zombies', () => {
    expect(desktopSmokeGroupAlive(42, procFixture({ 43: stat(43), 44: stat(44) }))).toBe(false)
    expect(desktopSmokeGroupAlive(42, procFixture({}))).toBe(true)
  })

  it.each([['S', '1'], ['R', '1'], ['Z', '2'], ['Z', '0'], ['Z', 'unknown']])('keeps state %s with thread count %s live', (state, threads) => {
    expect(desktopSmokeGroupAlive(42, procFixture({ 43: stat(43, state, threads) }))).toBe(true)
  })

  it('parses state after the final parenthesis of a legal adversarial comm', () => {
    expect(desktopSmokeGroupAlive(42, procFixture({ 43: stat(43, 'S', '1', { comm: 'worker) Z 1 x' }) }))).toBe(true)
  })

  it('retains live children forked between the directory snapshot and zombie read', () => {
    expect(desktopSmokeGroupAlive(42, procFixture({ 43: stat(43), 44: stat(44, 'S') }, [['43'], ['43', '44']]))).toBe(true)
  })

  it('retains newly exited or reused identities until a complete stable rescan', () => {
    expect(desktopSmokeGroupAlive(42, procFixture({ 43: stat(43), 44: stat(44) }, [['43'], ['43', '44']]))).toBe(true)
    const fixture = procFixture({ 43: stat(43) })
    const read = fixture.read
    let reads = 0
    fixture.read = path => path.endsWith('/stat') ? stat(43, 'Z', '1', { started: String(++reads) }) : read(path)
    expect(desktopSmokeGroupAlive(42, fixture)).toBe(true)
  })

  it('keeps live members in another group of the owned session conservative', () => {
    expect(desktopSmokeGroupAlive(42, procFixture({ 43: stat(43), 44: stat(44, 'S', '1', { group: 44, session: 42 }) }))).toBe(true)
  })

  it('does not turn restricted, hidden, malformed or racing procfs into exit', () => {
    const restricted = procFixture({ 43: stat(43) })
    restricted.list = () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }) }
    expect(desktopSmokeGroupAlive(42, restricted)).toBe(true)
    const hidden = procFixture({ 43: stat(43) })
    hidden.read = () => '1 0 0:1 / /proc rw - proc proc rw,hidepid=2'
    expect(desktopSmokeGroupAlive(42, hidden)).toBe(true)
    expect(desktopSmokeGroupAlive(42, procFixture({ 43: 'malformed' }))).toBe(true)
    expect(desktopSmokeGroupAlive(42, procFixture({}, [['43']]))).toBe(true)
  })

  it('only treats ESRCH from the group signal probe as absent', () => {
    for (const [code, expected] of [['ESRCH', false], ['EPERM', true], ['EIO', true]]) {
      const fixture = procFixture({})
      fixture.probe = () => { throw Object.assign(new Error(code), { code }) }
      expect(desktopSmokeGroupAlive(42, fixture)).toBe(expected)
    }
    expect(desktopSmokeGroupAlive(42, { ...procFixture({}), platform: 'darwin' })).toBe(true)
  })
})

describe('desktop smoke process cleanup', () => {
  it.skipIf(process.platform === 'win32').each(['graceful', 'TERM-ignoring'])('terminates a %s helper after the parent exits', async (kind) => {
    const grandchildProgram = `
      process.title = 'worker) Z 1 x'
      ${kind === 'TERM-ignoring' ? "process.on('SIGTERM', () => {})" : ''}
      setInterval(() => {}, 1000)
      process.send('ready')
    `
    const parentProgram = `
      const { spawn } = require('node:child_process')
      const child = spawn(process.execPath, ['-e', ${JSON.stringify(grandchildProgram)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] })
      child.once('message', () => process.stdout.write(String(child.pid) + '\\n', () => process.exit(0)))
    `
    const parent = spawnDesktopSmoke(process.execPath, ['-e', parentProgram], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    let helperPid = null
    try {
      helperPid = await new Promise((resolve, reject) => {
        parent.stdout.once('data', (chunk) => resolve(Number(chunk.toString().trim())))
        parent.once('error', reject)
      })
      if (parent.exitCode === null && parent.signalCode === null) {
        await new Promise((resolve) => parent.once('exit', resolve))
      }
      expect(alive(helperPid)).toBe(true)
      if (process.platform === 'linux') expect(readFileSync(`/proc/${helperPid}/comm`, 'utf8').trim()).toBe('worker) Z 1 x')
      if (kind === 'TERM-ignoring') {
        process.kill(helperPid, 'SIGTERM')
        expect(alive(helperPid)).toBe(true)
      }
      await stopDesktopSmoke(parent, 2_000)
      expect(alive(helperPid)).toBe(false)
    } finally {
      // Always stop our private group even if readiness or an assertion fails.
      try { process.kill(-parent.pid, 'SIGKILL') } catch { /* already absent */ }
      await stopDesktopSmoke(parent, 1_000)
    }
  }, 10_000)
})
