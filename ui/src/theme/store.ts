import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Color-theme preference store — single source of truth for light / dark.
 *
 * `'auto'` follows the OS (`prefers-color-scheme`); `'light'` / `'dark'` pin
 * it. Default is `'auto'` — unlike the locale store (which deliberately does
 * NOT auto-detect), a color theme SHOULD honor the user's system setting out
 * of the box; that's the whole point of the mode.
 *
 * Persistence mirrors the locale store's loud-fail contract (i18n/store.ts):
 * a `version` bump clears stored state, NO migrate function.
 *
 * Stays pure (no DOM imports) so the wiring is one-directional: ui/src/theme
 * subscribes here and applies `<html data-theme>`. The inline script in
 * index.html reads the SAME persisted key to avoid a first-paint flash.
 */

export type AppTheme = 'light' | 'dark' | 'auto'

/** Cycle order for the single toggle button: auto → light → dark → auto. */
const CYCLE: readonly AppTheme[] = ['auto', 'light', 'dark']

interface ThemeStore {
  theme: AppTheme
  setTheme: (theme: AppTheme) => void
  /** Advance to the next mode (drives the ActivityBar toggle). */
  cycleTheme: () => void
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'auto',
      setTheme: (theme) => set({ theme }),
      cycleTheme: () => {
        const i = CYCLE.indexOf(get().theme)
        set({ theme: CYCLE[(i + 1) % CYCLE.length]! })
      },
    }),
    {
      // Keep this key in sync with the no-flash script in index.html.
      name: 'openalice.theme.v1',
      version: 1,
    },
  ),
)

/** Persisted theme at boot (zustand persist rehydrates localStorage sync). */
export function readInitialTheme(): AppTheme {
  return useThemeStore.getState().theme
}
