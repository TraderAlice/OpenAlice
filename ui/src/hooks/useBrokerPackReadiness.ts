import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type {
  BrokerAccountPackReadiness,
  BrokerEngine,
  BrokerHealthInfo,
  BrokerPackReadinessResponse,
  TradingMode,
  UTAConfig,
} from '../api/types'

const REFRESH_TTL_MS = 15_000

export type AccountPackReadinessState = BrokerAccountPackReadiness['state'] | 'checking' | 'status-unavailable'

export interface AccountPackReadiness extends Omit<BrokerAccountPackReadiness, 'state'> {
  state: AccountPackReadinessState
}

export interface AccountInteractionPolicy {
  canRead: boolean
  canReconnect: boolean
  canTrade: boolean
  reason?: string
}

interface ReadinessSelectionState {
  data: BrokerPackReadinessResponse | null
  loading: boolean
  error: string | null
}

export function selectAccountPackReadiness(
  account: Pick<UTAConfig, 'id' | 'label' | 'presetId' | 'enabled'>,
  state: ReadinessSelectionState,
): AccountPackReadiness {
  const exact = state.data?.accounts.find((candidate) => candidate.accountId === account.id)
  if (exact) return exact

  const base = {
    accountId: account.id,
    label: account.label ?? account.id,
    presetId: account.presetId,
    configuredEnabled: account.enabled !== false,
    operational: false,
  }
  if (state.loading && !state.data) return { ...base, state: 'checking' }
  return {
    ...base,
    state: 'status-unavailable',
    reason: state.error ?? 'Broker support status is unavailable on this Runtime.',
  }
}

export function deriveAccountInteractionPolicy({
  account,
  readiness,
  health,
  tradingMode,
}: {
  account: Pick<UTAConfig, 'enabled' | 'readOnly'>
  readiness: AccountPackReadiness
  health?: BrokerHealthInfo
  tradingMode: TradingMode
}): AccountInteractionPolicy {
  if (account.enabled === false || !readiness.configuredEnabled) {
    return { canRead: false, canReconnect: false, canTrade: false, reason: 'This account is disabled in configuration.' }
  }
  if (!readiness.operational) {
    const reason = readiness.state === 'checking'
      ? 'Checking broker support on this Runtime.'
      : readiness.reason ?? (readiness.state === 'status-unavailable'
          ? 'Broker support status is unavailable on this Runtime.'
          : 'This Runtime needs broker support before it can use this account.')
    return { canRead: false, canReconnect: false, canTrade: false, reason }
  }

  const readable = { canRead: true, canReconnect: true }
  if (account.readOnly) return { ...readable, canTrade: false, reason: 'This account is configured read-only.' }
  if (tradingMode !== 'pro') {
    return {
      ...readable,
      canTrade: false,
      reason: tradingMode === 'readonly'
        ? 'Agent Permissions are in read-only mode.'
        : 'Trading is unavailable in Lite mode.',
    }
  }
  if (!health) return { ...readable, canTrade: false, reason: 'Waiting for current broker health.' }
  if (health.disabled) return { ...readable, canTrade: false, reason: 'The broker runtime reports this account disabled.' }
  if (health.connecting) return { ...readable, canTrade: false, reason: 'The broker connection is still starting.' }
  if (health.recovering) return { ...readable, canTrade: false, reason: health.lastError ?? 'The broker connection is recovering.' }
  if (health.status !== 'healthy' || health.reach !== 'readable') {
    return { ...readable, canTrade: false, reason: health.lastError ?? 'The broker account is not currently reachable.' }
  }
  if (health.tier !== 'trading') {
    return { ...readable, canTrade: false, reason: 'The broker runtime exposes this account for reading only.' }
  }
  return { ...readable, canTrade: true }
}

export function useBrokerPackReadiness() {
  const [data, setData] = useState<BrokerPackReadinessResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [installingEngine, setInstallingEngine] = useState<BrokerEngine | null>(null)
  const dataRef = useRef<BrokerPackReadinessResponse | null>(null)
  const lastLoadedAt = useRef(0)
  const inFlight = useRef<Promise<void> | null>(null)

  const refresh = useCallback(async () => {
    if (inFlight.current) return inFlight.current
    const request = (async () => {
      if (!dataRef.current) setLoading(true)
      try {
        const next = await api.trading.getBrokerPacks()
        dataRef.current = next
        setData(next)
        setError(null)
        lastLoadedAt.current = Date.now()
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
        inFlight.current = null
      }
    })()
    inFlight.current = request
    return request
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const refreshIfStale = () => {
      if (document.visibilityState === 'hidden') return
      if (Date.now() - lastLoadedAt.current >= REFRESH_TTL_MS) void refresh()
    }
    window.addEventListener('focus', refreshIfStale)
    document.addEventListener('visibilitychange', refreshIfStale)
    return () => {
      window.removeEventListener('focus', refreshIfStale)
      document.removeEventListener('visibilitychange', refreshIfStale)
    }
  }, [refresh])

  const install = useCallback(async (engine: Exclude<BrokerEngine, 'mock'>) => {
    setInstallingEngine(engine)
    setError(null)
    try {
      await api.trading.installBrokerPack(engine)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setInstallingEngine(null)
    }
  }, [refresh])

  const forAccount = useCallback((account: Pick<UTAConfig, 'id' | 'label' | 'presetId' | 'enabled'>) => (
    selectAccountPackReadiness(account, { data, loading, error })
  ), [data, loading, error])

  return { data, loading, error, installingEngine, refresh, install, forAccount }
}
