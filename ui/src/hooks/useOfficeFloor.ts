import { useCallback, useEffect, useState } from 'react'

import { api } from '../api'
import type { OfficeBuildingSnapshot } from '../api/office'

export interface OfficeFloorData {
  readonly building: OfficeBuildingSnapshot | null
  readonly loading: boolean
  readonly error: string | null
  refresh(): Promise<void>
}

/**
 * Domain read for the Office building (every business Workspace).
 * Presentation stays prop-driven.
 */
export function useOfficeFloor(asOfSeq: number | null = null): OfficeFloorData {
  const [building, setBuilding] = useState<OfficeBuildingSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await api.office.floor(asOfSeq == null ? undefined : { asOfSeq })
      setBuilding(next)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [asOfSeq])

  useEffect(() => {
    setLoading(true)
    void refresh()
    if (asOfSeq != null) return
    const id = setInterval(() => void refresh(), 4000)
    return () => clearInterval(id)
  }, [refresh, asOfSeq])

  return { building, loading, error, refresh }
}
