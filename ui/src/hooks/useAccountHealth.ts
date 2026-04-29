import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import { useSSE } from './useSSE'
import type { BrokerHealthInfo } from '../api/types'

/**
 * Fetches account health on mount and subscribes to SSE for real-time updates.
 * Returns a map of accountId → BrokerHealthInfo.
 */
export function useAccountHealth() {
  const [healthMap, setHealthMap] = useState<Record<string, BrokerHealthInfo>>({})

  useEffect(() => {
    api.trading.listUTASummaries().then(({ utas }) => {
      const map: Record<string, BrokerHealthInfo> = {}
      for (const a of utas) map[a.id] = a.health
      setHealthMap(map)
    }).catch(() => {})
  }, [])

  const handleSSE = useCallback((entry: { type?: string; payload?: { accountId?: string } & BrokerHealthInfo }) => {
    if (entry.type === 'account.health' && entry.payload?.accountId) {
      const { accountId, ...health } = entry.payload
      setHealthMap((prev) => ({ ...prev, [accountId]: health as BrokerHealthInfo }))
    }
  }, [])

  useSSE({ url: '/api/events/stream', onMessage: handleSSE })

  return healthMap
}
