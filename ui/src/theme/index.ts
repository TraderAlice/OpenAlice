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
import { useThemeStore, readInitialThemePreferences, ZOOM_RATIO_OPTIONS } from './store'
import { resolveStylePalettePair } from './styleProfiles'

const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')

export function applyZoom(zoomRatio: number): void {
  const factor = zoomRatio / 100
  if (typeof window !== 'undefined' && window.openAlice?.zoom?.setZoomFactor) {
    try {
      window.openAlice.zoom.setZoomFactor(factor)
      if (typeof document !== 'undefined' && document.documentElement.style.zoom) {
        document.documentElement.style.zoom = ''
      }
      return
    } catch {
      // Fall through to CSS zoom
    }
  }
  if (typeof document !== 'undefined') {
    document.documentElement.style.zoom = factor === 1 ? '' : String(factor)
  }
}

function applyTheme(state: ReturnType<typeof readInitialThemePreferences>): void {
  const root = document.documentElement
  const stylePalettePair = resolveStylePalettePair(state.uiStyle, state.stylePaletteMode)
  root.dataset.theme = state.theme
  root.dataset.dayPalette = state.dayPalette
  root.dataset.nightPalette = state.nightPalette
  root.dataset.uiStyle = state.uiStyle
  root.dataset.stylePaletteMode = state.stylePaletteMode
  root.dataset.fontSize = state.fontSize
  root.dataset.palette = resolveEffectivePalette(
    state.theme,
    systemTheme.matches,
    stylePalettePair?.day ?? state.dayPalette,
    stylePalettePair?.night ?? state.nightPalette,
  )
  applyZoom(state.zoomRatio)
}

applyTheme(readInitialThemePreferences())

useThemeStore.subscribe((state, prev) => {
  if (
    state.theme !== prev.theme
    || state.dayPalette !== prev.dayPalette
    || state.nightPalette !== prev.nightPalette
    || state.uiStyle !== prev.uiStyle
    || state.stylePaletteMode !== prev.stylePaletteMode
    || state.fontSize !== prev.fontSize
    || state.zoomRatio !== prev.zoomRatio
  ) applyTheme(state)
})

systemTheme.addEventListener('change', () => {
  const state = useThemeStore.getState()
  if (state.theme === 'auto') applyTheme(state)
})

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return
    if (e.altKey) return
    if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
      e.preventDefault()
      const current = useThemeStore.getState().zoomRatio
      const currentIndex = ZOOM_RATIO_OPTIONS.indexOf(current)
      let next: number
      if (currentIndex >= 0 && currentIndex < ZOOM_RATIO_OPTIONS.length - 1) {
        next = ZOOM_RATIO_OPTIONS[currentIndex + 1]!
      } else {
        next = Math.min(200, current + 10)
      }
      useThemeStore.getState().setZoomRatio(next)
    } else if (e.key === '-' || e.code === 'NumpadSubtract') {
      e.preventDefault()
      const current = useThemeStore.getState().zoomRatio
      const currentIndex = ZOOM_RATIO_OPTIONS.indexOf(current)
      let next: number
      if (currentIndex > 0) {
        next = ZOOM_RATIO_OPTIONS[currentIndex - 1]!
      } else {
        next = Math.max(80, current - 10)
      }
      useThemeStore.getState().setZoomRatio(next)
    } else if (e.key === '0' || e.code === 'Numpad0') {
      e.preventDefault()
      useThemeStore.getState().setZoomRatio(100)
    }
  })
}
