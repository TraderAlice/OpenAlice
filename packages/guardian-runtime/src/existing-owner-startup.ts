import type { RuntimeLockInspection } from './runtime-lock.js'
import {
  isBrowserHandoffSurface,
  isElectronOwnerSurface,
  normalizeOwnerSurface,
  type ClassifiedRuntimeStatus,
} from './runtime-discovery.js'

export type ExistingOwnerDefaultAction = 'open-browser' | 'keep' | 'takeover'

export interface ExistingOwnerStartupDecision {
  readonly kind: 'handoff' | 'conflict'
  readonly surface: string
  readonly pid: number
  readonly home: string
  readonly heartbeatStale: boolean
  readonly url?: string
  readonly reason: string
  readonly defaultAction: ExistingOwnerDefaultAction
  readonly allowOpenBrowser: boolean
  readonly allowChooseAnother: boolean
  readonly allowTakeover: boolean
}

export interface DecideExistingOwnerStartupInput {
  readonly home: string
  readonly lock: Pick<RuntimeLockInspection, 'state' | 'owner' | 'heartbeatStale'>
  readonly discovered: ClassifiedRuntimeStatus | null
  readonly probeOk: boolean
  readonly canChooseAnother: boolean
}

export function decideExistingOwnerStartup(
  input: DecideExistingOwnerStartupInput,
): ExistingOwnerStartupDecision | { kind: 'continue' } {
  if (input.lock.state !== 'active' || !input.lock.owner) return { kind: 'continue' }

  const surface = input.discovered?.owner?.surface
    ?? normalizeOwnerSurface(input.lock.owner.launcher)
  const pid = input.discovered?.owner?.pid ?? input.lock.owner.pid
  const url = input.discovered?.endpoints.web
  const heartbeatStale = input.lock.heartbeatStale
  const allowChooseAnother = input.canChooseAnother
  const base = {
    surface,
    pid,
    home: input.home,
    heartbeatStale,
    allowChooseAnother,
    allowTakeover: true,
  }

  if (heartbeatStale) {
    return {
      kind: 'conflict',
      ...base,
      reason: 'The process is still present, but its health heartbeat is stale.',
      defaultAction: 'takeover',
      allowOpenBrowser: false,
    }
  }

  if (input.discovered?.class === 'incompatible') {
    return {
      kind: 'conflict',
      ...base,
      reason: input.discovered.detail
        ?? 'The existing Runtime control protocol is incompatible with this desktop.',
      defaultAction: 'keep',
      allowOpenBrowser: false,
    }
  }

  const runningHealthy = input.discovered?.state === 'running'
    && input.discovered.components.alice === 'ready'
    && typeof url === 'string'
  const handoff = !heartbeatStale
    && isBrowserHandoffSurface(surface)
    && runningHealthy
    && input.probeOk

  if (handoff) {
    return {
      kind: 'handoff',
      ...base,
      url,
      reason: surface === 'dev'
        ? 'A development Runtime already owns this data location.'
        : 'A CLI Server Runtime already owns this data location.',
      defaultAction: 'open-browser',
      allowOpenBrowser: true,
    }
  }

  if (isBrowserHandoffSurface(surface) && runningHealthy && !input.probeOk) {
    return {
      kind: 'conflict',
      ...base,
      url,
      reason: `The existing ${ownerLabel(surface)} advertised ${url}, but its Web UI is not ready.`,
      defaultAction: 'keep',
      allowOpenBrowser: false,
    }
  }

  if (isBrowserHandoffSurface(surface) && input.discovered?.state === 'starting') {
    return {
      kind: 'conflict',
      ...base,
      reason: `The existing ${ownerLabel(surface)} is still starting.`,
      defaultAction: 'keep',
      allowOpenBrowser: false,
    }
  }

  if (isElectronOwnerSurface(surface)) {
    return {
      kind: 'conflict',
      ...base,
      reason: 'Another desktop AliceProject already owns this data location.',
      defaultAction: 'keep',
      allowOpenBrowser: false,
    }
  }

  return {
    kind: 'conflict',
    ...base,
    reason: input.discovered?.detail
      ?? `Another AliceProject (${surface}) is using this data location.`,
    defaultAction: 'keep',
    allowOpenBrowser: false,
  }
}

export function ownerLabel(surface: string): string {
  if (surface === 'dev') return 'development Runtime'
  if (surface === 'cli-server') return 'CLI Server Runtime'
  if (isElectronOwnerSurface(surface)) return 'desktop AliceProject'
  return `${surface} AliceProject`
}
