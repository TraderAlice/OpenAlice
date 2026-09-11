import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../api'
import type { TelegramConnectorDesk } from '../api/connectors'
import type { ScheduleWhen } from '../api/schedule'

export interface UseTelegramConnectorDesk {
  desk: TelegramConnectorDesk | null
  loading: boolean
  error: string | null
  enable: (wsId: string) => Promise<boolean>
  disable: () => Promise<boolean>
  saveWhat: (what: string) => Promise<boolean>
  saveCadence: (every: string) => Promise<boolean>
}

/**
 * Settings-owned bind for the Alice Project's one Telegram phone-desk Issue.
 * The board list omits this row; comments stay on the ordinary Issue detail.
 */
export function useTelegramConnectorDesk(connectorId = 'telegram'): UseTelegramConnectorDesk {
  const [desk, setDesk] = useState<TelegramConnectorDesk | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const mounted = useRef(true)

  const load = useCallback(async () => {
    try {
      const next = await api.connectors.desk.load(connectorId)
      if (!mounted.current) return
      setDesk(next.desk)
      setError(null)
    } catch (loadError) {
      if (!mounted.current) return
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      if (mounted.current) setLoaded(true)
    }
  }, [connectorId])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
    }
  }, [load])

  const enable = useCallback(async (wsId: string) => {
    try {
      const next = await api.connectors.desk.create(wsId, connectorId)
      if (mounted.current) {
        setDesk(next)
        setError(null)
      }
      return true
    } catch (enableError) {
      if (mounted.current) {
        setError(enableError instanceof Error ? enableError.message : String(enableError))
      }
      return false
    }
  }, [connectorId])

  const disable = useCallback(async () => {
    try {
      await api.connectors.desk.disable(connectorId)
      if (mounted.current) {
        setDesk(null)
        setError(null)
      }
      return true
    } catch (disableError) {
      if (mounted.current) {
        setError(disableError instanceof Error ? disableError.message : String(disableError))
      }
      return false
    }
  }, [connectorId])

  const saveWhat = useCallback(async (what: string) => {
    try {
      const next = await api.connectors.desk.update({ what }, connectorId)
      if (mounted.current) {
        setDesk(next)
        setError(null)
      }
      return true
    } catch (saveError) {
      if (mounted.current) {
        setError(saveError instanceof Error ? saveError.message : String(saveError))
      }
      return false
    }
  }, [connectorId])

  const saveCadence = useCallback(async (every: string) => {
    const when: Extract<ScheduleWhen, { kind: 'every' }> = { kind: 'every', every }
    try {
      const next = await api.connectors.desk.update({ when }, connectorId)
      if (mounted.current) {
        setDesk(next)
        setError(null)
      }
      return true
    } catch (saveError) {
      if (mounted.current) {
        setError(saveError instanceof Error ? saveError.message : String(saveError))
      }
      return false
    }
  }, [connectorId])

  return {
    desk,
    loading: !loaded,
    error,
    enable,
    disable,
    saveWhat,
    saveCadence,
  }
}
