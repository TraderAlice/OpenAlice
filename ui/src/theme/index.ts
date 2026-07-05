/**
 * Theme bootstrap — side-effect module. `import './theme'` once in main.tsx,
 * BEFORE first render, so `<html data-theme>` matches the persisted choice.
 *
 * Wiring is one-directional, mirroring i18n/index.ts: the theme store is the
 * source of truth; here we (a) apply the persisted value at boot and (b)
 * subscribe so every later switch re-applies. The CSS in index.css resolves
 * `data-theme` → the active palette (and `auto` follows prefers-color-scheme
 * via a media query), so this module never touches CSS variables itself.
 *
 * A near-identical apply already ran from index.html's inline script to avoid
 * a first-paint flash; re-applying here is cheap and self-heals any drift
 * (e.g. the persisted key changing shape across a version bump).
 */

import { useThemeStore, readInitialTheme, type AppTheme } from './store'

function applyTheme(theme: AppTheme): void {
  document.documentElement.dataset.theme = theme
}

applyTheme(readInitialTheme())

useThemeStore.subscribe((state, prev) => {
  if (state.theme !== prev.theme) applyTheme(state.theme)
})
