import { useState, useEffect, useCallback, useRef } from 'react'
import { api, type AppConfig } from '../api'
import { useAutoSave, type SaveStatus } from './useAutoSave'

interface UseConfigPageOptions<T> {
  /** Config section key, e.g. 'crypto', 'securities', 'openbb' */
  section: string
  /** Extract the sub-config from the full AppConfig */
  extract: (full: AppConfig) => T
  /** Auto-save debounce delay in ms (default: 600) */
  delay?: number
}

interface UseConfigPageResult<T> {
  config: T | null
  fullConfig: AppConfig | null
  status: SaveStatus
  loadError: boolean
  /** Update config with debounced auto-save */
  updateConfig: (patch: Partial<T>) => void
  /** Update config and immediately flush (no debounce) */
  updateConfigImmediate: (patch: Partial<T>) => void
  retry: () => void
}

/**
 * Shared hook for config pages (DataSources, Trading, Securities).
 * Handles: load → autoSave → flush → updateConfig/updateConfigImmediate.
 */
export function useConfigPage<T extends object>({
  section,
  extract,
  delay = 600,
}: UseConfigPageOptions<T>): UseConfigPageResult<T> {
  const [fullConfig, setFullConfig] = useState<AppConfig | null>(null)
  const [config, setConfig] = useState<T | null>(null)
  const [loadError, setLoadError] = useState(false)
  const flushRequestedRef = useRef(false)

  useEffect(() => {
    api.config
      .load()
      .then((full) => {
        setFullConfig(full)
        setConfig(extract(full))
      })
      .catch(() => setLoadError(true))
  }, []) // extract is stable (caller should memoize or use inline arrow)

  const saveConfig = useCallback(
    async (data: T) => {
      const result = await api.config.updateSection(section, data)
      setConfig(result as T)
    },
    [section],
  )

  const { status, flush, retry } = useAutoSave({
    data: config!,
    save: saveConfig,
    delay,
    enabled: config !== null,
  })

  // After React commits a state update with flushRequested, trigger immediate save
  useEffect(() => {
    if (flushRequestedRef.current && config) {
      flushRequestedRef.current = false
      flush()
    }
  }, [config, flush])

  const updateConfig = useCallback((patch: Partial<T>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev))
  }, [])

  const updateConfigImmediate = useCallback((patch: Partial<T>) => {
    setConfig((prev) => (prev ? { ...prev, ...patch } : prev))
    flushRequestedRef.current = true
  }, [])

  return { config, fullConfig, status, loadError, updateConfig, updateConfigImmediate, retry }
}
