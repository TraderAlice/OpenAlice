import { resolve } from 'node:path'

import {
  resolveAliceProjectIdentity,
  type AliceProjectIdentity,
} from './alice-project.js'
import { GUARDIAN_CONTROL_API_VERSION } from './runtime-status.js'

const MAX_UPTIME_SECONDS = 10 * 365 * 24 * 60 * 60
const BROWSER_HANDOFF_SURFACES = new Set(['dev', 'cli-server'])

export type DiscoveredRuntimeClass =
  | 'absent'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'unhealthy'
  | 'incompatible'
  | 'owned_elsewhere'

export interface SanitizedRuntimeOwner {
  readonly surface: string
  readonly pid: number
  readonly instanceId: string
  readonly startedAt: string | null
  readonly launchRoot?: string
  readonly mode?: 'foreground' | 'detached'
}

export interface ClassifiedRuntimeStatus {
  readonly protocol: 1
  readonly control: {
    readonly apiVersion: number
    readonly minClientApiVersion: number
    readonly capabilities: readonly string[]
  }
  readonly class: DiscoveredRuntimeClass
  readonly productVersion: string
  readonly runtimeVersion: string
  readonly state: string
  readonly home: string
  readonly aliceProject: AliceProjectIdentity | null
  readonly owner: SanitizedRuntimeOwner | null
  readonly endpoints: { readonly web?: string }
  readonly provider: {
    readonly kind: string
    readonly root?: string
    readonly contentIdentity?: string
  }
  readonly pendingActivation: {
    readonly productVersion: string
    readonly restartRequired: boolean
    readonly reason?: string
  } | null
  readonly uptimeSeconds: number | null
  readonly components: Readonly<Record<string, string>>
  readonly componentDetail: Readonly<Record<string, {
    readonly state: string
    readonly pid?: number
    readonly required?: boolean
    readonly detail?: string
  }>>
  readonly capabilities: readonly string[]
  readonly detail?: string
}

export function normalizeOwnerSurface(launcherOrSurface: string): string {
  return launcherOrSurface.startsWith('guardian-')
    ? launcherOrSurface.slice('guardian-'.length)
    : launcherOrSurface
}

export function isBrowserHandoffSurface(surface: string | undefined): boolean {
  return typeof surface === 'string' && BROWSER_HANDOFF_SURFACES.has(surface)
}

export function isElectronOwnerSurface(surface: string | undefined): boolean {
  return surface === 'electron' || Boolean(surface?.startsWith('electron-'))
}

export function sanitizeLoopbackWebUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'http:'
      || url.hostname !== '127.0.0.1'
      || url.username !== ''
      || url.password !== ''
    ) {
      return null
    }
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

export function classifyGuardianRuntimeStatus(
  homeRoot: string,
  runtime: unknown,
  fallbackAliceProject?: AliceProjectIdentity | null,
): ClassifiedRuntimeStatus {
  const home = resolve(homeRoot)
  const fallback = fallbackAliceProject ?? resolveAliceProjectIdentity({ home })
  if (!runtime || typeof runtime !== 'object') {
    return emptyClassifiedRuntimeStatus(
      home,
      'unhealthy',
      'unknown',
      'Guardian returned an invalid runtime.status result',
      fallback,
    )
  }
  const raw = runtime as Record<string, unknown>
  const owner = sanitizeControlOwner(raw.owner)
  const surface = owner?.surface
  const state = typeof raw.state === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(raw.state)
    ? raw.state
    : 'unknown'
  const control = sanitizeControlCompatibility(raw.control)
  const capabilities = sanitizeCapabilities(raw.capabilities)
  if (
    control.minClientApiVersion > GUARDIAN_CONTROL_API_VERSION
    || control.apiVersion < GUARDIAN_CONTROL_API_VERSION
  ) {
    return {
      ...emptyClassifiedRuntimeStatus(
        home,
        'incompatible',
        state,
        `Guardian control API ${control.minClientApiVersion}-${control.apiVersion} is incompatible with client API ${GUARDIAN_CONTROL_API_VERSION}`,
        fallback,
      ),
      owner,
      control,
      capabilities,
    }
  }
  let statusClass: DiscoveredRuntimeClass
  if (surface !== 'cli-server') statusClass = 'owned_elsewhere'
  else if (state === 'starting' || state === 'stopping') statusClass = state
  else if (state === 'running' && (raw.components as { alice?: string } | undefined)?.alice === 'ready') {
    statusClass = 'running'
  } else statusClass = 'unhealthy'
  const productVersion = sanitizeVersion(raw.productVersion)
    ?? sanitizeVersion(raw.runtimeVersion)
    ?? 'unknown'
  const components = sanitizeComponents(raw.components)
  return {
    protocol: 1,
    control,
    class: statusClass,
    productVersion,
    runtimeVersion: sanitizeVersion(raw.runtimeVersion) ?? productVersion,
    state,
    home,
    aliceProject: sanitizeAliceProject(raw.aliceProject, home) ?? fallback,
    owner,
    endpoints: sanitizeEndpoints(raw.endpoints),
    provider: sanitizeProvider(raw.provider, owner),
    pendingActivation: sanitizePendingActivation(raw.pendingActivation),
    uptimeSeconds: sanitizeUptime(raw.uptimeSeconds, owner?.startedAt),
    components,
    componentDetail: sanitizeComponentDetail(raw.componentDetail, components),
    capabilities,
    ...(sanitizeDetail(raw.detail) ? { detail: sanitizeDetail(raw.detail)! } : {}),
  }
}

export function emptyClassifiedRuntimeStatus(
  homeRoot: string,
  statusClass: DiscoveredRuntimeClass,
  state: string,
  detail?: string,
  aliceProject?: AliceProjectIdentity | null,
): ClassifiedRuntimeStatus {
  return {
    protocol: 1,
    control: {
      apiVersion: GUARDIAN_CONTROL_API_VERSION,
      minClientApiVersion: GUARDIAN_CONTROL_API_VERSION,
      capabilities: [],
    },
    class: statusClass,
    productVersion: 'unknown',
    runtimeVersion: 'unknown',
    state,
    home: resolve(homeRoot),
    aliceProject: aliceProject ?? null,
    owner: null,
    endpoints: {},
    provider: { kind: 'unknown' },
    pendingActivation: null,
    uptimeSeconds: null,
    components: {},
    componentDetail: {},
    capabilities: [],
    ...(detail ? { detail: sanitizeDetail(detail)! } : {}),
  }
}

export async function probeLoopbackAuthStatus(
  baseUrl: string,
  options: {
    readonly fetchImpl?: typeof fetch
    readonly timeoutMs?: number
  } = {},
): Promise<boolean> {
  const url = sanitizeLoopbackWebUrl(baseUrl)
  if (!url) return false
  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(`${url}/api/auth/status`, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 750),
    })
    if (!response.ok) return false
    const body = await response.json() as { authed?: unknown; tokenConfigured?: unknown }
    return typeof body?.authed === 'boolean' && typeof body?.tokenConfigured === 'boolean'
  } catch {
    return false
  }
}

function sanitizeAliceProject(value: unknown, homeRoot: string): AliceProjectIdentity | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const home = safePath(raw.home)
  if (home !== resolve(homeRoot)) return null
  if (typeof raw.id !== 'string' || !/^alice-project-[a-z0-9_-]{8,96}$/.test(raw.id)) return null
  if (typeof raw.key !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(raw.key)) return null
  if (typeof raw.displayName !== 'string' || raw.displayName.trim().length < 1 || raw.displayName.length > 80) {
    return null
  }
  return {
    id: raw.id,
    key: raw.key,
    displayName: raw.displayName.trim(),
    home,
    appRoot: safePath(raw.appRoot),
  }
}

function sanitizeControlOwner(owner: unknown): SanitizedRuntimeOwner | null {
  if (!owner || typeof owner !== 'object' || !Number.isInteger((owner as { pid?: unknown }).pid)) return null
  const raw = owner as Record<string, unknown>
  return {
    surface: typeof raw.surface === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(raw.surface)
      ? raw.surface
      : 'unknown',
    pid: raw.pid as number,
    instanceId: typeof raw.instanceId === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(raw.instanceId)
      ? raw.instanceId
      : 'unknown',
    startedAt: typeof raw.startedAt === 'string' ? raw.startedAt : null,
    ...(safePath(raw.launchRoot) ? { launchRoot: safePath(raw.launchRoot)! } : {}),
    ...(raw.mode === 'foreground' || raw.mode === 'detached' ? { mode: raw.mode } : {}),
  }
}

function sanitizeEndpoints(endpoints: unknown): { web?: string } {
  const web = sanitizeLoopbackWebUrl(
    endpoints && typeof endpoints === 'object'
      ? (endpoints as { web?: unknown }).web
      : null,
  )
  return web ? { web } : {}
}

function sanitizeComponents(components: unknown): Record<string, string> {
  if (!components || typeof components !== 'object') return {}
  const output: Record<string, string> = {}
  for (const name of ['alice', 'uta', 'connector'] as const) {
    const value = (components as Record<string, unknown>)[name]
    if (typeof value === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(value)) {
      output[name] = value
    }
  }
  return output
}

function sanitizeComponentDetail(
  componentDetail: unknown,
  components: Record<string, string>,
): ClassifiedRuntimeStatus['componentDetail'] {
  const output: Record<string, {
    state: string
    pid?: number
    required?: boolean
    detail?: string
  }> = {}
  for (const name of ['alice', 'uta', 'connector'] as const) {
    const source = (
      componentDetail && typeof componentDetail === 'object'
        ? (componentDetail as Record<string, Record<string, unknown>>)[name]
        : undefined
    )
    const state = typeof source?.state === 'string' ? source.state : components[name]
    if (!state) continue
    output[name] = {
      state,
      ...(Number.isInteger(source?.pid) && (source?.pid as number) > 0 ? { pid: source?.pid as number } : {}),
      ...(typeof source?.required === 'boolean' ? { required: source.required } : {}),
      ...(sanitizeDetail(source?.detail) ? { detail: sanitizeDetail(source?.detail)! } : {}),
    }
  }
  return output
}

function sanitizeControlCompatibility(control: unknown): ClassifiedRuntimeStatus['control'] {
  if (!control || typeof control !== 'object') {
    return {
      apiVersion: GUARDIAN_CONTROL_API_VERSION,
      minClientApiVersion: GUARDIAN_CONTROL_API_VERSION,
      capabilities: [],
    }
  }
  const raw = control as Record<string, unknown>
  const apiVersion = positiveInteger(raw.apiVersion) ?? GUARDIAN_CONTROL_API_VERSION
  const minClientApiVersion = positiveInteger(raw.minClientApiVersion) ?? 1
  return {
    apiVersion,
    minClientApiVersion,
    capabilities: sanitizeCapabilities(raw.capabilities),
  }
}

function sanitizeCapabilities(capabilities: unknown): string[] {
  if (!Array.isArray(capabilities)) return []
  return [...new Set(capabilities.filter(
    (item): item is string => typeof item === 'string' && /^[a-z][a-z0-9.-]{0,63}$/.test(item),
  ))].sort()
}

function sanitizeProvider(
  provider: unknown,
  owner: SanitizedRuntimeOwner | null,
): ClassifiedRuntimeStatus['provider'] {
  const allowedKinds = new Set(['source', 'bundle', 'docker', 'electron', 'remote', 'unknown'])
  const fallbackKind = owner?.launchRoot ? 'source' : 'unknown'
  if (!provider || typeof provider !== 'object') {
    return {
      kind: fallbackKind,
      ...(owner?.launchRoot ? { root: owner.launchRoot } : {}),
    }
  }
  const raw = provider as Record<string, unknown>
  const kind = typeof raw.kind === 'string' && allowedKinds.has(raw.kind) ? raw.kind : fallbackKind
  return {
    kind,
    ...(safePath(raw.root)
      ? { root: safePath(raw.root)! }
      : owner?.launchRoot ? { root: owner.launchRoot } : {}),
    ...(typeof raw.contentIdentity === 'string'
      && /^[A-Za-z0-9._-]{1,128}$/.test(raw.contentIdentity)
      ? { contentIdentity: raw.contentIdentity }
      : {}),
  }
}

function sanitizePendingActivation(value: unknown): ClassifiedRuntimeStatus['pendingActivation'] {
  if (!value || typeof value !== 'object') return null
  const productVersion = sanitizeVersion((value as { productVersion?: unknown }).productVersion)
  if (!productVersion) return null
  const reason = sanitizeDetail((value as { reason?: unknown }).reason)
  return {
    productVersion,
    restartRequired: (value as { restartRequired?: unknown }).restartRequired === true,
    ...(reason ? { reason } : {}),
  }
}

function sanitizeUptime(value: unknown, startedAt: string | null | undefined): number | null {
  if (Number.isFinite(value)) {
    return Math.min(MAX_UPTIME_SECONDS, Math.max(0, Math.floor(value as number)))
  }
  const startedAtMs = Date.parse(startedAt ?? '')
  if (!Number.isFinite(startedAtMs)) return null
  return Math.min(MAX_UPTIME_SECONDS, Math.max(0, Math.floor((Date.now() - startedAtMs) / 1_000)))
}

function sanitizeVersion(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/.test(value)
    ? value
    : null
}

function sanitizeDetail(value: unknown): string | null {
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

function safePath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096) return null
  return /[\u0000-\u001f\u007f]/.test(value) ? null : value
}

function positiveInteger(value: unknown): number | null {
  return Number.isInteger(value) && (value as number) > 0 ? value as number : null
}
