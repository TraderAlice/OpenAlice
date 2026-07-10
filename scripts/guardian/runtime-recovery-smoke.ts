import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  RuntimeAlreadyRunningError,
  acquireGuardianRuntime,
  acquireOpenAliceRuntimeLocks,
  inspectOpenAliceRuntime,
  runtimeLockDir,
} from '../../packages/guardian-runtime/src/index.js'

const repoRoot = resolve(import.meta.dirname, '..', '..')
const fixture = resolve(import.meta.dirname, 'runtime-owner-fixture.ts')
const home = await mkdtemp(join(tmpdir(), 'openalice-guardian-recovery-'))
const launcherRoot = join(home, 'workspaces')
const children = new Set<ChildProcess>()

try {
  console.log(`[guardian-recovery-smoke] home → ${home}`)

  const healthy = await spawnFixture('healthy')
  const firstOwnerPath = join(runtimeLockDir(home), 'owner.json')
  const firstHeartbeat = (JSON.parse(await readFile(firstOwnerPath, 'utf8')) as { heartbeatAt: string }).heartbeatAt
  await waitFor('heartbeat renewal', async () => {
    const current = JSON.parse(await readFile(firstOwnerPath, 'utf8')) as { heartbeatAt: string }
    return current.heartbeatAt !== firstHeartbeat
  })
  await expectConflict()
  await expectDevEntryConflict(healthy)
  const healthyReplacement = await acquireRecoveredStack('smoke-healthy-replacement')
  await waitForExit(healthy, 'healthy owner graceful takeover')
  await healthyReplacement.release()
  console.log('[guardian-recovery-smoke] healthy duplicate → blocked, explicit takeover → graceful stop')

  const crashed = await spawnFixture('crash')
  await waitForExit(crashed, 'crashed owner')
  const staleRows = await inspectOpenAliceRuntime({ userDataHome: home, launcherRoot })
  assert(staleRows.some((row) => row.state === 'stale'), 'crashed owner did not leave a stale lock for the recovery test')
  const reclaimed = await acquireRecoveredStack('smoke-reclaimer')
  await reclaimed.release()
  console.log('[guardian-recovery-smoke] crashed owner → stale lock reclaimed automatically')

  const stubborn = await spawnFixture('stubborn')
  const forcedReplacement = await acquireRecoveredStack('smoke-after-force')
  await waitForExit(stubborn, 'stubborn owner forced takeover')
  await forcedReplacement.release()
  console.log('[guardian-recovery-smoke] unresponsive owner → SIGTERM grace → forced tree stop → reclaimed')

  console.log('[guardian-recovery-smoke] PASS')
} finally {
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  await rm(home, { recursive: true, force: true })
}

async function expectDevEntryConflict(owner: ChildProcess): Promise<void> {
  const [command, args] = process.platform === 'win32'
    ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm.cmd dev']]
    : ['pnpm', ['dev']]
  const child = spawn(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENALICE_HOME: home,
      AQ_LAUNCHER_ROOT: launcherRoot,
      OPENALICE_TRADING_MODE: 'lite',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString() })
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString() })
  const exitCode = await new Promise<number | null>((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error('duplicate pnpm dev did not fail fast')), 10_000)
    child.once('exit', (code) => {
      clearTimeout(timer)
      children.delete(child)
      resolvePromise(code)
    })
  })
  assert(exitCode === 2, `duplicate pnpm dev exited ${exitCode}; output:\n${output}`)
  assert(output.includes('pnpm dev --takeover'), `duplicate pnpm dev did not print the takeover recovery path:\n${output}`)
  assert(owner.exitCode === null && owner.signalCode === null, 'duplicate dev killed the healthy owner without consent')
}

async function spawnFixture(mode: 'healthy' | 'crash' | 'stubborn'): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', fixture], {
    cwd: repoRoot,
    env: {
      ...process.env,
      OPENALICE_HOME: home,
      AQ_LAUNCHER_ROOT: launcherRoot,
      OPENALICE_RUNTIME_FIXTURE_MODE: mode,
      OPENALICE_RUNTIME_FIXTURE_GUARDIAN: '1',
      OPENALICE_RUNTIME_FIXTURE_HEARTBEAT_MS: '50',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  children.add(child)
  let output = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
    process.stdout.write(chunk)
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    output += chunk.toString()
    process.stderr.write(chunk)
  })
  child.once('exit', () => children.delete(child))
  await waitFor(`${mode} fixture ready`, () => output.includes('[runtime-fixture] ready'))
  return child
}

async function expectConflict(): Promise<void> {
  try {
    await acquireGuardianRuntime({ userDataHome: home, launcherRoot, launcher: 'smoke-conflict' })
  } catch (err) {
    if (err instanceof RuntimeAlreadyRunningError) return
    throw err
  }
  throw new Error('healthy duplicate startup was not blocked')
}

async function acquireRecoveredStack(launcher: string): Promise<{ release(): Promise<void> }> {
  const guardian = await acquireGuardianRuntime({
    userDataHome: home,
    launcherRoot,
    launcher: `${launcher}-guardian`,
    takeover: true,
  })
  try {
    const alice = await acquireOpenAliceRuntimeLocks({
      userDataHome: home,
      launcherRoot,
      launcher,
      takeover: true,
    })
    return {
      release: async () => {
        await alice.release()
        await guardian.release()
      },
    }
  } catch (err) {
    await guardian.release()
    throw err
  }
}

async function waitForExit(child: ChildProcess, label: string): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await Promise.race([
    new Promise<void>((resolvePromise) => child.once('exit', () => resolvePromise())),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label} did not exit`)), 12_000)),
  ])
}

async function waitFor(label: string, check: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
  throw new Error(`timed out waiting for ${label}`)
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
