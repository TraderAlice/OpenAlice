#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const cliEntry = join(repoRoot, 'packages/cli/bin/openalice.mjs')
const suffix = `${process.pid}-${Date.now().toString(36)}`
const image = `openalice-remote-smoke:${suffix}`
const args = process.argv.slice(2)
const keepImage = args.includes('--keep-image')
const keepContainer = args.includes('--keep-container')
let imageBuilt = false
let container = ''
let scratch = ''

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: pnpm test:remote:docker [--keep-image] [--keep-container]

Builds a clean local SSH host, serves the real OpenAlice installer inside that
host, and exercises plan, install, detached Server start, browser tunnel,
disconnect persistence, reconnect, structured stop, and absent status. This is
a local acceptance gate and is not wired into PR CI.

Options:
  --keep-image      Preserve the temporary Docker image
  --keep-container  Preserve the running fixture container (also keeps image)
  -h, --help        Show this help
`)
  process.exit(0)
}

const unknownArgs = args.filter((arg) => !['--keep-image', '--keep-container'].includes(arg))
if (unknownArgs.length > 0) {
  console.error(`remote docker smoke: unknown option: ${unknownArgs[0]}`)
  process.exit(1)
}

try {
  scratch = await mkdtemp(join(tmpdir(), 'openalice-remote-smoke-'))
  const keyPath = join(scratch, 'id_ed25519')
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyPath])

  console.log(`[remote-ssh-smoke] building ${image}`)
  run('docker', [
    'build',
    '--file', 'scripts/remote-smoke/Dockerfile',
    '--tag', image,
    '.',
  ], { cwd: repoRoot, inherit: true })
  imageBuilt = true

  container = run('docker', [
    'run', '--detach', '--rm',
    '--publish', '127.0.0.1::22',
    '--mount', `type=bind,src=${keyPath}.pub,dst=/tmp/authorized_keys,readonly`,
    image,
  ]).trim()
  const portOutput = run('docker', ['port', container, '22/tcp']).trim()
  const sshPort = Number(portOutput.slice(portOutput.lastIndexOf(':') + 1))
  if (!Number.isInteger(sshPort) || sshPort < 1) throw new Error(`Could not parse SSH port from ${portOutput}`)

  const localHome = join(scratch, 'local-home')
  const sshDir = join(localHome, '.ssh')
  await mkdir(sshDir, { recursive: true })
  await writeFile(join(sshDir, 'config'), `Host openalice-remote-smoke
  HostName 127.0.0.1
  User smoke
  Port ${sshPort}
  IdentityFile ${keyPath}
  IdentitiesOnly yes
  StrictHostKeyChecking no
  UserKnownHostsFile ${join(sshDir, 'known_hosts')}
  LogLevel ERROR
`)
  await chmod(sshDir, 0o700)
  await chmod(join(sshDir, 'config'), 0o600)
  const fixtureBin = join(scratch, 'bin')
  await mkdir(fixtureBin, { recursive: true })
  const sshWrapper = join(fixtureBin, 'ssh')
  const systemSsh = run('which', ['ssh']).trim()
  await writeFile(sshWrapper, `#!/bin/sh\nexec ${shellQuote(systemSsh)} -F "$OPENALICE_REMOTE_SMOKE_SSH_CONFIG" "$@"\n`)
  await chmod(sshWrapper, 0o700)

  const remoteTarget = 'openalice-remote-smoke'
  const smokeEnv = {
    ...process.env,
    HOME: localHome,
    PATH: `${fixtureBin}:${process.env.PATH ?? ''}`,
    OPENALICE_REMOTE_SMOKE_SSH_CONFIG: join(sshDir, 'config'),
    OPENALICE_REMOTE_INSTALL_URL: 'http://127.0.0.1:18080/install',
    OPENALICE_REMOTE_INSTALL_BASE_URL: 'http://127.0.0.1:18080/packages/cli/',
    OPENALICE_REMOTE_VERSION: 'remote-smoke',
  }
  await waitForSsh(remoteTarget, smokeEnv)

  console.log('[remote-ssh-smoke] checking read-only missing-host plan')
  const initialPlan = run(process.execPath, [
    cliEntry, 'remote', remoteTarget,
    '--app-dir', '/fixture/OpenAlice',
    '--plan', '--no-open',
  ], { cwd: repoRoot, env: smokeEnv })
  requireText(initialPlan, 'install remote OpenAlice CLI')
  requireText(initialPlan, 'start remote OpenAlice Server')
  run('ssh', [remoteTarget, 'test ! -x "$HOME/.openalice/bin/openalice"'], { env: smokeEnv })

  console.log('[remote-ssh-smoke] applying install/start and opening first tunnel')
  await attachAndProbe(remoteTarget, smokeEnv, [
    '--app-dir', '/fixture/OpenAlice',
    '--yes', '--no-open', '--wait', '30',
  ])
  const running = remoteJson(remoteTarget, smokeEnv, '"$HOME/.openalice/bin/openalice" server status --json')
  if (running.class !== 'running' || running.owner?.surface !== 'cli-server') {
    throw new Error(`Remote Server did not survive tunnel disconnect: ${JSON.stringify(running)}`)
  }

  console.log('[remote-ssh-smoke] checking reuse plan and reconnecting')
  const reusePlan = run(process.execPath, [
    cliEntry, 'remote', remoteTarget, '--plan', '--no-open',
  ], { cwd: repoRoot, env: smokeEnv })
  requireText(reusePlan, 'reuse compatible remote CLI Server')
  await attachAndProbe(remoteTarget, smokeEnv, ['--no-open', '--wait', '30'])

  console.log('[remote-ssh-smoke] stopping the remote Server through its control endpoint')
  run('ssh', [remoteTarget, '"$HOME/.openalice/bin/openalice" server stop --wait 15'], { env: smokeEnv })
  const absent = remoteJson(remoteTarget, smokeEnv, '"$HOME/.openalice/bin/openalice" server status --json')
  if (absent.class !== 'absent') throw new Error(`Remote Server did not stop cleanly: ${JSON.stringify(absent)}`)

  console.log('[remote-ssh-smoke] passed')
} catch (error) {
  console.error(`[remote-ssh-smoke] failed: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  if (keepContainer && container) {
    console.log(`[remote-ssh-smoke] kept container ${container}`)
  } else if (container) {
    run('docker', ['rm', '--force', container], { allowFailure: true, inherit: true })
  }
  if ((keepImage || keepContainer) && imageBuilt) {
    console.log(`[remote-ssh-smoke] kept image ${image}`)
  } else if (imageBuilt) {
    run('docker', ['image', 'rm', '--force', image], { allowFailure: true, inherit: true })
  }
  if (scratch) await rm(scratch, { recursive: true, force: true })
}

async function waitForSsh(target, env) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = spawnSync('ssh', [target, 'true'], { env, stdio: 'ignore' })
    if (result.status === 0) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error('SSH fixture did not become ready')
}

async function attachAndProbe(target, env, remoteArgs) {
  const child = spawn(process.execPath, [cliEntry, 'remote', target, ...remoteArgs], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  child.stdout.setEncoding('utf8')
  let output = ''
  let resolveUrl
  let rejectUrl
  const urlReady = new Promise((resolvePromise, rejectPromise) => {
    resolveUrl = resolvePromise
    rejectUrl = rejectPromise
  })
  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
    output += chunk
    const match = /Local OpenAlice UI: (http:\/\/127\.0\.0\.1:\d+)/.exec(output)
    if (match) resolveUrl(match[1])
  })
  child.once('error', rejectUrl)
  child.once('exit', (code, signal) => {
    if (!/Local OpenAlice UI:/.test(output)) {
      rejectUrl(new Error(`remote CLI exited before tunnel readiness (code=${String(code)}, signal=${String(signal)})`))
    }
  })

  const timeout = setTimeout(() => rejectUrl(new Error('Timed out waiting for the local tunnel URL')), 60_000)
  let url
  try {
    url = await urlReady
  } finally {
    clearTimeout(timeout)
  }
  const response = await fetch(`${url}/api/auth/status`, { signal: AbortSignal.timeout(5_000) })
  const body = await response.json()
  if (!response.ok || body.fixture !== 'remote-ssh-smoke') {
    child.kill('SIGTERM')
    throw new Error(`Tunnel returned the wrong Runtime response: ${JSON.stringify(body)}`)
  }
  child.kill('SIGTERM')
  const exit = await waitForExit(child, 10_000)
  if (exit.code !== 0) throw new Error(`remote CLI did not close cleanly after tunnel disconnect (${JSON.stringify(exit)})`)
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode ?? 0, signal: child.signalCode })
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      rejectPromise(new Error('Timed out waiting for remote CLI to close'))
    }, timeoutMs)
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      resolvePromise({ code: code ?? 0, signal })
    })
  })
}

function remoteJson(target, env, command) {
  const output = run('ssh', [target, command], { env })
  return JSON.parse(output.trim().split(/\r?\n/).filter(Boolean).at(-1))
}

function requireText(output, expected) {
  if (!output.includes(expected)) throw new Error(`Expected output to contain ${JSON.stringify(expected)}\n${output}`)
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'inherit'],
  })
  if (result.error) throw result.error
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`${command} ${commandArgs[0] ?? ''} failed (${result.status ?? result.signal ?? 'unknown'})`)
  }
  return typeof result.stdout === 'string' ? result.stdout : ''
}
