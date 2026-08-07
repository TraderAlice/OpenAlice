export const GUARDIAN_CONTROL_API_VERSION = 1

export interface GuardianRuntimeStatusOptions {
  productVersion: string
  runtimeVersion?: string
  state: string
  home: string
  owner: Record<string, unknown>
  endpoints: Record<string, unknown>
  provider: Record<string, unknown>
  pendingActivation?: unknown
  startedAtMs: number
  components: Record<string, string>
  componentDetail: Record<string, unknown>
  capabilities?: string[]
}

/** Shared discovery envelope for dev, Electron, Docker, and CLI Guardians. */
export function buildGuardianRuntimeStatus(options: GuardianRuntimeStatusOptions) {
  const capabilities = [...new Set(options.capabilities ?? [])]
  return {
    protocol: 1,
    control: {
      apiVersion: GUARDIAN_CONTROL_API_VERSION,
      minClientApiVersion: GUARDIAN_CONTROL_API_VERSION,
      capabilities: ['runtime.status', ...capabilities],
    },
    productVersion: options.productVersion,
    runtimeVersion: options.runtimeVersion ?? options.productVersion,
    state: options.state,
    home: options.home,
    owner: options.owner,
    endpoints: options.endpoints,
    provider: options.provider,
    pendingActivation: options.pendingActivation ?? null,
    uptimeSeconds: Math.max(0, Math.floor((Date.now() - options.startedAtMs) / 1_000)),
    components: options.components,
    componentDetail: options.componentDetail,
    capabilities,
  }
}
