import { spawn } from 'node:child_process'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  buildLocalRuntimeEnv,
  findOpenAliceRoot,
  prepareSourceCheckout,
} from './local-start.mjs'
import {
  createStartupSignalGuard,
  openBrowser,
  probeOpenAlice,
} from './runtime-client.mjs'
import {
  readRuntimeStatus,
  resolveOpenAliceHome,
  stopRuntimeServer,
} from './server-control.mjs'

const NULL_OUTPUT = Object.freeze({ write: () => undefined })

export async function inspectRuntime(options = {}, dependencies = {}) {
  const readStatus = dependencies.readStatus ?? readRuntimeStatus
  return readStatus({
    homeRoot: options.homeRoot,
    timeoutMs: options.waitMs,
  }, dependencies)
}

export async function startRuntime(options, dependencies = {}) {
  const env = dependencies.env ?? process.env
  const detached = dependencies.detached === true
  const emit = dependencies.emit ?? (() => undefined)
  const homeRoot = resolveOpenAliceHome(options.homeRoot, {
    env,
    homeDir: dependencies.homeDir,
  })
  const readStatus = dependencies.readStatus ?? readRuntimeStatus
  let status = await readStatus({ homeRoot, timeoutMs: 1_000 }, dependencies)

  if (status.owner?.surface === 'cli-server' && status.class === 'running') {
    return {
      outcome: 'already-running',
      mode: status.owner.mode ?? (detached ? 'detached' : 'foreground'),
      appDir: status.owner.launchRoot ?? null,
      homeRoot,
      logPath: null,
      status,
    }
  }
  if (status.owner?.surface === 'cli-server' && status.class === 'starting' && !options.takeover) {
    status = await waitForRuntimeReady(homeRoot, options.waitMs, {
      ...dependencies,
      readStatus,
    })
    return {
      outcome: 'already-running',
      mode: status.owner?.mode ?? (detached ? 'detached' : 'foreground'),
      appDir: status.owner?.launchRoot ?? null,
      homeRoot,
      logPath: null,
      status,
    }
  }
  if (status.class !== 'absent' && !options.takeover) {
    throw lifecycleError('EOWNED', formatOwnershipRefusal(status))
  }

  const requestedAppDir = options.appDir
    ?? env['OPENALICE_APP_HOME']?.trim()
    ?? env['OPENALICE_MANAGED_RUNTIME_PATH']?.trim()
    ?? dependencies.cwd
    ?? process.cwd()
  const resolveRoot = dependencies.resolveRoot ?? findOpenAliceRoot
  const appDir = await resolveRoot(requestedAppDir)
  const runtimeProvider = resolveRuntimeProvider(options.runtimeProvider, appDir, env)
  const prepareSource = dependencies.prepareSource ?? prepareSourceCheckout
  emit({ type: 'preparing', appDir, homeRoot })
  await prepareSource(appDir, options, {
    stdout: dependencies.progressOutput ?? NULL_OUTPUT,
    env,
  })

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
  runtimeEnv.OPENALICE_RUNTIME_PROVIDER = runtimeProvider.kind
  delete runtimeEnv.OPENALICE_RUNTIME_CONTENT_IDENTITY
  if (runtimeProvider.contentIdentity) {
    runtimeEnv.OPENALICE_RUNTIME_CONTENT_IDENTITY = runtimeProvider.contentIdentity
  }

  const logPath = resolve(options.logFile ?? resolve(homeRoot, 'logs', 'server.log'))
  runtimeEnv.OPENALICE_SERVER_LOG = logPath
  const spawnProcess = dependencies.spawnProcess ?? spawn
  let runtime
  if (detached) {
    const makeDir = dependencies.mkdirImpl ?? mkdir
    const openFile = dependencies.openFile ?? open
    await makeDir(dirname(logPath), { recursive: true })
    const logHandle = await openFile(logPath, 'a', 0o600)
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
  const startupSignals = createStartupSignalGuard(runtime, 'OpenAlice Runtime start')
  const earlyFailure = new Promise((_, reject) => {
    runtime.once('error', reject)
    const rejectExit = (code, signal) => {
      if (!ready) {
        reject(lifecycleError(
          'EEARLYEXIT',
          `OpenAlice Runtime exited before it was ready (code=${String(code)}, signal=${String(signal)})`,
        ))
      }
    }
    runtime.once('exit', rejectExit)
    if (runtime.exitCode !== undefined && (
      runtime.exitCode !== null
      || (runtime.signalCode !== undefined && runtime.signalCode !== null)
    )) {
      rejectExit(runtime.exitCode, runtime.signalCode)
    }
  })

  try {
    status = await Promise.race([
      waitForRuntimeReady(homeRoot, options.waitMs, {
        ...dependencies,
        readStatus,
        allowOwnerTransition: true,
        allowForeignOwnerTransition: options.takeover,
        expectedOwnerPid: runtime.pid,
        signal: readinessAbort.signal,
      }),
      earlyFailure,
      startupSignals.promise,
    ])
    ready = true
    const launch = {
      outcome: 'started',
      mode: detached ? 'detached' : 'foreground',
      appDir,
      homeRoot,
      logPath: detached ? logPath : null,
      status,
    }
    startupSignals.release()
    emit({ type: 'ready', result: launch })

    if (detached) return launch
    const exitCode = await holdRuntime(runtime)
    return {
      ...launch,
      outcome: 'exited',
      exitCode,
    }
  } catch (error) {
    readinessAbort.abort()
    startupSignals.release()
    runtime.kill('SIGTERM')
    if (detached) {
      const wrapped = lifecycleError(
        error?.code ?? 'ESTART',
        `${error instanceof Error ? error.message : String(error)}. See the Runtime log at ${logPath}`,
      )
      wrapped.cause = error
      wrapped.logPath = logPath
      throw wrapped
    }
    throw error
  }
}

function resolveRuntimeProvider(explicit, appDir, env) {
  if (explicit?.kind === 'bundle') {
    return {
      kind: 'bundle',
      contentIdentity: requireRuntimeContentIdentity(explicit.contentIdentity),
    }
  }
  if (explicit?.kind === 'source') {
    return { kind: 'source', contentIdentity: null }
  }
  const managedPath = env['OPENALICE_MANAGED_RUNTIME_PATH']?.trim()
  if (managedPath && resolve(managedPath) === resolve(appDir)) {
    return {
      kind: 'bundle',
      contentIdentity: requireRuntimeContentIdentity(
        env['OPENALICE_MANAGED_RUNTIME_CONTENT_IDENTITY'],
      ),
    }
  }
  return { kind: 'source', contentIdentity: null }
}

function requireRuntimeContentIdentity(value) {
  const identity = String(value ?? '').trim()
  if (!/^[a-f0-9]{16}$/.test(identity)) {
    throw lifecycleError(
      'ERUNTIMEIDENTITY',
      'The installed OpenAlice Runtime is missing its valid 16-character content identity. Reinstall or update OpenAlice.',
    )
  }
  return identity
}

export async function stopRuntime(options = {}, dependencies = {}) {
  const stop = dependencies.stopRuntime ?? stopRuntimeServer
  return stop({
    homeRoot: options.homeRoot,
    waitMs: options.waitMs,
  }, dependencies)
}

export async function openRuntime(options = {}, dependencies = {}) {
  const status = await inspectRuntime(options, dependencies)
  const url = status.endpoints?.web
  if (!url) {
    throw lifecycleError(
      'ERUNTIMENOTREADY',
      status.class === 'absent'
        ? `OpenAlice is not running for ${status.home}. Run "openalice up" first.`
        : `OpenAlice Runtime is ${status.class} and did not advertise a Web URL.`,
    )
  }
  if (!isLoopbackWebUrl(url)) {
    throw lifecycleError('EINVALIDENDPOINT', `OpenAlice Runtime advertised a non-loopback Web URL: ${url}`)
  }
  const probeRuntime = dependencies.probeRuntime ?? probeOpenAlice
  if (!await probeRuntime(url)) {
    throw lifecycleError('ERUNTIMENOTREADY', `OpenAlice Web UI is not ready at ${url}`)
  }
  const launchBrowser = dependencies.launchBrowser ?? openBrowser
  await launchBrowser(url)
  return { opened: true, url, status }
}

export function lifecycleError(code, message, exitCode = 1) {
  const error = new Error(message)
  error.code = code
  error.exitCode = exitCode
  return error
}

async function waitForRuntimeReady(homeRoot, timeoutMs, dependencies) {
  const readStatus = dependencies.readStatus ?? readRuntimeStatus
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)))
  const deadline = Date.now() + timeoutMs
  let lastStatus = null
  while (Date.now() < deadline) {
    if (dependencies.signal?.aborted) {
      throw lifecycleError('ECANCELLED', 'OpenAlice Runtime readiness wait was cancelled')
    }
    lastStatus = await readStatus({
      homeRoot,
      timeoutMs: Math.min(1_000, Math.max(100, deadline - Date.now())),
    }, dependencies)
    if (
      Number.isInteger(dependencies.expectedOwnerPid)
      && Number.isInteger(lastStatus.owner?.pid)
      && lastStatus.owner.pid !== dependencies.expectedOwnerPid
      && !dependencies.allowForeignOwnerTransition
    ) {
      throw lifecycleError('EOWNED', formatOwnershipRefusal(lastStatus))
    }
    if (
      lastStatus.class === 'running'
      && lastStatus.owner?.surface === 'cli-server'
      && (
        !Number.isInteger(dependencies.expectedOwnerPid)
        || lastStatus.owner.pid === dependencies.expectedOwnerPid
      )
      && isLoopbackWebUrl(lastStatus.endpoints?.web)
    ) {
      return lastStatus
    }
    if (
      !dependencies.allowOwnerTransition
      && (lastStatus.class === 'owned_elsewhere' || lastStatus.class === 'incompatible')
    ) {
      throw lifecycleError('EOWNED', formatOwnershipRefusal(lastStatus))
    }
    if (await sleepOrAbort(
      Math.min(100, Math.max(1, deadline - Date.now())),
      sleep,
      dependencies.signal,
    )) {
      throw lifecycleError('ECANCELLED', 'OpenAlice Runtime readiness wait was cancelled')
    }
  }
  throw lifecycleError(
    'ETIMEDOUT',
    `OpenAlice Runtime did not become ready within ${Math.ceil(timeoutMs / 1_000)}s (${lastStatus?.class ?? 'no status'})`,
  )
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

function isLoopbackWebUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

function holdRuntime(runtime) {
  if (runtime.exitCode !== undefined && (
    runtime.exitCode !== null
    || (runtime.signalCode !== undefined && runtime.signalCode !== null)
  )) {
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
