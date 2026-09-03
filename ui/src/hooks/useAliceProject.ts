import { useCallback, useEffect, useRef, useState } from 'react'

import { api, type AliceProject } from '../api'
import { useBackendRecoverySignal } from '../auth/AuthContext'

export interface AliceProjectSnapshot {
  readonly project: AliceProject | null
  readonly loading: boolean
  readonly error: string | null
  refresh(): Promise<void>
}

interface ConfirmedAliceProject {
  readonly project: AliceProject
  readonly backendRecoveryGeneration: number
}

async function loadAliceProject(): Promise<AliceProject> {
  if (window.openAlice?.runtime) {
    return (await window.openAlice.runtime.info()).aliceProject
  }
  return (await api.aliceProject.get()).project
}

/**
 * Domain read boundary for the top-level runtime that owns the current UI.
 * Browser HTTP and Electron IPC stay behind this hook so presentation code
 * never needs transport branching or direct backend reads.
 */
export function useAliceProject(): AliceProjectSnapshot {
  const { backendUnavailable, backendRecoveryGeneration } = useBackendRecoverySignal()
  const [confirmed, setConfirmed] = useState<ConfirmedAliceProject | null>(null)
  const [attemptGeneration, setAttemptGeneration] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(false)
  const requestGenerationRef = useRef(0)
  const backendUnavailableRef = useRef(backendUnavailable)
  const backendRecoveryGenerationRef = useRef(backendRecoveryGeneration)
  backendUnavailableRef.current = backendUnavailable
  backendRecoveryGenerationRef.current = backendRecoveryGeneration

  const performRefresh = useCallback(async () => {
    const requestGeneration = ++requestGenerationRef.current
    const recoveryGeneration = backendRecoveryGenerationRef.current
    setAttemptGeneration(recoveryGeneration)
    setLoading(true)
    setError(null)
    try {
      const next = await loadAliceProject()
      if (
        !mountedRef.current
        || backendUnavailableRef.current
        || requestGeneration !== requestGenerationRef.current
        || recoveryGeneration !== backendRecoveryGenerationRef.current
      ) return
      setConfirmed({
        project: next,
        backendRecoveryGeneration: recoveryGeneration,
      })
    } catch (cause) {
      if (
        !mountedRef.current
        || backendUnavailableRef.current
        || requestGeneration !== requestGenerationRef.current
        || recoveryGeneration !== backendRecoveryGenerationRef.current
      ) return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (
        mountedRef.current
        && !backendUnavailableRef.current
        && requestGeneration === requestGenerationRef.current
        && recoveryGeneration === backendRecoveryGenerationRef.current
      ) setLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    if (backendUnavailable) {
      setLoading(false)
      return
    }
    await performRefresh()
  }, [backendUnavailable, performRefresh])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestGenerationRef.current += 1
    }
  }, [])

  useEffect(() => {
    if (backendUnavailable) {
      // Preserve the last confirmed AliceProject while the shared offline UI
      // owns outage presentation. Retire any request that may still resolve
      // after the transport has already disappeared.
      requestGenerationRef.current += 1
      setLoading(false)
      return
    }
    // A recovery generation supersedes requests left hanging by the outage.
    // The request/recovery epochs above prevent their late results from
    // overwriting this fresh Runtime identity.
    void performRefresh()
  }, [backendRecoveryGeneration, backendUnavailable, performRefresh])

  const snapshotIsCurrent = confirmed?.backendRecoveryGeneration === backendRecoveryGeneration
  const attemptIsCurrent = attemptGeneration === backendRecoveryGeneration
  return {
    project: snapshotIsCurrent ? confirmed.project : null,
    loading: backendUnavailable ? false : attemptIsCurrent ? loading : true,
    error: attemptIsCurrent ? error : null,
    refresh,
  }
}
