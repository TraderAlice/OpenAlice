import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import {
  DEFAULT_DAY_PALETTE,
  DEFAULT_NIGHT_PALETTE,
  isThemePaletteId,
  normalizeThemePreferenceMode,
  type ThemePaletteId,
  type ThemePreferenceMode,
} from './palettes'

/**
 * Color-mode and palette-pairing store.
 *
 * `'auto'` follows the OS (`prefers-color-scheme`); `'day'` / `'night'` pin a
 * preference slot. Default is `'auto'` — unlike the locale store (which deliberately does
 * NOT auto-detect), a color theme SHOULD honor the user's system setting out
 * of the box; that's the whole point of the mode.
 *
 * The storage key remains v1 so existing device preferences survive. The
 * defensive merge below explicitly translates legacy light/dark field names;
 * malformed values still fall back independently.
 *
 * Preference decides whether the day or night slot is active; both slots may
 * independently choose any complete semantic card. A palette's intrinsic
 * light/dark appearance is metadata, not a slot restriction. Stays
 * pure (no DOM imports) so ui/src/theme owns all document mutations.
 */

export type AppTheme = ThemePreferenceMode

/** Cycle order for the single toggle button: auto → day → night → auto. */
const CYCLE: readonly AppTheme[] = ['auto', 'day', 'night']

export interface ThemePreferences {
  theme: AppTheme
  dayPalette: ThemePaletteId
  nightPalette: ThemePaletteId
}

interface ThemeStore {
  theme: AppTheme
  dayPalette: ThemePaletteId
  nightPalette: ThemePaletteId
  setTheme: (theme: AppTheme) => void
  setDayPalette: (palette: ThemePaletteId) => void
  setNightPalette: (palette: ThemePaletteId) => void
  /** Advance to the next mode (drives the ActivityBar toggle). */
  cycleTheme: () => void
}

const DEFAULT_PREFERENCES: ThemePreferences = {
  theme: 'auto',
  dayPalette: DEFAULT_DAY_PALETTE,
  nightPalette: DEFAULT_NIGHT_PALETTE,
}

/** Normalize both the universal-slot shape and the legacy v1 light/dark shape. */
export function normalizeThemePreferences(
  persisted: unknown,
  fallback: ThemePreferences = DEFAULT_PREFERENCES,
): ThemePreferences {
  const stored = persisted && typeof persisted === 'object'
    ? persisted as Record<string, unknown>
    : {}
  const dayPalette = isThemePaletteId(stored.dayPalette) ? stored.dayPalette : stored.lightPalette
  const nightPalette = isThemePaletteId(stored.nightPalette) ? stored.nightPalette : stored.darkPalette
  return {
    theme: normalizeThemePreferenceMode(stored.theme) ?? fallback.theme,
    dayPalette: isThemePaletteId(dayPalette) ? dayPalette : fallback.dayPalette,
    nightPalette: isThemePaletteId(nightPalette) ? nightPalette : fallback.nightPalette,
  }
}

export const useThemeStore = create<ThemeStore>()(
  persist(
    (set, get) => ({
      theme: 'auto',
      dayPalette: DEFAULT_DAY_PALETTE,
      nightPalette: DEFAULT_NIGHT_PALETTE,
      setTheme: (theme) => set({ theme }),
      setDayPalette: (dayPalette) => set({ dayPalette }),
      setNightPalette: (nightPalette) => set({ nightPalette }),
      cycleTheme: () => {
        const i = CYCLE.indexOf(get().theme)
        set({ theme: CYCLE[(i + 1) % CYCLE.length]! })
      },
    }),
    {
      // Keep this key in sync with the no-flash script in index.html.
      name: 'openalice.theme.v1',
      version: 1,
      // The inline no-flash path performs the same migration. Keep hydration
      // equally defensive so malformed or legacy local data cannot overwrite
      // the card that was correct on first paint.
      merge: (persisted, current) => {
        const preferences = normalizeThemePreferences(persisted, current)
        return {
          ...current,
          ...preferences,
        }
      },
    },
  ),
)

/** Persisted preferences at boot (zustand persist rehydrates localStorage sync). */
export function readInitialThemePreferences(): ThemePreferences {
  const { theme, dayPalette, nightPalette } = useThemeStore.getState()
  return { theme, dayPalette, nightPalette }
}
