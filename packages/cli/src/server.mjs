import { spawn } from 'node:child_process'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  buildLocalRuntimeEnv,
  findOpenAliceRoot,
  parseLocalStartArgs,
  prepareSourceCheckout,
} from './local-start.mjs'
import {
  createStartupSignalGuard,
} from './runtime-client.mjs'
import {
  formatRuntimeStatus,
  readRuntimeStatus,
  resolveOpenAliceHome,
  stopRuntimeServer,
} from './server-control.mjs'

export function parseServerArgs(action, argv) {
  if (action === 'run' || action === 'start') {
    const { argv: startArgv, value: logFile } = takeValueOption(argv, '--log')
    const options = parseLocalStartArgs(startArgv)
    return { ...options, openBrowser: false, logFile }
  }
  if (action !== 'status' && action !== 'stop') {
    throw new Error(`Unknown server command: ${String(action)}`)
  }

  const options = {
    homeRoot: null,
    json: false,
    port: 47331,
    waitMs: action === 'stop' ? 15_000 : 2_000,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') continue
    if (arg === '--json') {
      options.json = true
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
    throw new Error(arg?.startsWith('-') ? `Unknown option: ${arg}` : `Unexpected argument: ${arg}`)
  }
  return options
}

export async function runServerCommand(action, options, dependencies = {}) {
  if (action === 'run') return startRuntimeServer(options, { ...dependencies, detached: false })
  if (action === 'start') return startRuntimeServer(options, { ...dependencies, detached: true })
  if (action === 'status') return showServerStatus(options, dependencies)
  if (action === 'stop') return stopServer(options, dependencies)
  throw new Error(`Unknown server command: ${String(action)}`)
}

export async function startRuntimeServer(options, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout
  const env = dependencies.env ?? process.env
  const detached = dependencies.detached === true
  const homeRoot = resolveOpenAliceHome(options.homeRoot, {
    env,
    homeDir: dependencies.homeDir,
  })
  const readStatus = dependencies.readStatus ?? readRuntimeStatus
  let status = await readStatus({ homeRoot, timeoutMs: 1_000 }, dependencies)

  if (status.owner?.surface === 'cli-server' && status.class === 'running') {
    stdout.write(`OpenAlice Server is already running at ${status.endpoints.web ?? `http://127.0.0.1:${options.port}`}\n`)
    return 0
  }
  if (status.owner?.surface === 'cli-server' && status.class === 'starting' && !options.takeover) {
    status = await waitForServerReady(homeRoot, options.waitMs, { ...dependencies, readStatus })
    stdout.write(`OpenAlice Server is already running at ${status.endpoints.web}\n`)
    return 0
  }
  if (status.class !== 'absent' && !options.takeover) {
    throw new Error(formatOwnershipRefusal(status))
  }

  const resolveRoot = dependencies.resolveRoot ?? findOpenAliceRoot
  const appDir = await resolveRoot(options.appDir ?? dependencies.cwd ?? process.cwd())
  const prepareSource = dependencies.prepareSource ?? prepareSourceCheckout
  await prepareSource(appDir, options, { stdout, env })

  const nodeBinary = dependencies.nodeBinary ?? process.execPath
  const runtimeEnv = buildLocalRuntimeEnv(env, {
    appDir,
    homeRoot,
    nodeBinary,
    port: options.port,
    takeover: options.takeover,
  })
  runtimeEnv.OPENALICE_LAUNCHER = 'cli-server'
  runtimeEnv.OPENALICE_SERVER_MODE = detached ? 'detached' : 'foreground'

  const logPath = resolve(options.logFile ?? resolve(homeRoot, 'logs', 'server.log'))
  runtimeEnv.OPENALICE_SERVER_LOG = logPath
  const spawnProcess = dependencies.spawnProcess ?? spawn
  let logHandle = null
  let runtime
  if (detached) {
    const makeDir = dependencies.mkdirImpl ?? mkdir
    const openFile = dependencies.openFile ?? open
    await makeDir(dirname(logPath), { recursive: true })
    logHandle = await openFile(logPath, 'a', 0o600)
    try {
      runtime = spawnProcess(nodeBinary, ['scripts/guardian/prod.mjs'], {
        cwd: appDir,
        env: runtimeEnv,
        detached: true,
        stdio: ['ignore', logHandle.fd, logHandle.fd],
        windowsHide: true,
      })
      runtime.unref()
    } finally {
      await logHandle.close()
    }
  } else {
    runtime = spawnProcess(nodeBinary, ['scripts/guardian/prod.mjs'], {
      cwd: appDir,
      env: runtimeEnv,
      stdio: 'inherit',
      windowsHide: true,
    })
  }

  let ready = false
  const readinessAbort = new AbortController()
  const startupSignals = createStartupSignalGuard(runtime, 'OpenAlice Server start')
  const earlyFailure = new Promise((_, reject) => {
    runtime.once('error', reject)
    const rejectExit = (code, signal) => {
      if (!ready) {
        reject(new Error(`OpenAlice Server exited before it was ready (code=${String(code)}, signal=${String(signal)})`))
      }
    }
    runtime.once('exit', rejectExit)
    if (runtime.exitCode !== undefined && (
      runtime.exitCode !== null ||
      (runtime.signalCode !== undefined && runtime.signalCode !== null)
    )) {
      rejectExit(runtime.exitCode, runtime.signalCode)
    }
  })
  try {
    status = await Promise.race([
      waitForServerReady(homeRoot, options.waitMs, {
        ...dependencies,
        readStatus,
        allowOwnerTransition: options.takeover,
        signal: readinessAbort.signal,
      }),
      earlyFailure,
      startupSignals.promise,
    ])
    ready = true
    const runtimeExit = detached ? null : holdRuntime(runtime)
    startupSignals.release()
    stdout.write(`OpenAlice source: ${appDir}\n`)
    stdout.write(`OpenAlice home: ${homeRoot}\n`)
    stdout.write(`OpenAlice Server: ${status.endpoints.web}\n`)
    if (detached) {
      stdout.write(`OpenAlice Server log: ${logPath}\n`)
      stdout.write('The Server will keep running after this command exits. Use "openalice server stop" to stop it.\n')
      return 0
    }
    stdout.write('The Server stays active until this command exits. Press Ctrl+C to stop it.\n')
    return await runtimeExit
  } catch (error) {
    readinessAbort.abort()
    startupSignals.release()
    runtime.kill('SIGTERM')
    if (detached) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}. See the Server log at ${logPath}`, { cause: error })
    }
    throw error
  }
}

export async function showServerStatus(options, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout
  const status = await (dependencies.readStatus ?? readRuntimeStatus)({
    homeRoot: options.homeRoot,
    timeoutMs: options.waitMs,
  }, dependencies)
  stdout.write(options.json ? `${JSON.stringify(status)}\n` : formatRuntimeStatus(status))
  return 0
}

export async function stopServer(options, dependencies = {}) {
  const stdout = dependencies.stdout ?? process.stdout
  const stop = dependencies.stopRuntime ?? stopRuntimeServer
  const result = await stop({ homeRoot: options.homeRoot, waitMs: options.waitMs }, dependencies)
  if (options.json) {
    stdout.write(`${JSON.stringify({ stopped: result.stopped, status: result.status })}\n`)
  } else if (result.stopped) {
    stdout.write(`OpenAlice Server stopped (${result.status.home})\n`)
  } else {
    stdout.write(`OpenAlice Server is not running (${result.status.home})\n`)
  }
  return 0
}

export function formatServerHelp() {
  return `Usage:
  openalice server run [path] [options]
  openalice server start [path] [options]
  openalice server status [options]
  openalice server stop [options]

Runs OpenAlice on local loopback without opening a browser. "run" owns the
Runtime in the foreground; "start" detaches after Guardian and Alice are ready.

Run/start options:
  --app-dir <path>   OpenAlice checkout (default: current directory or parent)
  --home <path>      User-state root (default: OPENALICE_HOME or ~/.openalice)
  --port <port>      Local web port (default: 47331)
  --log <path>       Detached Server log (default: <home>/logs/server.log)
  --rebuild          Reinstall dependencies and rebuild server artifacts
  --skip-prepare     Fail instead of installing/building missing artifacts
  --takeover         Replace the recorded Guardian owner tree
  --wait <seconds>   Readiness timeout, 1-600 (default: 120)

Status/stop options:
  --home <path>      User-state root (default: OPENALICE_HOME or ~/.openalice)
  --wait <seconds>   Control timeout (status: 2, stop: 15)
  --json             Print stable machine-readable output
  -h, --help         Show this help
`
}

async function waitForServerReady(homeRoot, timeoutMs, dependencies) {
  const readStatus = dependencies.readStatus ?? readRuntimeStatus
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)))
  const deadline = Date.now() + timeoutMs
  let lastStatus = null
  while (Date.now() < deadline) {
    if (dependencies.signal?.aborted) return null
    lastStatus = await readStatus({ homeRoot, timeoutMs: Math.min(1_000, Math.max(100, deadline - Date.now())) }, dependencies)
    if (lastStatus.class === 'running' && lastStatus.owner?.surface === 'cli-server') return lastStatus
    if (
      !dependencies.allowOwnerTransition
      && (lastStatus.class === 'owned_elsewhere' || lastStatus.class === 'incompatible')
    ) {
      throw new Error(formatOwnershipRefusal(lastStatus))
    }
    const aborted = await sleepOrAbort(
      Math.min(100, Math.max(1, deadline - Date.now())),
      sleep,
      dependencies.signal,
    )
    if (aborted) return null
  }
  throw new Error(`OpenAlice Server did not become ready within ${Math.ceil(timeoutMs / 1_000)}s (${lastStatus?.class ?? 'no status'})`)
}

async function sleepOrAbort(ms, sleep, signal) {
  if (!signal) {
    await sleep(ms)
    return false
  }
  if (signal.aborted) return true
  let onAbort
  const aborted = new Promise((resolvePromise) => {
    onAbort = () => resolvePromise(true)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([
      Promise.resolve(sleep(ms)).then(() => false),
      aborted,
    ])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

function formatOwnershipRefusal(status) {
  const owner = status.owner
  if (owner) {
    return `OpenAlice ${owner.surface} already owns ${status.home} as pid ${owner.pid}. Re-run with --takeover only if replacing it is intentional.`
  }
  return `OpenAlice Runtime at ${status.home} is ${status.class}. Re-run with --takeover only if replacing it is intentional.`
}

function holdRuntime(runtime) {
  if (runtime.exitCode !== undefined && (runtime.exitCode !== null || runtime.signalCode !== null)) {
    return Promise.resolve(runtime.exitCode ?? 0)
  }
  return new Promise((resolvePromise) => {
    let requestedStop = false
    const stop = () => {
      requestedStop = true
      runtime.kill('SIGTERM')
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    runtime.once('exit', (code) => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      resolvePromise(requestedStop ? 0 : code ?? 0)
    })
  })
}

function takeValueOption(argv, flag) {
  const output = []
  let value = null
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flag) {
      output.push(argv[index])
      continue
    }
    if (value !== null) throw new Error(`${flag} may only be provided once`)
    value = requireValue(argv, ++index, flag)
  }
  return { argv: output, value }
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
