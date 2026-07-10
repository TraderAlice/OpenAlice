#!/usr/bin/env node
import { execFile, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const pnpmCommand = process.platform === 'win32' ? (process.env.ComSpec ?? 'cmd.exe') : 'pnpm'
const pnpmArgs = (commandArgs) => process.platform === 'win32'
  ? ['/d', '/s', '/c', ['pnpm.cmd', ...commandArgs].join(' ')]
  : commandArgs
const args = new Set(process.argv.slice(2))
const skipBuild = args.has('--skip-build')
const keep = args.has('--keep')
const guardianRecovery = args.has('--guardian-recovery')
const timeoutMs = 90_000
const knownArgs = new Set(['--skip-build', '--keep', '--guardian-recovery', '--help', '-h'])
const unknownArgs = [...args].filter((arg) => !knownArgs.has(arg))

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: pnpm electron:smoke:pty [--skip-build] [--keep] [--guardian-recovery]

Launch Electron with isolated data and assert the renderer preload PTY bridge
can attach to a real workspace shell session, then assert the injected CLI shim
can read its manifest over the Electron-only tool socket. This opens no product
web port; only the UTA HTTP port is bound on 127.0.0.1 for the test process.

--guardian-recovery first holds the same runtime locks with a healthy fixture,
then proves Electron's explicit takeover stops it before Alice starts.
`)
  process.exit(0)
}

if (unknownArgs.length > 0) {
  console.error(`[desktop-pty-smoke] unknown option(s): ${unknownArgs.join(', ')}`)
  process.exit(1)
}

function run(label, command, commandArgs) {
  console.log(`\n[desktop-pty-smoke] ${label}`)
  const result = spawnSync(
    command === 'pnpm' ? pnpmCommand : command,
    command === 'pnpm' ? pnpmArgs(commandArgs) : commandArgs,
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: process.env,
    },
  )
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function freePort() {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer()
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (address && typeof address === 'object') resolvePromise(address.port)
        else rejectPromise(new Error('failed to allocate port'))
      })
    })
  })
}

if (!skipBuild) run('build Electron runtime', 'pnpm', ['electron:build'])

const smokeRoot = mkdtempSync(join(tmpdir(), 'openalice-electron-pty-smoke-'))
const smokeHome = join(smokeRoot, 'home')
const smokeWorkspaces = join(smokeRoot, 'workspaces')
const utaPort = await freePort()
let recoveryOwner = null
let recoveryOwnerExited = !guardianRecovery
let takeoverObserved = !guardianRecovery

if (guardianRecovery) {
  console.log('\n[desktop-pty-smoke] starting prior runtime owner')
  const fixturePath = join(repoRoot, 'scripts', 'guardian', 'runtime-owner-fixture.ts')
  recoveryOwner = spawn(process.execPath, ['--import', 'tsx', fixturePath], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OPENALICE_HOME: smokeHome,
      AQ_LAUNCHER_ROOT: smokeWorkspaces,
      OPENALICE_RUNTIME_FIXTURE_MODE: 'healthy',
      OPENALICE_RUNTIME_FIXTURE_GUARDIAN: '1',
      OPENALICE_RUNTIME_FIXTURE_HEARTBEAT_MS: '50',
    },
  })
  let fixtureOutput = ''
  recoveryOwner.stdout.on('data', (chunk) => {
    fixtureOutput += chunk.toString()
    process.stdout.write(chunk)
  })
  recoveryOwner.stderr.on('data', (chunk) => {
    fixtureOutput += chunk.toString()
    process.stderr.write(chunk)
  })
  recoveryOwner.once('exit', () => { recoveryOwnerExited = true })
  const deadline = Date.now() + 10_000
  while (!fixtureOutput.includes('[runtime-fixture] ready') && Date.now() < deadline) {
    if (recoveryOwner.exitCode !== null || recoveryOwner.signalCode !== null) {
      throw new Error(`prior runtime owner exited before ready:\n${fixtureOutput}`)
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
  if (!fixtureOutput.includes('[runtime-fixture] ready')) throw new Error('prior runtime owner did not become ready')
}

console.log('\n[desktop-pty-smoke] launching Electron PTY smoke')
console.log(`[desktop-pty-smoke] data: ${smokeHome}`)
console.log(`[desktop-pty-smoke] workspaces: ${smokeWorkspaces}`)
console.log(`[desktop-pty-smoke] uta port: ${utaPort}`)

const child = spawn(pnpmCommand, pnpmArgs(['-F', '@traderalice/desktop', 'dev']), {
  cwd: join(repoRoot, 'apps', 'desktop'),
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    OPENALICE_HOME: smokeHome,
    AQ_LAUNCHER_ROOT: smokeWorkspaces,
    OPENALICE_GLOBAL_DIR: join(smokeRoot, 'global'),
    OPENALICE_UTA_PORT: String(utaPort),
    OPENALICE_ELECTRON_SMOKE_PTY: '1',
    OPENALICE_ELECTRON_SMOKE_KEEP_WORKSPACE: '1',
    ...(guardianRecovery ? { OPENALICE_TAKEOVER: '1' } : {}),
  },
})

let settled = false
let output = ''
let ptyPassed = false
let cliStarted = false
let socketPath = ''
let workspaceId = ''

const finish = (code, message) => {
  if (settled) return
  if (code === 0 && (!takeoverObserved || !recoveryOwnerExited)) {
    code = 1
    message = '\n[desktop-pty-smoke] recovery failed: prior owner was not confirmed stopped before Electron became ready'
  }
  settled = true
  clearTimeout(timer)
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  if (recoveryOwner && recoveryOwner.exitCode === null && recoveryOwner.signalCode === null) recoveryOwner.kill('SIGKILL')
  if (!keep) rmSync(smokeRoot, { recursive: true, force: true })
  if (message) console.log(message)
  process.exit(code)
}

const maybeRunCliSmoke = () => {
  if (!ptyPassed || cliStarted || !socketPath || !workspaceId) return
  cliStarted = true
  const cliPath = join(repoRoot, 'src', 'workspaces', 'cli', 'bin', 'alice')
  execFile(process.execPath, [cliPath], {
    env: {
      ...process.env,
      AQ_WS_ID: workspaceId,
      OPENALICE_TOOL_SOCKET: socketPath,
      OPENALICE_TOOL_URL: '/cli',
    },
    timeout: 10_000,
  }, (err, stdout, stderr) => {
    if (err) {
      console.error(stdout)
      console.error(stderr)
      finish(1, `\n[desktop-pty-smoke] CLI socket smoke failed: ${err.message}`)
      return
    }
    if (!stdout.includes('OpenAlice CLI')) {
      console.error(stdout)
      finish(1, '\n[desktop-pty-smoke] CLI socket smoke failed: manifest output missing')
      return
    }
    console.log('[desktop-pty-smoke] CLI socket smoke -> ok')
    finish(0, '\n[desktop-pty-smoke] passed')
  })
}

const onData = (chunk) => {
  const text = chunk.toString()
  output += text
  process.stdout.write(text)
  const socketMatch = text.match(/local tool gateway listening on (.+)/)
  if (socketMatch?.[1]) socketPath = socketMatch[1].trim()
  if (text.includes('electron smoke pty → ok') || text.includes('electron smoke pty -> ok')) {
    ptyPassed = true
    const workspaceMatch = text.match(/electron smoke pty (?:→|->) ok workspace=([^ ]+)/)
    if (workspaceMatch?.[1]) workspaceId = workspaceMatch[1]
    maybeRunCliSmoke()
  }
  if (text.includes('[guardian] takeover → previous OpenAlice runtime stopped') || text.includes('[guardian] takeover -> previous OpenAlice runtime stopped')) {
    takeoverObserved = true
  }
  if (text.includes('electron smoke pty → failed') || text.includes('electron smoke pty -> failed')) {
    finish(1, '\n[desktop-pty-smoke] failed')
  }
  maybeRunCliSmoke()
}

child.stdout.on('data', onData)
child.stderr.on('data', onData)

const timer = setTimeout(() => {
  console.error('\n[desktop-pty-smoke] timed out')
  console.error(output.split('\n').slice(-80).join('\n'))
  finish(1)
}, timeoutMs)

child.on('exit', (code, signal) => {
  if (settled) return
  finish(code ?? (signal ? 1 : 0), `\n[desktop-pty-smoke] Electron exited before smoke passed code=${code} signal=${signal}`)
})
