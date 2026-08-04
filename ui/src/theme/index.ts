/**
 * Theme bootstrap — side-effect module. `import './theme'` once in main.tsx,
 * BEFORE first render, so `<html>` has the persisted mode and resolved card.
 *
 * Wiring is one-directional, mirroring i18n/index.ts: the theme store is the
 * source of truth; here we resolve auto/day/night onto the configured slot
 * and publish its universal palette as data attributes. CSS only defines
 * complete semantic cards; it does not contain a second mode-selection path.
 *
 * A near-identical apply already ran from index.html's inline script to avoid
 * a first-paint flash; re-applying here is cheap and self-heals any drift
 * (e.g. the persisted key changing shape across a version bump).
 */

import { resolveEffectivePalette } from './palettes'
import { useThemeStore, readInitialThemePreferences } from './store'
import { UI_STYLE_PROFILES, type UiStyleProfileDefinition } from './styleProfiles'

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')

function applyTheme(state: ReturnType<typeof readInitialThemePreferences>): void {
  const root = document.documentElement
  const styleDefinition: UiStyleProfileDefinition | undefined = UI_STYLE_PROFILES.find(
    ({ id }) => id === state.uiStyle,
  )
  const stylePalettePair = state.stylePaletteMode === 'recommended'
    ? styleDefinition?.recommendedPalettePair
    : undefined
  root.dataset.theme = state.theme
  root.dataset.dayPalette = state.dayPalette
  root.dataset.nightPalette = state.nightPalette
  root.dataset.uiStyle = state.uiStyle
  root.dataset.stylePaletteMode = state.stylePaletteMode
  root.dataset.palette = resolveEffectivePalette(
    state.theme,
    systemTheme.matches,
    stylePalettePair?.day ?? state.dayPalette,
    stylePalettePair?.night ?? state.nightPalette,
  )
}

applyTheme(readInitialThemePreferences())

useThemeStore.subscribe((state, prev) => {
  if (
    state.theme !== prev.theme
    || state.dayPalette !== prev.dayPalette
    || state.nightPalette !== prev.nightPalette
    || state.uiStyle !== prev.uiStyle
    || state.stylePaletteMode !== prev.stylePaletteMode
  ) applyTheme(state)
})

systemTheme.addEventListener('change', () => {
  const state = useThemeStore.getState()
  if (state.theme === 'auto') applyTheme(state)
})
