/**
 * Theme bootstrap — side-effect module. `import './theme'` once in main.tsx,
 * BEFORE first render, so `<html>` has the persisted mode and resolved card.
 *
 * Wiring is one-directional, mirroring i18n/index.ts: the theme store is the
 * source of truth; here we resolve auto/light/dark onto the configured day or
 * night palette and publish the result as data attributes. CSS only defines
 * complete semantic cards; it does not contain a second mode-selection path.
 *
 * A near-identical apply already ran from index.html's inline script to avoid
 * a first-paint flash; re-applying here is cheap and self-heals any drift
 * (e.g. the persisted key changing shape across a version bump).
 */

import { resolveEffectivePalette } from './palettes'
import { useThemeStore, readInitialThemePreferences } from './store'

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')

function applyTheme(state: ReturnType<typeof readInitialThemePreferences>): void {
  const root = document.documentElement
  root.dataset.theme = state.theme
  root.dataset.lightPalette = state.lightPalette
  root.dataset.darkPalette = state.darkPalette
  root.dataset.palette = resolveEffectivePalette(
    state.theme,
    systemTheme.matches,
    state.lightPalette,
    state.darkPalette,
  )
}

applyTheme(readInitialThemePreferences())

useThemeStore.subscribe((state, prev) => {
  if (
    state.theme !== prev.theme
    || state.lightPalette !== prev.lightPalette
    || state.darkPalette !== prev.darkPalette
  ) applyTheme(state)
})

systemTheme.addEventListener('change', () => {
  const state = useThemeStore.getState()
  if (state.theme === 'auto') applyTheme(state)
})
