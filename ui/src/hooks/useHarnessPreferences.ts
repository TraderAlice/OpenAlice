import { useCallback, useEffect, useState } from 'react'

import {
  DEFAULT_HARNESS_PREFERENCES,
  preferencesApi,
  type HarnessPreferences,
} from '../api/preferences'

const HARNESS_PREFERENCES_CHANGED_EVENT = 'openalice:harness-preferences-changed'

export interface HarnessPreferencesState {
  readonly preferences: HarnessPreferences
  readonly loading: boolean
  readonly error: string | null
  save(next: HarnessPreferences): Promise<void>
}

/**
 * Installation-wide Ask Alice / Auto Quant harness preferences.
 * Missing reads keep the default (hide headless-born never-TUI Sessions)
 * so the sidebar never flashes those rows on first paint.
 */
export function useHarnessPreferences(): HarnessPreferencesState {
  const [preferences, setPreferences] = useState<HarnessPreferences>(DEFAULT_HARNESS_PREFERENCES)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void preferencesApi.getHarness()
      .then((next) => {
        if (!live) return
        setPreferences(next)
        setLoading(false)
        setError(null)
      })
      .catch((cause) => {
        if (!live) return
        setLoading(false)
        setError(cause instanceof Error ? cause.message : String(cause))
      })

    const onChanged = (event: Event) => {
      const detail = (event as CustomEvent<HarnessPreferences>).detail
      if (detail) setPreferences(detail)
    }
    window.addEventListener(HARNESS_PREFERENCES_CHANGED_EVENT, onChanged)
    return () => {
      live = false
      window.removeEventListener(HARNESS_PREFERENCES_CHANGED_EVENT, onChanged)
    }
  }, [])

  const save = useCallback(async (next: HarnessPreferences) => {
    setPreferences(next)
    setError(null)
    try {
      const saved = await preferencesApi.saveHarness(next)
      setPreferences(saved)
      window.dispatchEvent(new CustomEvent(HARNESS_PREFERENCES_CHANGED_EVENT, { detail: saved }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    }
  }, [])

  return { preferences, loading, error, save }
}
