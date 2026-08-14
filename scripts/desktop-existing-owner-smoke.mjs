#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
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
const timeoutMs = 90_000

if (args.has('--help') || args.has('-h')) {
  console.log(`Usage: pnpm electron:smoke:existing-owner [--skip-build]

Start disposable dev and CLI Server owners, launch Electron against the same
home, and prove it opens the advertised loopback page without takeover.
`)
  process.exit(0)
}

function run(label, command, commandArgs) {
  console.log(`\n[existing-owner-smoke] ${label}`)
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

function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    return
  }
  child.kill('SIGTERM')
}

if (!skipBuild) {
  run('build Guardian runtime', 'pnpm', ['-F', '@traderalice/guardian-runtime', 'build'])
  run('build Electron main', 'pnpm', ['-F', '@traderalice/desktop', 'build'])
}

async function proveSurface(surface) {
  // Electron canonicalizes explicit data homes before startup. Canonicalize
  // the fixture root too so aliases such as macOS /var -> /private/var cannot
  // make one AliceProject look like two identities. On Windows, tmpdir() may
  // expose an 8.3 path (RUNNER~1) that realpathSync preserves even though the
  // Electron data-home path later expands it. Prefer the CI runner temp root,
  // or an ignored repo-local fallback, so both processes start with one stable
  // long-form AliceProject identity.
  const smokeBase = process.platform === 'win32'
    ? (process.env.RUNNER_TEMP?.trim() || join(repoRoot, 'dist', 'smoke'))
    : tmpdir()
  mkdirSync(smokeBase, { recursive: true })
  const smokeRoot = realpathSync(mkdtempSync(join(smokeBase, `openalice-existing-owner-${surface}-`)))
  const smokeHome = join(smokeRoot, 'home')
  const smokeWorkspaces = join(smokeRoot, 'workspaces')
  const electronUserData = join(smokeRoot, 'electron-user-data')
  const receiptPath = join(smokeRoot, 'existing-owner-handoff.json')
  mkdirSync(electronUserData, { recursive: true })
  const fixturePath = join(repoRoot, 'scripts', 'guardian', 'runtime-handoff-fixture.ts')
  console.log(`\n[existing-owner-smoke] ${surface} home → ${smokeHome}`)

  const fixture = spawn(process.execPath, ['--import', 'tsx', fixturePath], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OPENALICE_HOME: smokeHome,
      AQ_LAUNCHER_ROOT: smokeWorkspaces,
      OPENALICE_RUNTIME_FIXTURE_SURFACE: surface,
      OPENALICE_RUNTIME_FIXTURE_HEARTBEAT_MS: '50',
    },
  })
  let fixtureOutput = ''
  let fixtureExited = false
  fixture.stdout.on('data', (chunk) => {
    fixtureOutput += chunk.toString()
    process.stdout.write(chunk)
  })
  fixture.stderr.on('data', (chunk) => {
    fixtureOutput += chunk.toString()
    process.stderr.write(chunk)
  })
  fixture.once('exit', () => { fixtureExited = true })

  const readyDeadline = Date.now() + 10_000
  while (!fixtureOutput.includes('[handoff-fixture] ready') && Date.now() < readyDeadline) {
    if (fixture.exitCode !== null || fixture.signalCode !== null) {
      throw new Error(`${surface} fixture exited before ready:\n${fixtureOutput}`)
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
  if (!fixtureOutput.includes('[handoff-fixture] ready')) {
    throw new Error(`${surface} fixture did not become ready`)
  }
  const ready = fixtureOutput.match(/pid=(\d+) surface=\S+ web=(\S+)/)
  if (!ready) throw new Error(`${surface} fixture ready line was unparseable`)
  const fixturePid = Number(ready[1])
  const webUrl = ready[2]

  const child = spawn(pnpmCommand, pnpmArgs(['-F', '@traderalice/desktop', 'dev']), {
    cwd: join(repoRoot, 'apps', 'desktop'),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      OPENALICE_HOME: smokeHome,
      AQ_LAUNCHER_ROOT: smokeWorkspaces,
      OPENALICE_GLOBAL_DIR: join(smokeRoot, 'global'),
      OPENALICE_ELECTRON_SMOKE_EXISTING_OWNER: 'open-browser',
      OPENALICE_ELECTRON_SMOKE_USER_DATA: electronUserData,
      OPENALICE_ELECTRON_SMOKE_EXISTING_OWNER_RECEIPT: receiptPath,
      ELECTRON_ENABLE_LOGGING: '1',
    },
  })
  let output = ''
  const passed = await new Promise((resolvePromise) => {
    const timer = setTimeout(() => {
      console.error(output.split('\n').slice(-80).join('\n'))
      resolvePromise(false)
    }, timeoutMs)
    const finish = (ok) => {
      clearTimeout(timer)
      resolvePromise(ok)
    }
    const ownerAlive = () => {
      try {
        process.kill(fixturePid, 0)
        return true
      } catch {
        return false
      }
    }
    const onData = (chunk) => {
      output += chunk.toString()
      process.stdout.write(chunk)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', async (code) => {
      let receipt = null
      try {
        receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
      } catch {
        // The failure below includes the Electron output and exit code.
      }
      finish(
        code === 0
        && !fixtureExited
        && ownerAlive()
        && receipt?.action === 'open-browser'
        && receipt?.url === webUrl
        && receipt?.pid === fixturePid,
      )
    })
  })

  terminate(child)
  const ownerSurvived = !fixtureExited
  try {
    process.kill(fixturePid, 0)
  } catch {
    throw new Error(`${surface} owner pid ${fixturePid} is gone`)
  }
  terminate(fixture)
  await rm(smokeRoot, { recursive: true, force: true })
  if (!passed || !ownerSurvived) {
    throw new Error(`${surface} handoff smoke failed:\n${output.split('\n').slice(-40).join('\n')}`)
  }
  console.log(`[existing-owner-smoke] ${surface} owner pid ${fixturePid} survived`)
}

try {
  await proveSurface('dev')
  await proveSurface('cli-server')
  console.log('\n[existing-owner-smoke] PASS')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
