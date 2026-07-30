import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir, hostname, tmpdir } from 'node:os'
import { createConnection } from 'node:net'
import { resolve } from 'node:path'

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
  try {
    const runtime = await requestControl(homeRoot, 'runtime.status', {
      timeoutMs: options.timeoutMs,
      platform: dependencies.platform,
    })
    return classifyControlStatus(homeRoot, runtime)
  } catch (error) {
    if (!isUnavailableControlError(error)) {
      return emptyRuntimeStatus(
        homeRoot,
        error?.code === 'EINCOMPATIBLE' || error?.code === 'incompatible_protocol'
          ? 'incompatible'
          : 'unhealthy',
        'unknown',
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  const inspectOwner = dependencies.inspectOwner ?? inspectGuardianOwner
  const owner = await inspectOwner(homeRoot, {
    hostname: dependencies.hostname,
    isProcessAlive: dependencies.isProcessAlive,
  })
  if (owner?.active) {
    return {
      ...emptyRuntimeStatus(
        homeRoot,
        'owned_elsewhere',
        'running',
        'Guardian ownership is active but no compatible CLI Server control endpoint is available',
      ),
      owner: owner.publicOwner,
    }
  }
  return emptyRuntimeStatus(homeRoot, 'absent', 'absent', owner?.detail)
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

function classifyControlStatus(homeRoot, runtime) {
  if (!runtime || typeof runtime !== 'object') {
    return emptyRuntimeStatus(
      homeRoot,
      'unhealthy',
      'unknown',
      'Guardian returned an invalid runtime.status result',
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

function emptyRuntimeStatus(homeRoot, statusClass, state, detail) {
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

async function inspectGuardianOwner(homeRoot, options = {}) {
  const ownerPaths = [
    resolve(homeRoot, 'state', 'guardian.lock', 'owner.json'),
    resolve(homeRoot, 'state', 'runtime.lock', 'owner.json'),
    resolve(homeRoot, 'workspaces', 'state', 'runtime.lock', 'owner.json'),
  ]
  const localHostname = options.hostname ?? hostname()
  const isAlive = options.isProcessAlive ?? isProcessAlive
  let staleOwner = null
  for (const ownerPath of ownerPaths) {
    let owner
    try {
      owner = JSON.parse(await readFile(ownerPath, 'utf8'))
    } catch (error) {
      if (error?.code === 'ENOENT') continue
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
    const sameHost = typeof owner.hostname !== 'string'
      || owner.hostname === localHostname
    const active = !sameHost || isAlive(owner.pid)
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
  const allowedKinds = new Set(['source', 'bundle', 'docker', 'electron', 'remote', 'unknown'])
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
