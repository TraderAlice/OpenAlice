#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { assertDesktopPackage } from './assert-desktop-package.mjs'
import {
  cleanupTemporaryDesktopPackageArtifact,
  createTemporaryDesktopPackageArtifact,
  DEFAULT_DESKTOP_PACKAGE_ROOT,
} from './desktop-package-artifact.mjs'
import { buildDesktopPackagedSmokePlan } from './desktop-packaged-smoke-plan.mjs'
import { packagedElectronExecutable } from './smoke-packaged-toolchain.mjs'
import { startWorkspaceAcceptanceAiMock } from './workspace-acceptance-ai-mock.mjs'

const repoRoot = resolve(import.meta.dirname, '..')
const plan = buildDesktopPackagedSmokePlan(process.argv.slice(2), process.env)
const {
  keep,
  keepPackage,
  onboarding,
  packageRoot: reusedPackageRoot,
  realData,
  signed,
  skipBuild,
  skipPack,
  tradingMode,
  workspaceAcceptance,
} = plan.options

function printHelp() {
  console.log(`Usage: pnpm electron:smoke:packaged [options]

Build, pack, and launch OpenAlice with app.isPackaged=true. Package-producing
runs use an isolated temporary output and remove it after the app exits.

Options:
  --skip-build   Reuse the existing dist/ backend and desktop JS
  --skip-pack    Reuse --package-root or dist/electron-app; never delete it
  --package-root <path>
                 Reuse an explicit package output (requires --skip-pack)
  --keep-package Keep the temporary package output created by this run
  --temp-data    Use isolated temporary data/workspace/global stores
  --real-data    Use real data explicitly (default; kept for compatibility)
  --onboarding   Build with first-run guide enabled, use temp data, run an
                 automated renderer onboarding smoke, then exit
  --trading-mode Use temp data, exercise lite -> readonly -> lite UTA lifecycle,
                 then exit
  --workspace-acceptance
                 Use temp data and prove a packaged Chat Workspace can execute
                 every injected CLI plus managed Pi using a CLI side effect
  --signed       Allow local macOS code signing (default disables it)
  --keep         Keep the temporary smoke data directory after the app exits
  -h, --help     Show this help
`)
}

function run(label, command, commandArgs, extraEnv = {}) {
  console.log(`\n[desktop-smoke] ${label}`)
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`${label} exited ${result.status ?? 'unknown'}${result.signal ? ` (${result.signal})` : ''}`)
  }
}

function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createNetServer()
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

function waitForPackagedApp(child, automated) {
  return new Promise((resolve, reject) => {
    let requestedSignal = null
    let timedOut = false
    const forwardSignal = (signal) => {
      requestedSignal = signal
      child.kill('SIGTERM')
    }
    const onSigint = () => forwardSignal('SIGINT')
    const onSigterm = () => forwardSignal('SIGTERM')
    process.once('SIGINT', onSigint)
    process.once('SIGTERM', onSigterm)

    const timeout = automated
      ? setTimeout(() => {
          timedOut = true
          console.error('[desktop-smoke] automated packaged smoke timed out')
          child.kill('SIGTERM')
        }, 180_000)
      : null
    timeout?.unref()

    const finish = () => {
      if (timeout) clearTimeout(timeout)
      process.off('SIGINT', onSigint)
      process.off('SIGTERM', onSigterm)
    }
    child.once('error', (error) => {
      finish()
      reject(error)
    })
    child.once('exit', (code, signal) => {
      finish()
      resolve({ code, signal, requestedSignal, timedOut })
    })
  })
}

async function main() {
  if (plan.options.help) {
    printHelp()
    return { code: 0, signal: null }
  }
  if (plan.errors.length > 0) {
    for (const error of plan.errors) console.error(error)
    printHelp()
    return { code: 1, signal: null }
  }
  for (const warning of plan.warnings) console.warn(warning)

  if (process.platform !== 'darwin' && !workspaceAcceptance) {
    console.error('[desktop-smoke] packaged .app smoke currently runs on macOS only')
    return { code: 1, signal: null }
  }

  let aiMock = null
  let packageArtifact = null
  let smokeRoot = null
  let finalCode = 0
  let signalToRaise = null

  try {
    aiMock = onboarding || workspaceAcceptance ? await startWorkspaceAcceptanceAiMock() : null
    if (aiMock) {
      if (onboarding) {
        plan.buildEnv.VITE_OPENALICE_ONBOARDING_AI_BASE_URL = aiMock.baseUrl
        plan.launchEnv.OPENALICE_ONBOARDING_AI_BASE_URL = aiMock.baseUrl
      }
      if (workspaceAcceptance) {
        plan.launchEnv.OPENALICE_WORKSPACE_ACCEPTANCE_AI_BASE_URL = aiMock.baseUrl
      }
      console.log(`[desktop-smoke] AI mock: ${aiMock.baseUrl}`)
    }

    if (!skipBuild) run('build desktop bundle', 'pnpm', ['electron:build'], plan.buildEnv)

    let packageRoot = reusedPackageRoot
      ? resolve(repoRoot, reusedPackageRoot)
      : DEFAULT_DESKTOP_PACKAGE_ROOT
    if (!skipPack) {
      run('vendor managed runtime', 'pnpm', ['vendor:runtime'])
      packageArtifact = createTemporaryDesktopPackageArtifact()
      packageRoot = packageArtifact.packageRoot
      console.log(`[desktop-smoke] package: ${packageRoot} (temporary; auto-clean on exit)`)
      run(
        signed ? 'pack signed app directory' : 'pack unsigned app directory',
        'pnpm',
        [
          '-F',
          '@traderalice/desktop',
          'exec',
          'electron-builder',
          '--dir',
          '--projectDir',
          '../..',
          '--publish',
          'never',
          `--config.directories.output=${packageRoot}`,
        ],
        signed ? plan.buildEnv : { ...plan.buildEnv, CSC_IDENTITY_AUTO_DISCOVERY: 'false' },
      )
    } else {
      console.log(`[desktop-smoke] package: ${packageRoot} (reused; never auto-cleaned)`)
    }

    const packageResult = assertDesktopPackage({ packageRoot })
    const appPath = packageResult.appRoot
      ? packagedElectronExecutable(packageResult.appRoot, packageResult.platform)
      : null
    if (!packageResult.ok || !appPath || !existsSync(appPath)) {
      throw new Error([
        ...packageResult.errors,
        '[desktop-smoke] packaged OpenAlice executable not found; run without --skip-pack first',
      ].join('\n'))
    }

    smokeRoot = realData ? null : mkdtempSync(join(tmpdir(), 'openalice-desktop-smoke-'))
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

    if (onboarding || tradingMode || workspaceAcceptance) {
      env.OPENALICE_UTA_PORT = String(await getAvailablePort())
    }
    if (!realData && smokeHome && smokeWorkspaces && smokeGlobal) {
      env.OPENALICE_HOME = smokeHome
      env.AQ_LAUNCHER_ROOT = smokeWorkspaces
      env.OPENALICE_GLOBAL_DIR = smokeGlobal
    }

    const receiptPath = workspaceAcceptance
      ? process.env['OPENALICE_SMOKE_RECEIPT_PATH']?.trim() || join(smokeRoot, 'workspace-acceptance-receipt.json')
      : null
    if (receiptPath) env.OPENALICE_SMOKE_RECEIPT_PATH = receiptPath

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
    } else if (tradingMode) {
      console.log('[desktop-smoke] trading-mode smoke: lite -> readonly -> lite; app exits automatically')
      console.log(`[desktop-smoke] trading-mode UTA port: ${env.OPENALICE_UTA_PORT}`)
    } else if (workspaceAcceptance) {
      console.log('[desktop-smoke] workspace acceptance: packaged CLI contract + managed Pi side effect')
      console.log(`[desktop-smoke] acceptance receipt: ${receiptPath}`)
      console.log(`[desktop-smoke] acceptance UTA port: ${env.OPENALICE_UTA_PORT}`)
    } else {
      console.log('[desktop-smoke] close the app window or press Ctrl-C here to stop')
    }

    const child = spawn(appPath, [], {
      cwd: repoRoot,
      stdio: 'inherit',
      env,
    })
    const exit = await waitForPackagedApp(child, onboarding || tradingMode || workspaceAcceptance)
    signalToRaise = exit.requestedSignal
    finalCode = exit.timedOut ? 1 : exit.code ?? (exit.signal ? 1 : 0)

    if (!exit.signal && workspaceAcceptance && finalCode === 0) {
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'))
      const failedChecks = Object.entries(receipt.checks ?? {})
        .filter(([, ok]) => ok !== true)
        .map(([name]) => name)
      if (failedChecks.length > 0) throw new Error(`failed receipt checks: ${failedChecks.join(', ')}`)
      if (aiMock.stats.acceptanceToolTurns < 1 || aiMock.stats.acceptanceFinalTurns < 1) {
        throw new Error(`mock did not observe both Pi turns: ${JSON.stringify(aiMock.stats)}`)
      }
      console.log(`[desktop-smoke] workspace acceptance receipt: ${JSON.stringify(receipt)}`)
    }
  } catch (error) {
    finalCode = 1
    console.error(`[desktop-smoke] ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    aiMock?.server.close()
    if (smokeRoot && !keep) {
      try {
        rmSync(smokeRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 })
      } catch (error) {
        finalCode = 1
        console.error(`[desktop-smoke] failed to clean temporary data ${smokeRoot}: ${error instanceof Error ? error.message : String(error)}`)
      }
    } else if (smokeRoot && keep) {
      console.log(`[desktop-smoke] kept temporary data: ${smokeRoot}`)
    }

    const packageCleanup = cleanupTemporaryDesktopPackageArtifact(packageArtifact, { keep: keepPackage })
    if (packageCleanup.kept) {
      console.log(`[desktop-smoke] kept temporary package: ${packageArtifact.packageRoot}`)
    } else if (packageCleanup.cleaned) {
      console.log(`[desktop-smoke] cleaned temporary package: ${packageArtifact.packageRoot}`)
    } else if (packageCleanup.error) {
      finalCode = 1
      console.error(
        `[desktop-smoke] failed to clean temporary package ${packageArtifact.packageRoot}: ` +
        `${packageCleanup.error instanceof Error ? packageCleanup.error.message : String(packageCleanup.error)}`,
      )
    }
  }

  return { code: finalCode, signal: signalToRaise }
}

const result = await main()
if (result.signal) process.kill(process.pid, result.signal)
process.exit(result.code)
