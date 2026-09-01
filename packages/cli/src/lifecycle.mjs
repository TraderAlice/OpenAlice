import { spawn } from 'node:child_process'
import { fstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

import {
  reconcileActivation,
  resolveActivationContext,
  rollbackFailedActivation,
} from './activation-runtime.mjs'

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
import {
  buildBunRuntimeEnvironment,
  buildExternalAgentRuntimeEnvironment,
  bunGuardianProcessSpec,
  isBunStandalone,
  resolveBunResourceRoot,
} from './bun-standalone.mjs'

const NULL_OUTPUT = Object.freeze({ write: () => undefined })

export async function inspectRuntime(options = {}, dependencies = {}) {
  const readStatus = dependencies.readStatus ?? readRuntimeStatus
  const status = await readStatus({
    homeRoot: options.homeRoot,
    timeoutMs: options.waitMs,
  }, dependencies)
  const activation = await resolveActivationContext(dependencies.env ?? process.env, dependencies)
  return reconcileActivation(status, activation, dependencies, { confirm: false })
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
  const activation = await resolveActivationContext(env, dependencies)
  const railwayFenceFd = (dependencies.resolveRailwayFenceFd ?? resolveRailwayFenceFd)(env, homeRoot)
  const railwayFenceClaimed = Boolean(
    env['OPENALICE_RAILWAY_ENTRYPOINT_OWNER']
    || env['OPENALICE_RAILWAY_FENCE_FD']
    || env['OPENALICE_SERVICE_MANAGER']?.trim() === 'railway',
  )
  if (railwayFenceClaimed && railwayFenceFd === null) {
    throw lifecycleError(
      'ERAILWAYFENCE',
      'Railway may start the Runtime only through its image entrypoint with the locked Volume capability',
    )
  }
  let status = await readStatus({ homeRoot, timeoutMs: 1_000 }, dependencies)
  if (railwayFenceFd !== null && status.class !== 'absent') {
    throw lifecycleError(
      'ERAILWAYCUTOVER',
      `The Railway Volume fence is held, but retained Runtime ownership at ${homeRoot} is not eligible for automatic handoff. Verify the previous deployment is stopped, then quarantine only state/guardian.lock, state/runtime.lock, workspaces/state/runtime.lock, and data/state/config-bootstrap.lock from this exact Project Home; do not clear the Project or Volume.`,
    )
  }

  if (status.owner?.surface === 'cli-server' && status.class === 'running') {
    status = await reconcileActivation(status, activation, dependencies)
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
    status = await reconcileActivation(status, activation, dependencies)
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

  const standalone = isBunStandalone()
  const launchEnv = standalone
    ? buildExternalAgentRuntimeEnvironment(env)
    : env
  const requestedAppDir = options.appDir
    ?? env['OPENALICE_APP_HOME']?.trim()
    ?? env['OPENALICE_MANAGED_RUNTIME_PATH']?.trim()
    ?? dependencies.cwd
    ?? process.cwd()
  const resolveRoot = dependencies.resolveRoot ?? findOpenAliceRoot
  const appDir = standalone
    ? resolveBunResourceRoot(env, dependencies.runtimeExecutable ?? process.execPath)
    : await resolveRoot(requestedAppDir)
  const runtimeProvider = resolveRuntimeProvider(
    options.runtimeProvider,
    appDir,
    env,
    activation.contentIdentity,
  )
  const prepareSource = dependencies.prepareSource ?? prepareSourceCheckout
  emit({ type: 'preparing', appDir, homeRoot })
  if (!standalone) {
    await prepareSource(appDir, options, {
      stdout: dependencies.progressOutput ?? NULL_OUTPUT,
      env,
    })
  }

  const nodeBinary = dependencies.nodeBinary ?? process.execPath
  let runtimeEnv = buildLocalRuntimeEnv(launchEnv, {
    appDir,
    homeRoot,
    nodeBinary,
    port: options.port,
    takeover: options.takeover,
  })
  delete runtimeEnv.OPENALICE_RAILWAY_ENTRYPOINT_OWNER
  delete runtimeEnv.OPENALICE_RAILWAY_FENCE_FD
  if (railwayFenceFd !== null) runtimeEnv.OPENALICE_RAILWAY_FENCE_FD = '3'
  runtimeEnv.OPENALICE_LAUNCHER = 'cli-server'
  runtimeEnv.OPENALICE_SERVER_MODE = detached ? 'detached' : 'foreground'
  runtimeEnv.OPENALICE_RUNTIME_PROVIDER = runtimeProvider.kind
  if (standalone) {
    runtimeEnv = buildBunRuntimeEnvironment(
      runtimeEnv,
      appDir,
      dependencies.runtimeExecutable ?? process.execPath,
    )
  }
  delete runtimeEnv.OPENALICE_RUNTIME_CONTENT_IDENTITY
  if (runtimeProvider.contentIdentity) {
    runtimeEnv.OPENALICE_RUNTIME_CONTENT_IDENTITY = runtimeProvider.contentIdentity
  }

  const logPath = resolve(options.logFile ?? resolve(homeRoot, 'logs', 'server.log'))
  runtimeEnv.OPENALICE_SERVER_LOG = logPath
  const spawnProcess = dependencies.spawnProcess ?? spawn
  const guardianSpec = standalone
    ? bunGuardianProcessSpec(dependencies.runtimeExecutable ?? process.execPath)
    : { cmd: nodeBinary, args: ['scripts/guardian/prod.mjs'] }
  let runtime
  if (detached) {
    const makeDir = dependencies.mkdirImpl ?? mkdir
    const openFile = dependencies.openFile ?? open
    await makeDir(dirname(logPath), { recursive: true })
    const logHandle = await openFile(logPath, 'a', 0o600)
    try {
      runtime = spawnProcess(guardianSpec.cmd, guardianSpec.args, {
        cwd: appDir,
        env: runtimeEnv,
        detached: true,
        stdio: railwayFenceFd === null
          ? ['ignore', logHandle.fd, logHandle.fd]
          : ['ignore', logHandle.fd, logHandle.fd, railwayFenceFd],
        windowsHide: true,
      })
      runtime.unref()
    } finally {
      await logHandle.close()
    }
  } else {
    runtime = spawnProcess(guardianSpec.cmd, guardianSpec.args, {
      cwd: appDir,
      env: runtimeEnv,
      stdio: railwayFenceFd === null
        ? 'inherit'
        : ['inherit', 'inherit', 'inherit', railwayFenceFd],
      windowsHide: true,
    })
  }

  let ready = false
  const readinessAbort = new AbortController()
  const signalSource = dependencies.signalSource ?? process
  const startupSignals = createStartupSignalGuard(runtime, 'OpenAlice Runtime start', { signalSource })
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
    status = await reconcileActivation(status, activation, dependencies)
    const launch = {
      outcome: 'started',
      mode: detached ? 'detached' : 'foreground',
      appDir,
      homeRoot,
      logPath: detached ? logPath : null,
      status,
    }
    if (detached) {
      startupSignals.release()
      emit({ type: 'ready', result: launch })
      return launch
    }
    const runtimeExit = holdRuntime(runtime, {
      signalSource,
      releaseStartupSignals: startupSignals.release,
    })
    emit({ type: 'ready', result: launch })
    const exitCode = await runtimeExit
    return {
      ...launch,
      outcome: 'exited',
      exitCode,
    }
  } catch (error) {
    readinessAbort.abort()
    startupSignals.release()
    runtime.kill('SIGTERM')
    const rollback = await rollbackFailedActivation(activation, error, dependencies)
    const rollbackMessage = rollback
      ? ` The failed direct-install activation was rolled back to ${rollback.restoredRelease}. Run openalice again to start the restored release. User data was not changed.`
      : ''
    if (detached) {
      const wrapped = lifecycleError(
        error?.code ?? 'ESTART',
        `${error instanceof Error ? error.message : String(error)}.${rollbackMessage} See the Runtime log at ${logPath}`,
      )
      wrapped.cause = error
      wrapped.logPath = logPath
      if (rollback) wrapped.rollback = rollback
      throw wrapped
    }
    if (rollback) {
      const wrapped = lifecycleError(
        error?.code ?? 'ESTART',
        `${error instanceof Error ? error.message : String(error)}.${rollbackMessage}`,
      )
      wrapped.cause = error
      wrapped.rollback = rollback
      throw wrapped
    }
    throw error
  }
}

function resolveRuntimeProvider(explicit, appDir, env, installedIdentity = null) {
  if (explicit?.kind === 'bun' || isBunStandalone()) {
    const explicitIdentity = typeof explicit?.contentIdentity === 'string'
      ? explicit.contentIdentity.trim()
      : explicit?.contentIdentity
    return {
      kind: 'bun',
      contentIdentity: explicitIdentity
        || env['OPENALICE_RUNTIME_CONTENT_IDENTITY']?.trim()
        || installedIdentity
        || null,
    }
  }
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

function resolveRailwayFenceFd(env, homeRoot) {
  const serviceId = env['RAILWAY_SERVICE_ID']?.trim()
  const rawFd = env['OPENALICE_RAILWAY_FENCE_FD']?.trim()
  const fd = Number(rawFd)
  if (
    env['OPENALICE_RAILWAY_ENTRYPOINT_OWNER'] !== '1'
    || env['OPENALICE_SERVICE_MANAGER']?.trim() !== 'railway'
    || !env['RAILWAY_ENVIRONMENT_ID']?.trim()
    || !/^[A-Za-z0-9-]{1,128}$/.test(serviceId ?? '')
    || env['OPENALICE_MACHINE_ID']?.trim() !== `railway-service-${serviceId}`
    || !/^[0-9]{1,4}$/.test(rawFd ?? '')
    || !Number.isInteger(fd)
    || fd < 3
  ) return null
  const fencePath = railwayRuntimeFencePath(env, homeRoot)
  if (!fencePath) return null
  try {
    const inherited = fstatSync(fd)
    const expected = statSync(fencePath)
    return inherited.isDirectory()
      && expected.isDirectory()
      && inherited.dev === expected.dev
      && inherited.ino === expected.ino
      && inheritedFdHoldsExclusiveFlock(fd)
      ? fd
      : null
  } catch {
    return null
  }
}

function railwayRuntimeFencePath(env, homeRoot) {
  const serviceId = env['RAILWAY_SERVICE_ID']?.trim()
  if (!/^[A-Za-z0-9-]{1,128}$/.test(serviceId ?? '')) return null
  const configuredRoots = [
    env['RAILWAY_VOLUME_MOUNT_PATH']?.trim(),
    env['OPENALICE_RAILWAY_VOLUME_ROOT']?.trim(),
  ].filter(Boolean).map((value) => resolve(value))
  if (configuredRoots.length === 0 || new Set(configuredRoots).size !== 1) return null
  const volumeRoot = configuredRoots[0]
  const installDir = env['OPENALICE_INSTALL_DIR']?.trim()
  if (!volumeRoot || volumeRoot === '/' || !homeRoot || !installDir) return null
  if (!pathIsWithin(volumeRoot, homeRoot) || !pathIsWithin(volumeRoot, installDir)) return null
  return isLinuxMountPoint(volumeRoot) ? volumeRoot : null
}

function pathIsWithin(root, candidate) {
  try {
    const canonicalRoot = realpathSync(root)
    const canonicalCandidate = realpathSync(candidate)
    return canonicalCandidate !== canonicalRoot
      && canonicalCandidate.startsWith(`${canonicalRoot}/`)
  } catch {
    return false
  }
}

function isLinuxMountPoint(path) {
  if (process.platform !== 'linux') return false
  try {
    const canonical = realpathSync(path)
    return readFileSync('/proc/self/mountinfo', 'utf8')
      .split('\n')
      .some((line) => decodeMountInfoPath(line.split(' ')[4] ?? '') === canonical)
  } catch {
    return false
  }
}

function decodeMountInfoPath(value) {
  return value.replace(/\\([0-7]{3})/g, (_match, octal) => (
    String.fromCharCode(Number.parseInt(octal, 8))
  ))
}

function inheritedFdHoldsExclusiveFlock(fd) {
  if (process.platform !== 'linux') return false
  try {
    return /^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\b/m.test(
      readFileSync(`/proc/self/fdinfo/${fd}`, 'utf8'),
    )
  } catch {
    return false
  }
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

function holdRuntime(runtime, options = {}) {
  const signalSource = options.signalSource ?? process
  const releaseStartupSignals = options.releaseStartupSignals ?? (() => undefined)
  const exitCodeFor = (code, signal, requestedStop) => (
    requestedStop ? 0 : code ?? (signal ? 1 : 0)
  )
  if (runtime.exitCode !== undefined && (
    runtime.exitCode !== null
    || (runtime.signalCode !== undefined && runtime.signalCode !== null)
  )) {
    releaseStartupSignals()
    return Promise.resolve(exitCodeFor(runtime.exitCode, runtime.signalCode, false))
  }
  return new Promise((resolvePromise) => {
    let requestedStop = false
    let settled = false
    const cleanup = () => {
      signalSource.off('SIGINT', stop)
      signalSource.off('SIGTERM', stop)
      runtime.off('exit', onExit)
    }
    const onExit = (code, signal) => {
      if (settled) return
      settled = true
      cleanup()
      resolvePromise(exitCodeFor(code, signal, requestedStop))
    }
    const stop = () => {
      if (requestedStop) return
      requestedStop = true
      runtime.kill('SIGTERM')
    }
    runtime.once('exit', onExit)
    signalSource.once('SIGINT', stop)
    signalSource.once('SIGTERM', stop)
    releaseStartupSignals()
    if (runtime.exitCode !== undefined && (
      runtime.exitCode !== null
      || (runtime.signalCode !== undefined && runtime.signalCode !== null)
    )) onExit(runtime.exitCode, runtime.signalCode)
  })
}
