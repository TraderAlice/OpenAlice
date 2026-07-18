import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  DEFAULT_DARK_PALETTE,
  DEFAULT_LIGHT_PALETTE,
  isDarkPaletteId,
  isLightPaletteId,
  isThemeColorMode,
  type DarkPaletteId,
  type LightPaletteId,
  type ThemeColorMode,
} from './palettes'

/**
 * Color-mode and palette-pairing store.
 *
 * `'auto'` follows the OS (`prefers-color-scheme`); `'light'` / `'dark'` pin
 * it. Default is `'auto'` — unlike the locale store (which deliberately does
 * NOT auto-detect), a color theme SHOULD honor the user's system setting out
 * of the box; that's the whole point of the mode.
 *
 * Persistence mirrors the locale store's loud-fail contract (i18n/store.ts):
 * a `version` bump clears stored state, NO migrate function.
 *
 * Mode decides whether the day or night side is active; the two palette slots
 * independently choose which complete semantic card backs that side. Stays
 * pure (no DOM imports) so ui/src/theme owns all document mutations.
 */

export type AppTheme = ThemeColorMode

/** Cycle order for the single toggle button: auto → light → dark → auto. */
const CYCLE: readonly AppTheme[] = ['auto', 'light', 'dark']

interface ThemeStore {
  theme: AppTheme
  lightPalette: LightPaletteId
  darkPalette: DarkPaletteId
  setTheme: (theme: AppTheme) => void
  setLightPalette: (palette: LightPaletteId) => void
  setDarkPalette: (palette: DarkPaletteId) => void
  /** Advance to the next mode (drives the ActivityBar toggle). */
  cycleTheme: () => void
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'auto',
      lightPalette: DEFAULT_LIGHT_PALETTE,
      darkPalette: DEFAULT_DARK_PALETTE,
      setTheme: (theme) => set({ theme }),
      setLightPalette: (lightPalette) => set({ lightPalette }),
      setDarkPalette: (darkPalette) => set({ darkPalette }),
      cycleTheme: () => {
        const i = CYCLE.indexOf(get().theme)
        set({ theme: CYCLE[(i + 1) % CYCLE.length]! })
      },
    }),
    {
      // Keep this key in sync with the no-flash script in index.html.
      name: 'openalice.theme.v1',
      version: 1,
      // The inline no-flash path validates the same three values. Keep the
      // hydrated store equally defensive so malformed or stale local data
      // cannot overwrite the card that was correct on first paint.
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<ThemeStore>
        return {
          ...current,
          theme: isThemeColorMode(stored.theme) ? stored.theme : current.theme,
          lightPalette: isLightPaletteId(stored.lightPalette) ? stored.lightPalette : current.lightPalette,
          darkPalette: isDarkPaletteId(stored.darkPalette) ? stored.darkPalette : current.darkPalette,
        }
      },
    },
  ),
)

/** Persisted preferences at boot (zustand persist rehydrates localStorage sync). */
export function readInitialThemePreferences(): Pick<ThemeStore, 'theme' | 'lightPalette' | 'darkPalette'> {
  const { theme, lightPalette, darkPalette } = useThemeStore.getState()
  return { theme, lightPalette, darkPalette }
}
