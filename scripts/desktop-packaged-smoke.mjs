#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const args = new Set(process.argv.slice(2))
const skipBuild = args.has('--skip-build')
const skipPack = args.has('--skip-pack')
const keep = args.has('--keep')
const tempData = args.has('--temp-data')
const realDataFlag = args.has('--real-data')
const signed = args.has('--signed')
const help = args.has('--help') || args.has('-h')
const knownArgs = new Set(['--skip-build', '--skip-pack', '--keep', '--temp-data', '--real-data', '--signed', '--help', '-h'])
const unknownArgs = [...args].filter((arg) => !knownArgs.has(arg))

function printHelp() {
  console.log(`Usage: pnpm electron:smoke:packaged [options]

Build, pack, and launch the local unsigned OpenAlice.app with app.isPackaged=true.

Options:
  --skip-build   Reuse the existing dist/ backend and desktop JS
  --skip-pack    Reuse the existing dist/electron-app/OpenAlice.app
  --temp-data    Use isolated temporary data/workspace/global stores
  --real-data    Use real data explicitly (default; kept for compatibility)
  --signed       Allow local macOS code signing (default disables it)
  --keep         Keep the temporary smoke data directory after the app exits
  -h, --help     Show this help
`)
}

if (help) {
  printHelp()
  process.exit(0)
}

if (unknownArgs.length > 0) {
  console.error(`[desktop-smoke] unknown option(s): ${unknownArgs.join(', ')}`)
  printHelp()
  process.exit(1)
}

if (tempData && realDataFlag) {
  console.error('[desktop-smoke] choose either --temp-data or --real-data, not both')
  process.exit(1)
}

const realData = !tempData

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

if (process.platform !== 'darwin') {
  console.error('[desktop-smoke] packaged .app smoke currently runs on macOS only')
  process.exit(1)
}

if (!skipBuild) run('build desktop bundle', 'pnpm', ['electron:build'])
if (!skipPack) {
  run(
    signed ? 'pack signed app directory' : 'pack unsigned app directory',
    'pnpm',
    ['-F', '@traderalice/desktop', 'run', 'pack'],
    signed ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
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
  PATH: [process.env['PATH'], ...pathAdditions].filter(Boolean).join(delimiter),
  OPENALICE_EXTRA_AGENT_PATH: pathAdditions.join(delimiter),
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
console.log('[desktop-smoke] close the app window or press Ctrl-C here to stop')

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
