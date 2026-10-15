import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { fetchRelayStatus, reconnectRelayTarget, type RelayStatus } from './useRelayConnection'

export type ConnectionPhase =
  | 'connected'
  | 'relay-unavailable'
  | 'target-missing'
  | 'target-reconnecting'
  | 'target-unavailable'
  | 'backend-unavailable'

/** One presentation-facing view of the auth heartbeat and relay transport.
 * Fleet discovery stays out of this probe: SSH inventory is too slow for a
 * recovery screen that needs to react immediately. */
export function useConnectionLifecycle(initialRelayStatus: RelayStatus | null, relayExpected: boolean) {
  const { backendUnavailable, refresh } = useAuth()
  const [relayStatus, setRelayStatus] = useState<RelayStatus | null>(initialRelayStatus)
  const [relayReachable, setRelayReachable] = useState(initialRelayStatus !== null)
  const [retrying, setRetrying] = useState(false)

  useEffect(() => {
    if (!backendUnavailable || !relayExpected) return
    let active = true
    const probe = () => {
      void fetchRelayStatus().then((status) => {
        if (!active) return
        setRelayStatus(status)
        setRelayReachable(true)
      }).catch(() => {
        if (active) setRelayReachable(false)
      })
    }
    probe()
    const interval = window.setInterval(probe, 3_000)
    return () => { active = false; window.clearInterval(interval) }
  }, [backendUnavailable, relayExpected])

  const retry = useCallback(async () => {
    if (retrying) return
    setRetrying(true)
    try {
      if (relayExpected && relayReachable && relayStatus?.target) {
        try {
          const status = await reconnectRelayTarget()
          setRelayStatus(status)
        } catch { /* Auth heartbeat keeps retrying and the relay reports its own state. */ }
      }
      await refresh()
    } finally { setRetrying(false) }
  }, [refresh, relayExpected, relayReachable, relayStatus, retrying])

  let phase: ConnectionPhase = 'connected'
  if (backendUnavailable) {
    if (relayExpected && !relayReachable) phase = 'relay-unavailable'
    else if (relayExpected && !relayStatus?.target) phase = 'target-missing'
    else if (relayStatus?.switching || relayStatus?.targetConnection === 'reconnecting') phase = 'target-reconnecting'
    else if (relayExpected && relayStatus?.target?.machine !== 'local') phase = 'target-unavailable'
    else phase = 'backend-unavailable'
  }

  return { phase, relayStatus, retrying, retry }
}
