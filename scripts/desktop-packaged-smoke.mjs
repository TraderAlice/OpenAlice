#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { buildDesktopPackagedSmokePlan } from './desktop-packaged-smoke-plan.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const plan = buildDesktopPackagedSmokePlan(process.argv.slice(2), process.env)
const { keep, onboarding, realData, signed, skipBuild, skipPack } = plan.options

function printHelp() {
  console.log(`Usage: pnpm electron:smoke:packaged [options]

Build, pack, and launch the local unsigned OpenAlice.app with app.isPackaged=true.

Options:
  --skip-build   Reuse the existing dist/ backend and desktop JS
  --skip-pack    Reuse the existing dist/electron-app/OpenAlice.app
  --temp-data    Use isolated temporary data/workspace/global stores
  --real-data    Use real data explicitly (default; kept for compatibility)
  --onboarding   Build with first-run guide enabled, use temp data, run an
                 automated renderer onboarding smoke, then exit
  --signed       Allow local macOS code signing (default disables it)
  --keep         Keep the temporary smoke data directory after the app exits
  -h, --help     Show this help
`)
}

if (plan.options.help) {
  printHelp()
  process.exit(0)
}

if (plan.errors.length > 0) {
  for (const error of plan.errors) console.error(error)
  printHelp()
  process.exit(1)
}

for (const warning of plan.warnings) console.warn(warning)

function run(label, command, commandArgs, extraEnv = {}) {
  console.log(`\n[desktop-smoke] ${label}`)
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

function findPackagedApp() {
  const candidates = [
    'dist/electron-app/mac-arm64/OpenAlice.app',
    'dist/electron-app/mac/OpenAlice.app',
    'dist/electron-app/OpenAlice.app',
  ].map((p) => resolve(repoRoot, p))
  return candidates.find((p) => existsSync(join(p, 'Contents', 'MacOS', 'OpenAlice'))) ?? null
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((err) => {
        if (err) reject(err)
        else if (port) resolve(port)
        else reject(new Error('unable to allocate a temporary port'))
      })
    })
  })
}

if (process.platform !== 'darwin') {
  console.error('[desktop-smoke] packaged .app smoke currently runs on macOS only')
  process.exit(1)
}

if (!skipBuild) run('build desktop bundle', 'pnpm', ['electron:build'], plan.buildEnv)
if (!skipPack) {
  run('vendor managed runtime', 'pnpm', ['vendor:runtime'])
  run(
    signed ? 'pack signed app directory' : 'pack unsigned app directory',
    'pnpm',
    ['-F', '@traderalice/desktop', 'run', 'pack'],
    signed ? plan.buildEnv : { ...plan.buildEnv, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
  )
}

const appPath = findPackagedApp()
if (!appPath) {
  console.error('[desktop-smoke] OpenAlice.app not found under dist/electron-app; run without --skip-pack first')
  process.exit(1)
}

const smokeRoot = realData ? null : mkdtempSync(join(tmpdir(), 'openalice-desktop-smoke-'))
const smokeHome = smokeRoot ? join(smokeRoot, 'home') : null
const smokeWorkspaces = smokeRoot ? join(smokeRoot, 'workspaces') : null
const smokeGlobal = smokeRoot ? join(smokeRoot, 'global') : null

const pathAdditions = [
  process.env['OPENALICE_EXTRA_AGENT_PATH'],
  join(homedir(), 'Library', 'pnpm'),
  join(homedir(), '.npm-global', 'bin'),
  join(homedir(), '.local', 'bin'),
].filter(Boolean)

const env = {
  ...process.env,
  ...plan.launchEnv,
  PATH: [process.env['PATH'], ...pathAdditions].filter(Boolean).join(delimiter),
  OPENALICE_EXTRA_AGENT_PATH: pathAdditions.join(delimiter),
}

for (const key of plan.unsetLaunchEnv) delete env[key]

if (onboarding) {
  env.OPENALICE_UTA_PORT = String(await getAvailablePort())
}

if (!realData && smokeHome && smokeWorkspaces && smokeGlobal) {
  env.OPENALICE_HOME = smokeHome
  env.AQ_LAUNCHER_ROOT = smokeWorkspaces
  env.OPENALICE_GLOBAL_DIR = smokeGlobal
}

console.log('\n[desktop-smoke] launching packaged app')
console.log(`[desktop-smoke] app: ${appPath}`)
if (realData) {
  console.log('[desktop-smoke] data: real ~/.openalice (default)')
} else if (smokeHome && smokeWorkspaces && smokeGlobal) {
  console.log(`[desktop-smoke] data: ${smokeHome}`)
  console.log(`[desktop-smoke] workspaces: ${smokeWorkspaces}`)
  console.log(`[desktop-smoke] global provider keys: ${smokeGlobal}`)
}
if (onboarding) {
  console.log('[desktop-smoke] onboarding smoke: enabled; app exits automatically after the renderer probe')
  console.log(`[desktop-smoke] onboarding UTA port: ${env.OPENALICE_UTA_PORT}`)
} else {
  console.log('[desktop-smoke] close the app window or press Ctrl-C here to stop')
}

const child = spawn(join(appPath, 'Contents', 'MacOS', 'OpenAlice'), [], {
  cwd: repoRoot,
  stdio: 'inherit',
  env,
})

const cleanup = () => {
  if (keep || realData || !smokeRoot) return
  rmSync(smokeRoot, { recursive: true, force: true })
}

process.on('SIGINT', () => {
  child.kill('SIGTERM')
})
process.on('SIGTERM', () => {
  child.kill('SIGTERM')
})

child.on('exit', (code, signal) => {
  cleanup()
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})
