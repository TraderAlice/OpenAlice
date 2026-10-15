import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import {
  aliceProjectEnvironment,
  resolveAliceProjectIdentity,
} from './alice-project.ts'
import { buildManagedPiEnvForHome } from './launch-context.ts'
import { LOOPBACK } from './runtime-client.mjs'
import {
  inspectRuntimeBuildTools,
  runtimeBuildToolsError,
} from './runtime-deps.mjs'

const RUNTIME_ARTIFACTS = [
  'dist/main.js',
  'ui/dist/index.html',
  'services/uta/dist/uta.js',
  'services/connector/dist/connector.cjs',
  'packages/guardian-runtime/dist/index.js',
  'node_modules',
]
const MAX_PREPARE_ERROR_OUTPUT_BYTES = 64 * 1024

export function parseLocalStartArgs(argv) {
  const options = {
    appDir: null,
    homeRoot: null,
    port: 47331,
    openBrowser: true,
    prepare: true,
    rebuild: false,
    takeover: false,
    checkUpdates: true,
    waitMs: 120_000,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--no-open') {
      options.openBrowser = false
      continue
    }
    if (arg === '--skip-prepare') {
      options.prepare = false
      continue
    }
    if (arg === '--rebuild') {
      options.rebuild = true
      continue
    }
    if (arg === '--takeover') {
      options.takeover = true
      continue
    }
    if (arg === '--no-update-check') {
      options.checkUpdates = false
      continue
    }
    if (arg === '--app-dir') {
      options.appDir = requireValue(argv, ++index, arg)
      continue
    }
    if (arg === '--home') {
      options.homeRoot = requireValue(argv, ++index, arg)
      continue
    }
    if (arg === '--port') {
      options.port = parsePort(requireValue(argv, ++index, arg), arg)
      continue
    }
    if (arg === '--wait') {
      const seconds = Number(requireValue(argv, ++index, arg))
      if (!Number.isFinite(seconds) || seconds < 1 || seconds > 600) {
        throw new Error('--wait must be a number of seconds between 1 and 600')
      }
      options.waitMs = Math.round(seconds * 1_000)
      continue
    }
    if (arg?.startsWith('-')) throw new Error(`Unknown option: ${arg}`)
    if (options.appDir) throw new Error(`Unexpected argument: ${arg}`)
    options.appDir = arg ?? null
  }

  return options
}

export function buildLocalRuntimeEnv(env, options) {
  const aliceProject = resolveAliceProjectIdentity({
    home: options.homeRoot,
    appRoot: options.appDir,
    env,
    key: env['OPENALICE_PROJECT'] ?? env['OPENALICE_INSTANCE'] ?? 'default',
  })
  const runtimeEnv = {
    ...buildManagedPiEnvForHome(options.homeRoot, env),
    ...aliceProjectEnvironment(aliceProject),
    OPENALICE_HOME: options.homeRoot,
    OPENALICE_APP_HOME: options.appDir,
    OPENALICE_BIND_HOST: LOOPBACK,
    OPENALICE_WEB_TRANSPORT: 'http',
    OPENALICE_LAUNCHER: 'cli',
    OPENALICE_NODE_BINARY: options.nodeBinary,
  }
  if (options.port === undefined || options.port === null) {
    delete runtimeEnv.OPENALICE_WEB_PORT
  } else {
    runtimeEnv.OPENALICE_WEB_PORT = String(options.port)
  }
  delete runtimeEnv.OPENALICE_DISABLE_AUTH
  delete runtimeEnv.OPENALICE_TAKEOVER
  if (options.takeover) runtimeEnv.OPENALICE_TAKEOVER = '1'
  return runtimeEnv
}

export async function findOpenAliceRoot(startPath, options = {}) {
  const readFileImpl = options.readFileImpl ?? readFile
  let current = resolve(startPath)

  while (true) {
    try {
      const manifest = JSON.parse(await readFileImpl(join(current, 'package.json'), 'utf8'))
      if (manifest?.name === 'open-alice' && manifest?.scripts?.['build:server']) return current
    } catch {
      // Keep walking. A non-repository directory commonly has no package.json.
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  throw new Error(`Could not find an OpenAlice source checkout from ${resolve(startPath)}. Run this command inside the checkout or pass --app-dir <path>.`)
}

export async function prepareSourceCheckout(appDir, options, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout
  const env = dependencies.env ?? process.env
  const artifactsReady = dependencies.artifactsReady ?? hasRuntimeArtifacts
  if (!options.rebuild && await artifactsReady(appDir)) return { prepared: false }
  if (!options.prepare) {
    throw new Error('OpenAlice server artifacts are missing. Re-run without --skip-prepare, or run pnpm build:server in the checkout.')
  }

  const configuredPnpm = dependencies.pnpmBin ?? env['OPENALICE_PNPM_BIN']
  const platform = dependencies.platform ?? process.platform
  const pnpmBin = configuredPnpm ?? (platform === 'win32' ? 'pnpm.cmd' : 'pnpm')
  const runCommand = dependencies.runCommand ?? runChecked
  const compactOutput = env['OPENALICE_PREPARE_OUTPUT'] === 'compact'
  const commandOptions = { cwd: appDir, env, platform, output: compactOutput ? 'capture' : 'inherit' }

  const inspectBuildTools = dependencies.inspectBuildTools ?? inspectRuntimeBuildTools
  const buildTools = await inspectBuildTools({ platform, env })
  if (buildTools.supported && buildTools.missing.length > 0) {
    throw new Error(runtimeBuildToolsError(buildTools))
  }

  stdout.write(`${compactOutput ? 'Preparing the OpenAlice Server' : 'Preparing the local OpenAlice Runtime (Electron is excluded)'}...\n`)
  const installArgs = [
    'install',
    '--frozen-lockfile',
    '--filter=!@traderalice/desktop',
  ]
  const buildArgs = ['build:server']
  try {
    if (compactOutput) stdout.write('  Installing source dependencies...\n')
    await runCommand(pnpmBin, installArgs, commandOptions)
    if (compactOutput) stdout.write('  Building source Runtime...\n')
    await runCommand(pnpmBin, buildArgs, commandOptions)
  } catch (error) {
    if (configuredPnpm || error?.code !== 'ENOENT') throw error
    const corepackBin = platform === 'win32' ? 'corepack.cmd' : 'corepack'
    stdout.write('pnpm is not on PATH; using Corepack with the repository-pinned pnpm version.\n')
    try {
      await runCommand(corepackBin, ['pnpm', ...installArgs], commandOptions)
      if (compactOutput) stdout.write('  Building source Runtime...\n')
      await runCommand(corepackBin, ['pnpm', ...buildArgs], commandOptions)
    } catch (corepackError) {
      if (corepackError?.code === 'ENOENT') {
        throw new Error('Could not find pnpm or Corepack. Install pnpm 11, then retry.')
      }
      throw corepackError
    }
  }

  if (!await artifactsReady(appDir)) {
    throw new Error('OpenAlice server preparation completed without the expected runtime artifacts')
  }
  return { prepared: true }
}

export async function hasRuntimeArtifacts(appDir, options = {}) {
  const accessImpl = options.accessImpl ?? access
  try {
    await Promise.all(RUNTIME_ARTIFACTS.map((path) => accessImpl(join(appDir, path))))
    return true
  } catch {
    return false
  }
}

function runChecked(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const captureOutput = options.output === 'capture'
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: options.platform === 'win32',
      stdio: captureOutput ? ['inherit', 'pipe', 'pipe'] : 'inherit',
      windowsHide: true,
    })
    let outputTail = ''
    const rememberOutput = (chunk) => {
      outputTail = `${outputTail}${chunk}`.slice(-MAX_PREPARE_ERROR_OUTPUT_BYTES)
    }
    child.stdout?.setEncoding('utf8')
    child.stderr?.setEncoding('utf8')
    child.stdout?.on('data', rememberOutput)
    child.stderr?.on('data', rememberOutput)
    child.once('error', (error) => {
      if (error?.code === 'ENOENT') {
        const missing = new Error(`Could not find ${command}`)
        missing.code = 'ENOENT'
        rejectPromise(missing)
      } else {
        rejectPromise(error)
      }
    })
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise()
      else {
        const details = outputTail.trim()
        rejectPromise(new Error(`${command} ${args.join(' ')} failed (code=${String(code)}, signal=${String(signal)})${details ? `\n\n${details}` : ''}`))
      }
    })
  })
}

function requireValue(argv, index, flag) {
  const value = argv[index]
  if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`)
  return value
}

function parsePort(raw, flag) {
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${flag} must be an integer between 1 and 65535`)
  }
  return value
}
