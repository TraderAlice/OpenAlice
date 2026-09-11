import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../api'
import type { VersionInfo } from '../api/types'
import { useBackendRecoverySignal } from '../auth/AuthContext'

export interface VersionInfoSnapshot {
  readonly info: VersionInfo | null
  readonly loading: boolean
  readonly error: string | null
  refresh(): Promise<VersionInfo | null>
  check(): Promise<VersionInfo | null>
}

interface ConfirmedVersionInfo {
  readonly info: VersionInfo
  readonly backendRecoveryGeneration: number
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Recovery-aware read boundary for the running OpenAlice version and update
 * channel. A confirmed backend outage invalidates every pending request; the
 * recovery generation then starts a fresh passive read against the new owner.
 */
export function useVersionInfo(): VersionInfoSnapshot {
  const { backendUnavailable, backendRecoveryGeneration } = useBackendRecoverySignal()
  const [confirmed, setConfirmed] = useState<ConfirmedVersionInfo | null>(null)
  const [attemptGeneration, setAttemptGeneration] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  const requestGeneration = useRef(0)
  const activeRequest = useRef<AbortController | null>(null)
  const backendUnavailableRef = useRef(backendUnavailable)
  const backendRecoveryGenerationRef = useRef(backendRecoveryGeneration)
  backendUnavailableRef.current = backendUnavailable
  backendRecoveryGenerationRef.current = backendRecoveryGeneration

  const request = useCallback(async (
    load: (signal: AbortSignal) => Promise<VersionInfo>,
  ): Promise<VersionInfo | null> => {
    if (!mounted.current || backendUnavailableRef.current) return null
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    const generation = ++requestGeneration.current
    const recoveryGeneration = backendRecoveryGenerationRef.current
    setAttemptGeneration(recoveryGeneration)
    setLoading(true)
    setError(null)
    try {
      const next = await load(controller.signal)
      if (
        !mounted.current
        || backendUnavailableRef.current
        || generation !== requestGeneration.current
        || recoveryGeneration !== backendRecoveryGenerationRef.current
      ) return null
      setConfirmed({
        info: next,
        backendRecoveryGeneration: recoveryGeneration,
      })
      return next
    } catch (cause) {
      if (
        !mounted.current
        || backendUnavailableRef.current
        || generation !== requestGeneration.current
        || recoveryGeneration !== backendRecoveryGenerationRef.current
      ) return null
      setError(errorMessage(cause))
      return null
    } finally {
      if (
        mounted.current
        && !backendUnavailableRef.current
        && generation === requestGeneration.current
        && recoveryGeneration === backendRecoveryGenerationRef.current
      ) setLoading(false)
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }, [])

  const refresh = useCallback(
    () => backendUnavailable
      ? Promise.resolve(null)
      : request((signal) => api.version.get(signal)),
    [backendUnavailable, request],
  )
  const check = useCallback(
    () => backendUnavailable
      ? Promise.resolve(null)
      : request((signal) => api.version.check(signal)),
    [backendUnavailable, request],
  )

  useEffect(() => {
    // React StrictMode replays effects in development, so every setup must
    // restore the mounted marker after the preceding probe cleanup.
    mounted.current = true
    return () => {
      mounted.current = false
      requestGeneration.current += 1
      activeRequest.current?.abort()
      activeRequest.current = null
    }
  }, [])

  useEffect(() => {
    if (backendUnavailable) {
      // The old endpoint may still resolve a request after a tunnel or process
      // handoff. Retire that generation immediately and keep the last confirmed
      // snapshot until the replacement backend answers.
      requestGeneration.current += 1
      activeRequest.current?.abort()
      activeRequest.current = null
      setLoading(false)
      return
    }
    void refresh()
  }, [backendRecoveryGeneration, backendUnavailable, refresh])

  const snapshotIsCurrent = confirmed?.backendRecoveryGeneration === backendRecoveryGeneration
  const attemptIsCurrent = attemptGeneration === backendRecoveryGeneration
  return {
    info: snapshotIsCurrent ? confirmed.info : null,
    loading: backendUnavailable ? false : attemptIsCurrent ? loading : true,
    error: attemptIsCurrent ? error : null,
    refresh,
    check,
  }
}
