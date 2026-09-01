import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useBackendRecoverySignal } from '../auth/AuthContext'
import type {
  BrokerAccountPackReadiness,
  BrokerEngine,
  BrokerHealthInfo,
  BrokerPackReadinessResponse,
  TradingMode,
  UTAConfig,
} from '../api/types'

const REFRESH_TTL_MS = 15_000
const BACKEND_UNAVAILABLE_REASON = 'OpenAlice Runtime is unavailable.'

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
  const base = {
    accountId: account.id,
    label: account.label ?? account.id,
    presetId: account.presetId,
    configuredEnabled: account.enabled !== false,
    operational: false,
  }
  // Readiness is a live capability, not a historical snapshot. A refresh or
  // transport error must invalidate even an exact row from the previous
  // response so trading surfaces always fail closed.
  if (state.loading) return { ...base, state: 'checking' }
  if (state.error) {
    return { ...base, state: 'status-unavailable', reason: state.error }
  }

  const exact = state.data?.accounts.find((candidate) => candidate.accountId === account.id)
  if (exact) return exact

  return {
    ...base,
    state: 'status-unavailable',
    reason: 'Broker support status is unavailable on this Runtime.',
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
  const { backendUnavailable, backendRecoveryGeneration } = useBackendRecoverySignal()
  const [data, setData] = useState<BrokerPackReadinessResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [installingEngine, setInstallingEngine] = useState<BrokerEngine | null>(null)
  const dataRef = useRef<BrokerPackReadinessResponse | null>(null)
  const lastLoadedAt = useRef(0)
  const inFlight = useRef<Promise<void> | null>(null)
  const requestGeneration = useRef(0)

  const failClosed = useCallback((nextError: string | null, nextLoading: boolean) => {
    requestGeneration.current += 1
    dataRef.current = null
    lastLoadedAt.current = 0
    setData(null)
    setError(nextError)
    setLoading(nextLoading)
  }, [])

  const performRefresh = useCallback(async (supersedePending: boolean) => {
    if (!supersedePending && inFlight.current) return inFlight.current
    const generation = ++requestGeneration.current
    dataRef.current = null
    lastLoadedAt.current = 0
    setData(null)
    setError(null)
    setLoading(true)

    let request!: Promise<void>
    request = (async () => {
      try {
        const next = await api.trading.getBrokerPacks()
        if (generation !== requestGeneration.current) return
        dataRef.current = next
        setData(next)
        setError(null)
        lastLoadedAt.current = Date.now()
      } catch (err) {
        if (generation !== requestGeneration.current) return
        dataRef.current = null
        setData(null)
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        if (generation === requestGeneration.current) setLoading(false)
        if (inFlight.current === request) inFlight.current = null
      }
    })()
    inFlight.current = request
    return request
  }, [])

  const refresh = useCallback(() => performRefresh(false), [performRefresh])

  useEffect(() => {
    if (backendUnavailable) {
      failClosed(BACKEND_UNAVAILABLE_REASON, false)
      return
    }
    // Recovery must not wait for a request left hanging by the outage. Start a
    // new generation immediately and ignore any late response from the old one.
    void performRefresh(true)
  }, [backendRecoveryGeneration, backendUnavailable, failClosed, performRefresh])

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

  const visibleData = backendUnavailable ? null : data
  const visibleLoading = backendUnavailable ? false : loading
  const visibleError = backendUnavailable ? BACKEND_UNAVAILABLE_REASON : error
  const forAccount = useCallback((account: Pick<UTAConfig, 'id' | 'label' | 'presetId' | 'enabled'>) => (
    selectAccountPackReadiness(account, {
      data: visibleData,
      loading: visibleLoading,
      error: visibleError,
    })
  ), [visibleData, visibleError, visibleLoading])

  return {
    data: visibleData,
    loading: visibleLoading,
    error: visibleError,
    installingEngine,
    refresh,
    install,
    forAccount,
  }
}
