import { useCallback, useEffect } from 'react'
import { create } from 'zustand'

import { api } from '../api'
import { defaultUiLayout, normalizeUiLayout, type UiLayout } from '../live/ui-layout'

export interface UiLayoutSnapshot {
  readonly layout: UiLayout
  readonly loading: boolean
  readonly error: string | null
  save(layout: UiLayout): Promise<void>
  reset(): Promise<void>
  refresh(): Promise<void>
}

interface UiLayoutStore {
  layout: UiLayout
  loading: boolean
  error: string | null
  loaded: boolean
  inflight: Promise<void> | null
  ensureLoaded(): Promise<void>
  refresh(): Promise<void>
  save(layout: UiLayout): Promise<void>
  reset(): Promise<void>
}

async function loadLayout(): Promise<UiLayout> {
  return normalizeUiLayout(await api.uiLayout.get())
}

export const useUiLayoutStore = create<UiLayoutStore>((set, get) => ({
  layout: defaultUiLayout(),
  loading: true,
  error: null,
  loaded: false,
  inflight: null,
  async ensureLoaded() {
    if (get().loaded) return
    const inflight = get().inflight
    if (inflight) return inflight
    const request = get().refresh()
    set({ inflight: request })
    try {
      await request
    } finally {
      if (get().inflight === request) set({ inflight: null })
    }
  },
  async refresh() {
    set({ loading: true, error: null })
    try {
      const layout = await loadLayout()
      set({ layout, loading: false, error: null, loaded: true })
    } catch (cause) {
      set({
        loading: false,
        error: cause instanceof Error ? cause.message : String(cause),
        loaded: true,
      })
    }
  },
  async save(layout) {
    const next = await api.uiLayout.put(layout)
    set({ layout: normalizeUiLayout(next), error: null, loaded: true, loading: false })
  },
  async reset() {
    await get().save(defaultUiLayout())
  },
}))

/**
 * Domain read/write boundary for the home-scoped Activity Bar layout.
 * The optimistic default hides Dev so the rail never flashes it on first paint.
 */
export function useUiLayout(): UiLayoutSnapshot {
  const layout = useUiLayoutStore((state) => state.layout)
  const loading = useUiLayoutStore((state) => state.loading)
  const error = useUiLayoutStore((state) => state.error)
  const ensureLoaded = useUiLayoutStore((state) => state.ensureLoaded)
  const refresh = useUiLayoutStore((state) => state.refresh)
  const save = useUiLayoutStore((state) => state.save)
  const reset = useUiLayoutStore((state) => state.reset)

  useEffect(() => {
    void ensureLoaded()
  }, [ensureLoaded])

  return {
    layout,
    loading,
    error,
    save: useCallback((next: UiLayout) => save(next), [save]),
    reset: useCallback(() => reset(), [reset]),
    refresh: useCallback(() => refresh(), [refresh]),
  }
}
