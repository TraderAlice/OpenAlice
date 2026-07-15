import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir, hostname, tmpdir } from 'node:os'
import { createConnection } from 'node:net'
import { resolve } from 'node:path'

export const GUARDIAN_CONTROL_PROTOCOL = 1
const MAX_RESPONSE_BYTES = 1024 * 1024

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
      return {
        protocol: GUARDIAN_CONTROL_PROTOCOL,
        class: error?.code === 'EINCOMPATIBLE' || error?.code === 'incompatible_protocol'
          ? 'incompatible'
          : 'unhealthy',
        state: 'unknown',
        home: homeRoot,
        owner: null,
        endpoints: {},
        components: {},
        capabilities: [],
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const inspectOwner = dependencies.inspectOwner ?? inspectGuardianOwner
  const owner = await inspectOwner(homeRoot, {
    hostname: dependencies.hostname,
    isProcessAlive: dependencies.isProcessAlive,
  })
  if (owner?.active) {
    return {
      protocol: GUARDIAN_CONTROL_PROTOCOL,
      class: 'owned_elsewhere',
      state: 'running',
      home: homeRoot,
      owner: owner.publicOwner,
      endpoints: {},
      components: {},
      capabilities: [],
      detail: 'Guardian ownership is active but no compatible CLI Server control endpoint is available',
    }
  }
  return {
    protocol: GUARDIAN_CONTROL_PROTOCOL,
    class: 'absent',
    state: 'absent',
    home: homeRoot,
    owner: null,
    endpoints: {},
    components: {},
    capabilities: [],
    ...(owner?.detail ? { detail: owner.detail } : {}),
  }
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
  if (status.owner) {
    lines.push(`Owner: ${status.owner.surface} (pid ${status.owner.pid})`)
  }
  if (status.endpoints?.web) lines.push(`Web: ${status.endpoints.web}`)
  if (status.owner?.launchRoot) lines.push(`Runtime source: ${status.owner.launchRoot}`)
  if (status.detail) lines.push(`Detail: ${status.detail}`)
  return `${lines.join('\n')}\n`
}

function classifyControlStatus(homeRoot, runtime) {
  if (!runtime || typeof runtime !== 'object') {
    return {
      protocol: GUARDIAN_CONTROL_PROTOCOL,
      class: 'unhealthy',
      state: 'unknown',
      home: homeRoot,
      owner: null,
      endpoints: {},
      components: {},
      capabilities: [],
      detail: 'Guardian returned an invalid runtime.status result',
    }
  }
  const owner = sanitizeControlOwner(runtime.owner)
  const surface = owner?.surface
  const state = typeof runtime.state === 'string' ? runtime.state : 'unknown'
  let statusClass
  if (surface !== 'cli-server') statusClass = 'owned_elsewhere'
  else if (state === 'starting' || state === 'stopping') statusClass = state
  else if (state === 'running' && runtime.components?.alice === 'ready') statusClass = 'running'
  else statusClass = 'unhealthy'
  return {
    protocol: GUARDIAN_CONTROL_PROTOCOL,
    class: statusClass,
    runtimeVersion: typeof runtime.runtimeVersion === 'string' ? runtime.runtimeVersion : 'unknown',
    state,
    home: homeRoot,
    owner,
    endpoints: sanitizeEndpoints(runtime.endpoints),
    components: sanitizeComponents(runtime.components),
    capabilities: Array.isArray(runtime.capabilities)
      ? runtime.capabilities.filter((item) => typeof item === 'string')
      : [],
  }
}

async function inspectGuardianOwner(homeRoot, options = {}) {
  let owner
  try {
    owner = JSON.parse(await readFile(resolve(homeRoot, 'state', 'guardian.lock', 'owner.json'), 'utf8'))
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    return { active: true, publicOwner: null, detail: 'Guardian owner metadata is unreadable' }
  }
  if (!Number.isInteger(owner?.pid) || typeof owner?.launcher !== 'string') {
    return { active: true, publicOwner: null, detail: 'Guardian owner metadata is invalid' }
  }
  const localHostname = options.hostname ?? hostname()
  const sameHost = typeof owner.hostname !== 'string' || owner.hostname === localHostname
  const isAlive = options.isProcessAlive ?? isProcessAlive
  const active = !sameHost || isAlive(owner.pid)
  return {
    active,
    publicOwner: {
      surface: owner.launcher.startsWith('guardian-') ? owner.launcher.slice('guardian-'.length) : owner.launcher,
      pid: owner.pid,
      startedAt: typeof owner.acquiredAt === 'string' ? owner.acquiredAt : null,
    },
    ...(!active ? { detail: 'A stale Guardian owner record is present; the next start may recover it' } : {}),
  }
}

function sanitizeControlOwner(owner) {
  if (!owner || typeof owner !== 'object' || !Number.isInteger(owner.pid)) return null
  return {
    surface: typeof owner.surface === 'string' ? owner.surface : 'unknown',
    pid: owner.pid,
    instanceId: typeof owner.instanceId === 'string' ? owner.instanceId : 'unknown',
    startedAt: typeof owner.startedAt === 'string' ? owner.startedAt : null,
    ...(typeof owner.launchRoot === 'string' ? { launchRoot: owner.launchRoot } : {}),
    ...(typeof owner.mode === 'string' ? { mode: owner.mode } : {}),
  }
}

function sanitizeEndpoints(endpoints) {
  return typeof endpoints?.web === 'string' ? { web: endpoints.web } : {}
}

function sanitizeComponents(components) {
  if (!components || typeof components !== 'object') return {}
  const output = {}
  for (const name of ['alice', 'uta', 'connector']) {
    if (typeof components[name] === 'string') output[name] = components[name]
  }
  return output
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
