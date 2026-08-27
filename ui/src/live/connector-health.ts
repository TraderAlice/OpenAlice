import { api, type ConnectorSettingsSnapshot } from '../api'
import { createLiveStore, type Apply } from './createLiveStore'
import { reloadOnHotUpdate } from '../lib/hmr'

reloadOnHotUpdate('live/connector-health')

export interface ConnectorHealthLiveState {
  snapshot: ConnectorSettingsSnapshot | null
  loading: boolean
  refreshing: boolean
  error: string | null
  lastUpdatedAt: string | null
}

const POLL_INTERVAL_MS = 15_000
const STARTING_WARNING_GRACE_MS = 45_000
let activeApply: Apply<ConnectorHealthLiveState> | null = null
let refreshPromise: Promise<void> | null = null

export const connectorHealthLive = createLiveStore<ConnectorHealthLiveState>({
  name: 'connector-health',
  initialState: {
    snapshot: null,
    loading: true,
    refreshing: false,
    error: null,
    lastUpdatedAt: null,
  },
  subscribe: ({ apply }) => {
    activeApply = apply
    void refreshWith(apply, false)
    const intervalId = setInterval(() => { void refreshWith(apply, true) }, POLL_INTERVAL_MS)
    return () => {
      clearInterval(intervalId)
      if (activeApply === apply) activeApply = null
    }
  },
  staleAfterMs: POLL_INTERVAL_MS * 2,
})

export function useConnectorHealthState(): ConnectorHealthLiveState {
  return connectorHealthLive.useStore((state) => state)
}

export function useConnectorWarningCount(): number {
  return connectorHealthLive.useStore((state) => connectorWarningCount(state.snapshot))
}

export async function refreshConnectorHealth(): Promise<void> {
  if (!activeApply) {
    connectorHealthLive.reconnect()
    return
  }
  await refreshWith(activeApply, true)
}

export async function reconnectConnector(id: string): Promise<'adapter' | 'service'> {
  const result = await api.connectors.reconnect(id)
  await refreshConnectorHealth()
  return result.scope
}

export function connectorWarningCount(snapshot: ConnectorSettingsSnapshot | null, nowMs = Date.now()): number {
  if (!snapshot?.config.serviceEnabled) return 0
  const configuredEnabled = snapshot.definitions.filter((definition) => {
    const config = snapshot.config.adapters[definition.id]
    if (!config?.enabled) return false
    return definition.fields.filter((field) => field.required).every((field) => (
      field.kind === 'secret'
        ? config.configuredSecrets.includes(field.key)
        : hasValue(config.settings[field.key])
    ))
  })
  if (configuredEnabled.length === 0) return 0
  if (snapshot.health.status === 'degraded' && !snapshot.health.service) {
    return configuredEnabled.length
  }
  const runtimeById = new Map(snapshot.health.service?.adapters.map((adapter) => [adapter.id, adapter]))
  return configuredEnabled.reduce((count, definition) => {
    const adapter = runtimeById.get(definition.id)
    const status = adapter?.status
    const startingTooLong = status === 'starting'
      && elapsedSince(adapter?.lastAttemptAt ?? snapshot.health.service?.startedAt, nowMs) >= STARTING_WARNING_GRACE_MS
    return count + (status === 'degraded' || status === 'stopped' || startingTooLong ? 1 : 0)
  }, 0)
}

async function refreshWith(apply: Apply<ConnectorHealthLiveState>, background: boolean): Promise<void> {
  if (refreshPromise) return refreshPromise
  if (background) apply((state) => ({ ...state, refreshing: true }))
  refreshPromise = api.connectors.load()
    .then((snapshot) => {
      apply({
        snapshot,
        loading: false,
        refreshing: false,
        error: null,
        lastUpdatedAt: new Date().toISOString(),
      })
    })
    .catch((error) => {
      apply((state) => ({
        ...state,
        loading: false,
        refreshing: false,
        error: error instanceof Error ? error.message : String(error),
      }))
    })
    .finally(() => { refreshPromise = null })
  return refreshPromise
}

function hasValue(value: string | number | boolean | undefined): boolean {
  return typeof value === 'boolean'
    || typeof value === 'number'
    || (typeof value === 'string' && value.trim().length > 0)
}

function elapsedSince(value: string | undefined, nowMs: number): number {
  if (!value) return 0
  const startedAt = Date.parse(value)
  return Number.isFinite(startedAt) ? Math.max(0, nowMs - startedAt) : 0
}
