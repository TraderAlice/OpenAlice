export type HarnessSurfacePhase = 'stopped' | 'starting' | 'ready' | 'failed' | 'stopping'

export interface HarnessSurface {
  readonly workspaceId: string
  readonly capability: string
  readonly manifestVersion?: number
  readonly harnessVersion?: string
  readonly phase: HarnessSurfacePhase
  readonly generation: number
  readonly routeHost?: string
  readonly startedAt?: string
  readonly readyAt?: string
  readonly error?: string
  readonly logs: string
}

export interface HarnessSurfaceResponse {
  readonly surface: HarnessSurface
  readonly gatewayPort?: number
}

export class HarnessSurfaceApiError extends Error {
  constructor(readonly code: string, message: string, readonly status: number) {
    super(message)
    this.name = 'HarnessSurfaceApiError'
  }
}

export async function getHarnessSurface(workspaceId: string, capability = 'studio') {
  return request(workspaceId, capability)
}

export async function startHarnessSurface(workspaceId: string, capability = 'studio') {
  return request(workspaceId, capability, 'start')
}

export async function restartHarnessSurface(workspaceId: string, capability = 'studio') {
  return request(workspaceId, capability, 'restart')
}

export async function stopHarnessSurface(workspaceId: string, capability = 'studio') {
  return request(workspaceId, capability, 'stop')
}

export function harnessSurfaceUrl(response: HarnessSurfaceResponse): string | null {
  const routeHost = response.surface.routeHost
  if (!routeHost) return null
  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  if (response.gatewayPort) return `${protocol}//${routeHost}:${response.gatewayPort}/`
  const devPort = typeof __OPENALICE_DEV_BACKEND_PORT__ === 'number'
    ? __OPENALICE_DEV_BACKEND_PORT__
    : 0
  const port = import.meta.env.DEV && devPort > 0
    ? String(devPort)
    : window.location.port
  return `${protocol}//${routeHost}${port ? `:${port}` : ''}/`
}

async function request(workspaceId: string, capability: string, action?: 'start' | 'restart' | 'stop') {
  const suffix = action ? `/${action}` : ''
  const response = await fetch(
    `/api/harness-surfaces/${encodeURIComponent(workspaceId)}/${encodeURIComponent(capability)}${suffix}`,
    action ? { method: 'POST' } : undefined,
  )
  const body = await response.json().catch(() => ({})) as Partial<HarnessSurfaceResponse> & {
    error?: string
    message?: string
  }
  if (!response.ok || !body.surface) {
    throw new HarnessSurfaceApiError(
      body.error ?? 'surface_failed',
      body.message ?? `Studio request failed: HTTP ${response.status}`,
      response.status,
    )
  }
  return body as HarnessSurfaceResponse
}
