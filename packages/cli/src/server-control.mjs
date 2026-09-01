import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { fstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { homedir, hostname, tmpdir } from 'node:os'
import { createConnection } from 'node:net'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

import { resolveAliceProjectIdentity } from './alice-project.ts'

const execFileAsync = promisify(execFile)

export const GUARDIAN_CONTROL_PROTOCOL = 1
export const GUARDIAN_CONTROL_API_VERSION = 1
const MAX_RESPONSE_BYTES = 1024 * 1024
const MAX_UPTIME_SECONDS = 10 * 365 * 24 * 60 * 60

export function resolveOpenAliceHome(homeRoot, options = {}) {
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? homedir()
  return resolve(homeRoot ?? env['OPENALICE_HOME'] ?? resolve(homeDir, '.openalice'))
}

export function guardianControlEndpoint(homeRoot, platform = process.platform) {
  const canonicalHome = resolve(homeRoot)
  const homeId = createHash('sha256').update(canonicalHome).digest('hex').slice(0, 20)
  if (platform === 'win32') {
    return `\\\\.\\pipe\\openalice-guardian-${homeId}`
  }
  const homeEndpoint = resolve(canonicalHome, 'state', 'guardian-control.sock')
  if (Buffer.byteLength(homeEndpoint, 'utf8') <= 96) return homeEndpoint
  const uid = typeof process.getuid === 'function' ? process.getuid() : 'user'
  return resolve(tmpdir(), `openalice-guardian-${uid}`, `${homeId}.sock`)
}

export async function requestRuntimeControl(homeRoot, method, options = {}) {
  const endpoint = options.endpoint ?? guardianControlEndpoint(homeRoot, options.platform)
  const timeoutMs = options.timeoutMs ?? 2_000
  const id = options.id ?? randomUUID()
  const request = `${JSON.stringify({
    protocol: GUARDIAN_CONTROL_PROTOCOL,
    id,
    method,
    params: options.params ?? {},
  })}\n`

  return new Promise((resolvePromise, rejectPromise) => {
    const socket = (options.createConnectionImpl ?? createConnection)(endpoint)
    let body = ''
    let settled = false
    const finish = (error, result) => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) rejectPromise(error)
      else resolvePromise(result)
    }
    socket.setEncoding('utf8')
    socket.setTimeout(timeoutMs, () => finish(controlError('ETIMEDOUT', `Timed out waiting for OpenAlice Guardian at ${endpoint}`)))
    socket.once('error', (error) => finish(error))
    socket.once('connect', () => socket.write(request))
    socket.on('data', (chunk) => {
      if (settled) return
      body += chunk
      if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) {
        finish(controlError('ERESPONSETOOLARGE', 'OpenAlice Guardian control response is too large'))
        return
      }
      const newline = body.indexOf('\n')
      if (newline < 0) return
      let response
      try {
        response = JSON.parse(body.slice(0, newline))
      } catch {
        finish(controlError('EINVALIDRESPONSE', 'OpenAlice Guardian returned invalid JSON'))
        return
      }
      if (response?.protocol !== GUARDIAN_CONTROL_PROTOCOL || response?.id !== id) {
        finish(controlError('EINCOMPATIBLE', 'OpenAlice Guardian control protocol is incompatible'))
        return
      }
      if (response.ok !== true) {
        finish(controlError(
          typeof response?.error?.code === 'string' ? response.error.code : 'ECONTROL',
          typeof response?.error?.message === 'string' ? response.error.message : 'OpenAlice Guardian control request failed',
        ))
        return
      }
      finish(null, response.result)
    })
    socket.once('end', () => {
      if (!settled) finish(controlError('EUNEXPECTEDEND', 'OpenAlice Guardian closed the control connection without a response'))
    })
  })
}

export async function readRuntimeStatus(options = {}, dependencies = {}) {
  const homeRoot = resolveOpenAliceHome(options.homeRoot, {
    env: dependencies.env,
    homeDir: dependencies.homeDir,
  })
  const requestControl = dependencies.requestControl ?? requestRuntimeControl
  const aliceProject = resolveAliceProjectIdentity({
    home: homeRoot,
    appRoot: dependencies.env?.['OPENALICE_PROJECT_APP_ROOT'],
    env: dependencies.env,
  })
  try {
    const runtime = await requestControl(homeRoot, 'runtime.status', {
      timeoutMs: options.timeoutMs,
      platform: dependencies.platform,
    })
    return classifyControlStatus(homeRoot, runtime, aliceProject)
  } catch (error) {
    if (!isUnavailableControlError(error)) {
      return emptyRuntimeStatus(
        homeRoot,
        error?.code === 'EINCOMPATIBLE' || error?.code === 'incompatible_protocol'
          ? 'incompatible'
          : 'unhealthy',
        'unknown',
        error instanceof Error ? error.message : String(error),
        aliceProject,
      )
    }
  }

  const inspectOwner = dependencies.inspectOwner ?? inspectGuardianOwner
  const owner = await inspectOwner(homeRoot, {
    env: dependencies.env,
    hostname: dependencies.hostname,
    isProcessAlive: dependencies.isProcessAlive,
    platform: dependencies.platform,
    readMachineId: dependencies.readMachineId,
    readProcessStartedAt: dependencies.readProcessStartedAt,
    railwayFenceValid: dependencies.railwayFenceValid,
  })
  if (owner?.active) {
    return {
      ...emptyRuntimeStatus(
        homeRoot,
        'owned_elsewhere',
        'running',
        'Guardian ownership is active but no compatible CLI Server control endpoint is available',
        aliceProject,
      ),
      owner: owner.publicOwner,
    }
  }
  return emptyRuntimeStatus(homeRoot, 'absent', 'absent', owner?.detail, aliceProject)
}

export async function stopRuntimeServer(options = {}, dependencies = {}) {
  const readStatus = dependencies.readStatus ?? readRuntimeStatus
  const requestControl = dependencies.requestControl ?? requestRuntimeControl
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms)))
  const timeoutMs = options.waitMs ?? 15_000
  let status = await readStatus(options, dependencies)
  if (status.class === 'absent') return { stopped: false, status }
  if (status.owner?.surface !== 'cli-server') {
    throw controlError('EOWNED', `OpenAlice is owned by ${status.owner?.surface ?? status.class}; refusing server stop`)
  }
  if (!status.capabilities?.includes('runtime.stop')) {
    throw controlError('ESTOPUNSUPPORTED', 'This OpenAlice owner does not advertise runtime.stop')
  }

  if (status.state !== 'stopping') {
    await requestControl(status.home, 'runtime.stop', {
      timeoutMs: Math.min(timeoutMs, 5_000),
      platform: dependencies.platform,
    })
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(Math.min(100, Math.max(1, deadline - Date.now())))
    status = await readStatus({ ...options, homeRoot: status.home }, dependencies)
    if (status.class === 'absent') return { stopped: true, status }
  }
  throw controlError('ETIMEDOUT', `OpenAlice Server did not stop within ${Math.ceil(timeoutMs / 1_000)}s`)
}

export function formatRuntimeStatus(status) {
  const lines = [`OpenAlice Server: ${status.class}`]
  if (status.aliceProject) {
    lines.push(`AliceProject: ${status.aliceProject.displayName} (${status.aliceProject.key})`)
  }
  lines.push(`Home: ${status.home}`)
  if (status.productVersion || status.runtimeVersion) {
    lines.push(`Version: ${status.productVersion ?? status.runtimeVersion}`)
  }
  if (status.owner) {
    lines.push(`Owner: ${status.owner.surface} (pid ${status.owner.pid})`)
  }
  if (status.endpoints?.web) lines.push(`Web: ${status.endpoints.web}`)
  if (status.provider?.kind) lines.push(`Provider: ${status.provider.kind}`)
  if (status.owner?.launchRoot) lines.push(`Runtime source: ${status.owner.launchRoot}`)
  if (status.detail) lines.push(`Detail: ${status.detail}`)
  return `${lines.join('\n')}\n`
}

function classifyControlStatus(homeRoot, runtime, fallbackAliceProject) {
  // Installed CLI cannot import @traderalice/guardian-runtime. Keep this
  // classifier aligned with packages/guardian-runtime/src/runtime-discovery.ts.
  if (!runtime || typeof runtime !== 'object') {
    return emptyRuntimeStatus(
      homeRoot,
      'unhealthy',
      'unknown',
      'Guardian returned an invalid runtime.status result',
      fallbackAliceProject,
    )
  }
  const owner = sanitizeControlOwner(runtime.owner)
  const surface = owner?.surface
  const state = typeof runtime.state === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(runtime.state)
    ? runtime.state
    : 'unknown'
  const control = sanitizeControlCompatibility(runtime.control)
  const capabilities = sanitizeCapabilities(runtime.capabilities)
  if (
    control.minClientApiVersion > GUARDIAN_CONTROL_API_VERSION
    || control.apiVersion < GUARDIAN_CONTROL_API_VERSION
  ) {
    return {
      ...emptyRuntimeStatus(
        homeRoot,
        'incompatible',
        state,
        `Guardian control API ${control.minClientApiVersion}-${control.apiVersion} is incompatible with CLI API ${GUARDIAN_CONTROL_API_VERSION}`,
        fallbackAliceProject,
      ),
      owner,
      control,
      capabilities,
    }
  }
  let statusClass
  if (surface !== 'cli-server') statusClass = 'owned_elsewhere'
  else if (state === 'starting' || state === 'stopping') statusClass = state
  else if (state === 'running' && runtime.components?.alice === 'ready') statusClass = 'running'
  else statusClass = 'unhealthy'
  const productVersion = sanitizeVersion(runtime.productVersion)
    ?? sanitizeVersion(runtime.runtimeVersion)
    ?? 'unknown'
  const components = sanitizeComponents(runtime.components)
  return {
    protocol: GUARDIAN_CONTROL_PROTOCOL,
    control,
    class: statusClass,
    productVersion,
    runtimeVersion: sanitizeVersion(runtime.runtimeVersion) ?? productVersion,
    state,
    home: homeRoot,
    aliceProject: sanitizeAliceProject(runtime.aliceProject, homeRoot) ?? fallbackAliceProject,
    owner,
    endpoints: sanitizeEndpoints(runtime.endpoints),
    provider: sanitizeProvider(runtime.provider, owner),
    pendingActivation: sanitizePendingActivation(runtime.pendingActivation),
    uptimeSeconds: sanitizeUptime(runtime.uptimeSeconds, owner?.startedAt),
    components,
    componentDetail: sanitizeComponentDetail(runtime.componentDetail, components),
    capabilities,
    ...(sanitizeDetail(runtime.detail) ? { detail: sanitizeDetail(runtime.detail) } : {}),
  }
}

function emptyRuntimeStatus(homeRoot, statusClass, state, detail, aliceProject) {
  return {
    protocol: GUARDIAN_CONTROL_PROTOCOL,
    control: {
      apiVersion: GUARDIAN_CONTROL_API_VERSION,
      minClientApiVersion: GUARDIAN_CONTROL_API_VERSION,
      capabilities: [],
    },
    class: statusClass,
    productVersion: 'unknown',
    runtimeVersion: 'unknown',
    state,
    home: homeRoot,
    ...(aliceProject ? { aliceProject } : {}),
    owner: null,
    endpoints: {},
    provider: { kind: 'unknown' },
    pendingActivation: null,
    uptimeSeconds: null,
    components: {},
    componentDetail: {},
    capabilities: [],
    ...(detail ? { detail: sanitizeDetail(detail) } : {}),
  }
}

function sanitizeAliceProject(value, homeRoot) {
  if (!value || typeof value !== 'object') return null
  const home = safePath(value.home)
  if (home !== resolve(homeRoot)) return null
  if (typeof value.id !== 'string' || !/^alice-project-[a-z0-9_-]{8,96}$/.test(value.id)) return null
  if (typeof value.key !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(value.key)) return null
  if (typeof value.displayName !== 'string' || value.displayName.trim().length < 1 || value.displayName.length > 80) return null
  return {
    id: value.id,
    key: value.key,
    displayName: value.displayName.trim(),
    home,
    appRoot: safePath(value.appRoot),
  }
}

async function inspectGuardianOwner(homeRoot, options = {}) {
  const ownerPaths = [
    resolve(homeRoot, 'state', 'guardian.lock', 'owner.json'),
    resolve(homeRoot, 'state', 'runtime.lock', 'owner.json'),
    resolve(homeRoot, 'workspaces', 'state', 'runtime.lock', 'owner.json'),
  ]
  const env = options.env ?? process.env
  const localHostname = options.hostname ?? hostname()
  const isAlive = options.isProcessAlive ?? isProcessAlive
  const machineId = options.readMachineId ?? (() => readMachineId({
    env,
    hostname: localHostname,
    platform: options.platform,
  }))
  let machineIdPromise
  const currentMachineId = () => {
    machineIdPromise ??= Promise.resolve().then(() => machineId())
    return machineIdPromise
  }
  const processStartedAt = options.readProcessStartedAt
    ?? ((pid) => readProcessStartedAt(pid, { platform: options.platform }))
  let staleOwner = null
  for (const ownerPath of ownerPaths) {
    let owner
    try {
      owner = JSON.parse(await readFile(ownerPath, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') {
        const lockPath = resolve(ownerPath, '..')
        try {
          await stat(lockPath)
          return {
            active: true,
            publicOwner: null,
            detail: `Runtime lock exists without published owner metadata at ${lockPath}`,
          }
        } catch (lockError) {
          if (lockError?.code === 'ENOENT') continue
          return {
            active: true,
            publicOwner: null,
            detail: `Runtime lock metadata is unreadable at ${lockPath}`,
          }
        }
      }
      return {
        active: true,
        publicOwner: null,
        detail: `Runtime owner metadata is unreadable at ${ownerPath}`,
      }
    }
    if (!Number.isInteger(owner?.pid) || typeof owner?.launcher !== 'string') {
      return {
        active: true,
        publicOwner: null,
        detail: `Runtime owner metadata is invalid at ${ownerPath}`,
      }
    }
    const resolvedMachineId = await currentMachineId()
    const railwayScope = railwayOwnerScope(owner, resolvedMachineId, env, homeRoot, options)
    let active
    if (railwayScope === 'cross-container-fenced') {
      active = false
    } else if (railwayScope === 'cross-container-observer') {
      active = true
    } else if (railwayScope === 'foreign') {
      active = true
    } else {
      const sameMachine = railwayScope === 'same-container'
        || (typeof owner.machineId === 'string' && owner.machineId
          ? owner.machineId === resolvedMachineId
          : typeof owner.hostname !== 'string' || owner.hostname === localHostname)
      active = !sameMachine || await isSameProcess(owner, {
        isAlive,
        processStartedAt,
      })
    }
    const publicOwner = {
      surface: owner.launcher.startsWith('guardian-')
        ? owner.launcher.slice('guardian-'.length)
        : owner.launcher,
      pid: owner.pid,
      startedAt: typeof owner.acquiredAt === 'string'
        ? owner.acquiredAt
        : null,
    }
    if (active) return { active: true, publicOwner }
    staleOwner = publicOwner
  }
  return staleOwner
    ? {
        active: false,
        publicOwner: staleOwner,
        detail: 'A stale Runtime owner record is present; the next start may recover it',
      }
    : null
}

function railwayOwnerScope(owner, currentMachineId, env, homeRoot, options) {
  const serviceId = env['RAILWAY_SERVICE_ID']?.trim()
  const environmentId = env['RAILWAY_ENVIRONMENT_ID']?.trim()
  const configuredMachineId = env['OPENALICE_MACHINE_ID']?.trim()
  const expectedMachineId = `railway-service-${serviceId}`
  if (
    env['OPENALICE_SERVICE_MANAGER']?.trim() !== 'railway'
    || !environmentId
    || !/^[A-Za-z0-9-]{1,128}$/.test(serviceId ?? '')
    || configuredMachineId !== expectedMachineId
    || currentMachineId !== `env:${expectedMachineId}`
  ) {
    return null
  }
  if (owner.machineId !== currentMachineId) return 'foreign'
  if (owner.fencingProtocol !== 'railway-flock-v1') return 'foreign'
  if (
    owner.fencingInstanceId !== undefined
    && !/^[A-Za-z0-9-]{16,128}$/.test(owner.fencingInstanceId)
  ) return 'foreign'
  const currentInstanceId = env['OPENALICE_RAILWAY_INSTANCE_ID']?.trim()
  if (!/^[A-Za-z0-9-]{16,128}$/.test(currentInstanceId ?? '')) return 'foreign'
  if (owner.fencingInstanceId === currentInstanceId) return 'same-container'
  const fenceValid = options.railwayFenceValid
    ?? hasValidRailwayFence(env, homeRoot)
  return fenceValid ? 'cross-container-fenced' : 'cross-container-observer'
}

function hasValidRailwayFence(env, homeRoot) {
  const rawFd = env['OPENALICE_RAILWAY_FENCE_FD']?.trim()
  const fd = Number(rawFd)
  if (
    env['OPENALICE_RAILWAY_ENTRYPOINT_OWNER'] !== '1'
    || !/^[0-9]{1,4}$/.test(rawFd ?? '')
    || !Number.isInteger(fd)
    || fd < 3
  ) return false
  const fencePath = railwayRuntimeFencePath(env, homeRoot)
  if (!fencePath) return false
  try {
    const inherited = fstatSync(fd)
    const expected = statSync(fencePath)
    return inherited.isDirectory()
      && expected.isDirectory()
      && inherited.dev === expected.dev
      && inherited.ino === expected.ino
      && inheritedFdHoldsExclusiveFlock(fd)
  } catch {
    return false
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

async function isSameProcess(owner, dependencies) {
  if (!dependencies.isAlive(owner.pid)) return false
  if (typeof owner.processStartedAt !== 'string') return true
  const expected = Date.parse(owner.processStartedAt)
  if (!Number.isFinite(expected)) return true
  const actual = await dependencies.processStartedAt(owner.pid)
  if (actual === null) return true
  return Math.abs(actual - expected) <= 2_000
}

async function readProcessStartedAt(pid, options = {}) {
  try {
    if ((options.platform ?? process.platform) === 'win32') {
      const script = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        timeout: 2_000,
      })
      const parsed = Date.parse(stdout.trim())
      return Number.isFinite(parsed) ? parsed : null
    }

    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 2_000 })
    const parsed = Date.parse(stdout.trim())
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

// Installed CLI payloads do not include @traderalice/guardian-runtime. Keep
// these machine/process identity readers aligned with its process-control.ts.
async function readMachineId(options = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const localHostname = options.hostname ?? hostname()
  const override = env['OPENALICE_MACHINE_ID']?.trim()
  if (override) return `env:${override}`
  try {
    if (platform === 'linux') {
      const value = (await readFile('/etc/machine-id', 'utf8')).trim()
      if (value) return `linux:${value}`
    }
    if (platform === 'darwin') {
      const { stdout } = await execFileAsync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: 2_000 })
      const value = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(stdout)?.[1]
      if (value) return `darwin:${value}`
    }
    if (platform === 'win32') {
      const { stdout } = await execFileAsync('reg.exe', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
        '/v',
        'MachineGuid',
      ], { windowsHide: true, timeout: 2_000 })
      const value = /MachineGuid\s+REG_\w+\s+([^\r\n]+)/i.exec(stdout)?.[1]?.trim()
      if (value) return `win32:${value}`
    }
  } catch {
    // Match Guardian's weaker fallback when a platform identity is unavailable.
  }
  return `hostname:${localHostname}`
}

function sanitizeControlOwner(owner) {
  if (!owner || typeof owner !== 'object' || !Number.isInteger(owner.pid)) return null
  return {
    surface: typeof owner.surface === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(owner.surface)
      ? owner.surface
      : 'unknown',
    pid: owner.pid,
    instanceId: typeof owner.instanceId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(owner.instanceId)
      ? owner.instanceId
      : 'unknown',
    startedAt: typeof owner.startedAt === 'string' ? owner.startedAt : null,
    ...(safePath(owner.launchRoot) ? { launchRoot: safePath(owner.launchRoot) } : {}),
    ...(['foreground', 'detached'].includes(owner.mode) ? { mode: owner.mode } : {}),
  }
}

function sanitizeEndpoints(endpoints) {
  if (typeof endpoints?.web !== 'string') return {}
  try {
    const url = new URL(endpoints.web)
    if (
      url.protocol !== 'http:'
      || url.hostname !== '127.0.0.1'
      || url.username !== ''
      || url.password !== ''
    ) {
      return {}
    }
    return { web: url.toString().replace(/\/$/, '') }
  } catch {
    return {}
  }
}

function sanitizeComponents(components) {
  if (!components || typeof components !== 'object') return {}
  const output = {}
  for (const name of ['alice', 'uta', 'connector']) {
    if (typeof components[name] === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(components[name])) {
      output[name] = components[name]
    }
  }
  return output
}

function sanitizeComponentDetail(componentDetail, components) {
  const output = {}
  for (const name of ['alice', 'uta', 'connector']) {
    const source = componentDetail?.[name]
    const state = typeof source?.state === 'string' ? source.state : components[name]
    if (!state) continue
    output[name] = {
      state,
      ...(Number.isInteger(source?.pid) && source.pid > 0 ? { pid: source.pid } : {}),
      ...(typeof source?.required === 'boolean' ? { required: source.required } : {}),
      ...(sanitizeDetail(source?.detail) ? { detail: sanitizeDetail(source.detail) } : {}),
    }
  }
  return output
}

function sanitizeControlCompatibility(control) {
  if (!control || typeof control !== 'object') {
    return {
      apiVersion: GUARDIAN_CONTROL_API_VERSION,
      minClientApiVersion: GUARDIAN_CONTROL_API_VERSION,
      capabilities: [],
    }
  }
  const apiVersion = positiveInteger(control.apiVersion) ?? GUARDIAN_CONTROL_API_VERSION
  const minClientApiVersion = positiveInteger(control.minClientApiVersion) ?? 1
  return {
    apiVersion,
    minClientApiVersion,
    capabilities: sanitizeCapabilities(control.capabilities),
  }
}

function sanitizeCapabilities(capabilities) {
  if (!Array.isArray(capabilities)) return []
  return [...new Set(capabilities.filter(
    (item) => typeof item === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(item),
  ))].sort()
}

function sanitizeProvider(provider, owner) {
  const allowedKinds = new Set(['source', 'bundle', 'bun', 'docker', 'electron', 'remote', 'unknown'])
  const fallbackKind = owner?.launchRoot ? 'source' : 'unknown'
  if (!provider || typeof provider !== 'object') {
    return {
      kind: fallbackKind,
      ...(owner?.launchRoot ? { root: owner.launchRoot } : {}),
    }
  }
  const kind = allowedKinds.has(provider.kind) ? provider.kind : fallbackKind
  return {
    kind,
    ...(safePath(provider.root)
      ? { root: safePath(provider.root) }
      : owner?.launchRoot ? { root: owner.launchRoot } : {}),
    ...(typeof provider.contentIdentity === 'string'
      && /^[A-Za-z0-9._-]{1,128}$/.test(provider.contentIdentity)
      ? { contentIdentity: provider.contentIdentity }
      : {}),
  }
}

function sanitizePendingActivation(value) {
  if (!value || typeof value !== 'object') return null
  const productVersion = sanitizeVersion(value.productVersion)
  if (!productVersion) return null
  return {
    productVersion,
    restartRequired: value.restartRequired === true,
    ...(sanitizeDetail(value.reason) ? { reason: sanitizeDetail(value.reason) } : {}),
  }
}

function sanitizeUptime(value, startedAt) {
  if (Number.isFinite(value)) {
    return Math.min(MAX_UPTIME_SECONDS, Math.max(0, Math.floor(value)))
  }
  const startedAtMs = Date.parse(startedAt ?? '')
  if (!Number.isFinite(startedAtMs)) return null
  return Math.min(MAX_UPTIME_SECONDS, Math.max(0, Math.floor((Date.now() - startedAtMs) / 1_000)))
}

function sanitizeVersion(value) {
  return typeof value === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/.test(value)
    ? value
    : null
}

function sanitizeDetail(value) {
  if (typeof value !== 'string') return null
  const normalized = value
    .replaceAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|token|secret|password|private[-_ ]?key|sealing[-_ ]?key)\s*[:=]\s*)[^\s,;&]+/gi,
      '$1[REDACTED]',
    )
    .trim()
  return normalized ? normalized.slice(0, 500) : null
}

function safePath(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096) return null
  return /[\u0000-\u001f\u007f]/.test(value) ? null : value
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null
}

function isUnavailableControlError(error) {
  return ['ENOENT', 'ECONNREFUSED', 'ENOTSOCK', 'EPIPE'].includes(error?.code)
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

function controlError(code, message) {
  const error = new Error(message)
  error.code = code
  return error
}
